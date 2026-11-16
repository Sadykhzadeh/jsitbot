import { GrammyError, type Api, type Bot } from "grammy";
import type { ParseMode } from "grammy/types";

import { createRunner, type RunnerOptions } from "../runner";
import { stripCodeFence } from "../codeInput";
import { isBotCommand } from "../commands";
import { ReplyTracker, type TrackedReply } from "../replyTracker";
import { sendWholeOutput } from "../wholeOutput";

interface PrivateMessageHandlerOptions extends RunnerOptions {
  botUserId: number;
  replies?: ReplyTracker;
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
}

/**
 * Runs what a private chat asks for and keeps the answer in step with the
 * message: an edit updates it in place. Ordinary messages and /run share it, so
 * the same message gets the same answer whichever way it was written.
 */
export function createPrivateAnswerer(options: RunnerOptions & { replies: ReplyTracker }): PrivateAnswerer {
  const runCode = createRunner(options);
  const replies = options.replies;

  function isNotModified(error: unknown): boolean {
    return error instanceof GrammyError && /message is not modified/i.test(error.description);
  }

  async function answerFor(request: PrivateRequest): Promise<Answer> {
    const outcome = await runCode(request.userId, request.code);

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
    request: PrivateRequest,
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
    const replyId = await deliver(api, request, answer, earlier);
    const documentId = await syncDocument(api, request.chatId, replyId, answer.document, earlier?.documentId);

    replies.remember(request.chatId, request.messageId, { replyId, code: request.code, documentId });
  }

  return {
    send: (api, request) => run(api, request, undefined),
    async edit(api, request) {
      const earlier = replies.find(request.chatId, request.messageId);

      // Telegram also reports edits that left the text alone, such as formatting.
      if (earlier?.code === request.code) {
        return;
      }

      await run(api, request, earlier);
    },
  };
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
      code: stripCodeFence(text),
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
      code: stripCodeFence(text),
    });
  });
}
