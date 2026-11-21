import { GrammyError, type Api, type Bot } from "grammy";
import type { Document, ParseMode } from "grammy/types";

import { rateKey, createRunner, type RunnerOptions } from "../runner";
import { codeInMessage } from "../codeInput";
import { isBotCommand } from "../commands";
import { formatRejectionMessage } from "../formatters/telegramExecutionMessage";
import { ReplyTracker, type TrackedReply } from "../replyTracker";
import { sendWholeOutput } from "../wholeOutput";
import { describeAnyError } from "../../runtime/logError";

export interface CodeFileOptions {
  maxCodeLength: number;
  /** Reads a file the chat sent, as bytes, and refuses one bigger than the given number of bytes. Telegram's download unless a test gives another. */
  readFile?: (api: Api, fileId: string, maxBytes: number) => Promise<Uint8Array>;
}

interface PrivateMessageHandlerOptions extends RunnerOptions, CodeFileOptions {
  botUserId: number;
  replies?: ReplyTracker;
}

// Files a chat may send as code: JavaScript and TypeScript sources.
const CODE_FILE_NAME = /\.[mc]?[jt]s$/i;
// UTF-8 takes at most three bytes for one UTF-16 unit, so a file this big holds
// no more code than the code length limit allows.
const MAX_BYTES_PER_CHARACTER = 3;
// A download that has not finished this long is given up, so a stalled
// connection cannot hold an update's place in the queue for good.
const DOWNLOAD_TIMEOUT_MS = 10_000;

/** A file that could not be read. The message says why in a line and never carries the download address. */
export class FileDownloadError extends Error {
  override name = "FileDownloadError";

  constructor(
    readonly reason: "too-large" | "timeout" | "failed",
    message: string,
  ) {
    super(message);
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) {
    await response.body?.cancel();
    throw new FileDownloadError("too-large", "file is larger than the limit");
  }

  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FileDownloadError("too-large", "file is larger than the limit");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * The bytes of a file the chat sent, from Telegram's file server. The size
 * Telegram declares is not trusted: the body is counted as it arrives and
 * stopped at `maxBytes`. Errors never include the address, which carries the token.
 */
export async function downloadTelegramFile(
  api: Api,
  fileId: string,
  maxBytes: number,
  timeoutMs = DOWNLOAD_TIMEOUT_MS,
): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    // grammY types its signal with the abort-controller package; the runtime one is the same thing.
    const file = await api.getFile(fileId, signal as never);
    if (!file.file_path) {
      throw new FileDownloadError("failed", "Telegram gave no path for the file");
    }

    const response = await fetch(`https://api.telegram.org/file/bot${api.token}/${file.file_path}`, { signal });
    if (!response.ok) {
      throw new FileDownloadError("failed", `file download failed with status ${response.status}`);
    }

    return await readCapped(response, maxBytes);
  } catch (error) {
    if (error instanceof FileDownloadError) {
      throw error;
    }
    if (signal.aborted) {
      throw new FileDownloadError("timeout", `file download timed out after ${timeoutMs} ms`);
    }
    if (error instanceof GrammyError && /file is too big/i.test(error.description)) {
      throw new FileDownloadError("too-large", "file is larger than the limit");
    }
    if (error instanceof GrammyError) {
      throw new FileDownloadError("failed", `getFile failed with ${error.error_code}: ${error.description}`);
    }
    throw new FileDownloadError("failed", "file download failed");
  }
}

export function isCodeFile(document: Document): boolean {
  return CODE_FILE_NAME.test(document.file_name ?? "");
}

/**
 * The text of a file, which is UTF-8 unless it starts with a UTF-16 byte order
 * mark: Notepad's "Unicode" save is UTF-16, and read as UTF-8 it is all NULs.
 */
function decodeCode(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes);
  }
  return new TextDecoder().decode(bytes);
}

/** The code in a file that was sent as code, or the one line that says why it cannot be run. */
export async function readCodeFile(
  api: Api,
  document: Document,
  options: CodeFileOptions,
): Promise<{ code: string } | { refusal: string }> {
  const tooLarge = `File exceeds the ${options.maxCodeLength}-character limit.`;

  const maxBytes = options.maxCodeLength * MAX_BYTES_PER_CHARACTER;
  // Telegram gives the size before the file is downloaded, so a big one is refused without being read.
  // A file without a size is downloaded, and the download stops at the limit all the same.
  if ((document.file_size ?? 0) > maxBytes) {
    return { refusal: tooLarge };
  }

  let bytes: Uint8Array;
  try {
    bytes = await (options.readFile ?? downloadTelegramFile)(api, document.file_id, maxBytes);
  } catch (error) {
    if (error instanceof FileDownloadError && error.reason === "too-large") {
      return { refusal: tooLarge };
    }
    console.error(`Could not read a code file: ${error instanceof FileDownloadError ? error.message : describeAnyError(error)}`);
    return { refusal: "Could not download the file. Send it again." };
  }

  return { code: decodeCode(bytes) };
}

export interface PrivateRequest {
  chatId: number;
  userId: number;
  messageId: number;
  code: string;
}

interface Answer {
  text: string;
  parseMode: ParseMode;
  /** Whether to send it as a reply to the user's message. */
  quote: boolean;
  /** The whole output as plain text, to send as a file when the answer had to leave something out. */
  document?: string;
}

/** What to answer to /run without any code to run. */
export const USAGE = [
  "Send `/run 6 * 7` and the bot answers with the result\\.",
  "Or reply to a message that has code in it with /run\\.",
].join("\n");

export interface PrivateAnswerer {
  /** Answers a message that has not been answered before. */
  send(api: Api, request: PrivateRequest): Promise<void>;
  /** Updates the answer to the message, or answers it as new when there is none to update. */
  edit(api: Api, request: PrivateRequest): Promise<void>;
  /** Answers a message that is a code file, or replies to one, as `send` does with the file's code. */
  sendFile(api: Api, request: Omit<PrivateRequest, "code">, document: Document): Promise<void>;
  /** Updates the answer to a message that is a code file, as `edit` does with the file's code. */
  editFile(api: Api, request: Omit<PrivateRequest, "code">, document: Document): Promise<void>;
}

/**
 * Runs what a private chat asks for and keeps the answer in step with the
 * message: an edit updates it in place. Ordinary messages and /run share it, so
 * the same message gets the same answer whichever way it was written.
 */
export function createPrivateAnswerer(options: RunnerOptions & { replies: ReplyTracker }): PrivateAnswerer {
  const runCode = createRunner(options);
  const replies = options.replies;
  // Users told they are over a limit, and until when they are not told again.
  const notifiedUntil = new Map<number, number>();

  function isNotModified(error: unknown): boolean {
    return error instanceof GrammyError && /message is not modified/i.test(error.description);
  }

  /**
   * A user over a limit is told once per window. Every message sent meanwhile
   * is refused as well, and a reply to each would be a flood of its own.
   */
  function shouldNotify(userId: number): boolean {
    const now = performance.now();
    if ((notifiedUntil.get(userId) ?? 0) > now) {
      return false;
    }
    for (const [id, until] of notifiedUntil) {
      if (until <= now) {
        notifiedUntil.delete(id);
      }
    }
    notifiedUntil.set(userId, now + options.rateLimitPolicy.windowMs);
    return true;
  }

  async function answerFor(request: PrivateRequest): Promise<Answer | undefined> {
    if (request.code.trim() === "") {
      // Nothing to run, but a reply costs the chat a message all the same.
      if (!options.rateLimiter.consume(rateKey(request.userId), options.rateLimitPolicy).allowed) {
        return undefined;
      }
      return { text: USAGE, parseMode: "MarkdownV2", quote: false };
    }

    const outcome = await runCode(request.userId, request.code);
    if (!outcome.ran && outcome.refusal !== "too-long" && !shouldNotify(request.userId)) {
      return undefined;
    }

    return {
      text: outcome.message.text,
      parseMode: outcome.message.parseMode,
      quote: outcome.ran,
      document: outcome.ran ? outcome.document : undefined,
    };
  }

  /** Updates the earlier answer when there is one that can still be edited, sends a new one otherwise. */
  async function deliver(
    api: Api,
    request: Omit<PrivateRequest, "code">,
    answer: Answer,
    earlier: TrackedReply | undefined,
  ): Promise<number> {
    if (earlier) {
      try {
        await api.editMessageText(request.chatId, earlier.replyId, answer.text, {
          parse_mode: answer.parseMode,
        });
        return earlier.replyId;
      } catch (error) {
        if (isNotModified(error)) {
          return earlier.replyId;
        }
        // Deleted, or too old to edit, is a 400: say it again as a new message.
        // Anything else, a server error or a wait too long to sit out, leaves
        // the earlier answer where it is, and a new one would only repeat it.
        if (!(error instanceof GrammyError && error.error_code === 400)) {
          throw error;
        }
      }
    }

    const sent = await api.sendMessage(request.chatId, answer.text, {
      parse_mode: answer.parseMode,
      ...(answer.quote
        ? { reply_parameters: { message_id: request.messageId, allow_sending_without_reply: true } }
        : {}),
    });
    return sent.message_id;
  }

  /**
   * Keeps the file with the whole output in step with the answer it belongs to:
   * gone when the new answer fits in its message, replaced when it does not.
   */
  async function syncDocument(
    api: Api,
    chatId: number,
    replyId: number,
    document: string | undefined,
    earlierId: number | undefined,
  ): Promise<number | undefined> {
    if (earlierId !== undefined) {
      await api.deleteMessage(chatId, earlierId).catch(() => undefined);
    }
    if (document === undefined) {
      return undefined;
    }

    return sendWholeOutput(api, chatId, replyId, document);
  }

  async function run(api: Api, request: PrivateRequest, earlier: TrackedReply | undefined): Promise<void> {
    const answer = await answerFor(request);
    if (!answer) {
      return;
    }
    const replyId = await deliver(api, request, answer, earlier);
    const documentId = await syncDocument(api, request.chatId, replyId, answer.document, earlier?.documentId);

    replies.remember(request.chatId, request.messageId, { replyId, code: request.code, documentId });
  }

  async function editCode(api: Api, request: PrivateRequest): Promise<void> {
    const earlier = replies.find(request.chatId, request.messageId);

    // Telegram also reports edits that left the text alone, such as formatting.
    if (earlier?.code === request.code) {
      return;
    }

    await run(api, request, earlier);
  }

  /** The notice for a user over the request limit, once per window. */
  async function refuseOverLimit(api: Api, request: Omit<PrivateRequest, "code">, retryAfterMs: number): Promise<void> {
    if (shouldNotify(request.userId)) {
      const rejection = formatRejectionMessage(`Rate limit exceeded. Try again in ${Math.ceil(retryAfterMs / 1000)}s.`);
      await deliver(api, request, { ...rejection, quote: true }, undefined);
    }
  }

  /**
   * A file that is sent is read only while its user is within the limit. The
   * run that follows charges the request as for any message.
   */
  async function sendFileCode(api: Api, request: Omit<PrivateRequest, "code">, document: Document): Promise<void> {
    const limit = options.rateLimiter.check(rateKey(request.userId), options.rateLimitPolicy);
    if (!limit.allowed) {
      await refuseOverLimit(api, request, limit.retryAfterMs);
      return;
    }

    const read = await readCodeFile(api, document, options);
    if ("refusal" in read) {
      await refuseFile(api, request, options, read.refusal);
      return;
    }
    await run(api, { ...request, code: read.code }, undefined);
  }

  /**
   * Every edit of a file reads it again, and each read is a call to Telegram,
   * so the read is charged to the limit before it is made, even when the code
   * turns out to be what the answer already shows.
   */
  async function editFileCode(api: Api, request: Omit<PrivateRequest, "code">, document: Document): Promise<void> {
    const charge = options.rateLimiter.consume(rateKey(request.userId), options.rateLimitPolicy);
    if (!charge.allowed) {
      await refuseOverLimit(api, request, charge.retryAfterMs);
      return;
    }

    const read = await readCodeFile(api, document, options);
    if ("refusal" in read) {
      await refuseFile(api, request, options, read.refusal);
      return;
    }
    await editCode(api, { ...request, code: read.code });
  }

  return {
    send: (api, request) => run(api, request, undefined),
    edit: editCode,
    sendFile: sendFileCode,
    editFile: editFileCode,
  };
}

/** Answers a file that cannot be run with one line, as a reply to the message it came in, unless the user is over the request limit. */
export async function refuseFile(
  api: Api,
  request: Pick<PrivateRequest, "chatId" | "userId" | "messageId">,
  options: RunnerOptions,
  reason: string,
): Promise<void> {
  if (options.rateLimiter.consume(rateKey(request.userId), options.rateLimitPolicy).allowed) {
    const rejection = formatRejectionMessage(reason);
    await api.sendMessage(request.chatId, rejection.text, {
      parse_mode: rejection.parseMode,
      reply_parameters: { message_id: request.messageId, allow_sending_without_reply: true },
    });
  }
}

export function registerPrivateMessageHandler(bot: Bot, options: PrivateMessageHandlerOptions): void {
  const answerer = createPrivateAnswerer({ ...options, replies: options.replies ?? new ReplyTracker() });

  bot.chatType("private").on("message", async (ctx, next) => {
    if (ctx.message.via_bot?.id !== options.botUserId) {
      // Not a result sent from inline mode: hand it on, or the handler below
      // never sees an ordinary message.
      await next();
      return;
    }

    await ctx.react("❤").catch(() => undefined);
  });

  // A file is read as code when its name says so, and ignored otherwise, like any
  // other message the bot has no answer for.
  bot.chatType("private").on("message:document", async (ctx) => {
    if (!isCodeFile(ctx.message.document)) {
      return;
    }

    await answerer.sendFile(
      ctx.api,
      { chatId: ctx.chat.id, userId: ctx.from.id, messageId: ctx.message.message_id },
      ctx.message.document,
    );
  });

  bot.chatType("private").on("message:text", async (ctx) => {
    if (ctx.message.via_bot?.id === options.botUserId) {
      return;
    }

    const text = ctx.message.text;
    if (isBotCommand(text)) {
      return;
    }

    await answerer.send(ctx.api, {
      chatId: ctx.chat.id,
      userId: ctx.from.id,
      messageId: ctx.message.message_id,
      code: codeInMessage(text, ctx.message.entities),
    });
  });

  bot.chatType("private").on("edited_message:text", async (ctx) => {
    if (ctx.editedMessage.via_bot?.id === options.botUserId) {
      return;
    }

    const text = ctx.editedMessage.text;
    if (isBotCommand(text)) {
      return;
    }

    await answerer.edit(ctx.api, {
      chatId: ctx.chat.id,
      userId: ctx.from.id,
      messageId: ctx.editedMessage.message_id,
      code: codeInMessage(text, ctx.editedMessage.entities),
    });
  });
}
