import type { Bot } from "grammy";
import type { Document, Message } from "grammy/types";

import { createRunner, rateKey, type RunnerOptions } from "../runner";
import { codeInMessage, stripCodeFence } from "../codeInput";
import { ReplyTracker } from "../replyTracker";
import {
  type CodeFileOptions,
  createPrivateAnswerer,
  isCodeFile,
  readCodeFile,
  refuseFile,
  USAGE,
} from "./privateMessage";

interface RunCommandOptions extends RunnerOptions, CodeFileOptions {
  botUsername: string;
  /** Shared with the private handler, so that an edit of a command finds the answer it made. */
  replies: ReplyTracker;
}

interface AddressedCode {
  code: string;
  /** A code file that was replied to, which is the code when the command has none of its own. */
  file?: Document;
}

const COMMAND = /^\/run(?:@([A-Za-z0-9_]+))?(?=\s|$)/;

/** The code in a message that is being replied to: its first code block if it has one, the whole text if not. */
function codeIn(message: Message): string {
  const text = message.text ?? message.caption;
  if (!text) {
    return "";
  }

  return codeInMessage(text, message.text !== undefined ? message.entities : message.caption_entities);
}

/**
 * Finds out whether a message asks the bot to run something, and what. A chat
 * with many people in it is not a place to run every message that looks like
 * code, so the bot only reacts when it is addressed: `/run code`, `@bot code`,
 * either of them as the caption of a file, or either of them as a reply to a
 * message that holds the code or a code file. Returns undefined for any other
 * message, and an empty code for a request that names nothing to run.
 */
export function addressedCode(message: Message, botUsername: string): AddressedCode | undefined {
  const text = message.text ?? (message.document && isCodeFile(message.document) ? message.caption : undefined);
  if (text === undefined) {
    return undefined;
  }

  let rest: string;
  const command = COMMAND.exec(text);
  if (command) {
    // "/run@other_bot" is meant for another bot.
    if (command[1] && command[1].toLowerCase() !== botUsername.toLowerCase()) {
      return undefined;
    }
    rest = text.slice(command[0].length);
  } else if (text.slice(0, botUsername.length + 1).toLowerCase() === `@${botUsername.toLowerCase()}`) {
    const after = text.slice(botUsername.length + 1);
    if (after !== "" && !/^\s/.test(after)) {
      return undefined;
    }
    rest = after;
  } else {
    return undefined;
  }

  const own = stripCodeFence(rest.trim());
  if (own.trim() !== "") {
    return { code: own };
  }

  if (message.document && isCodeFile(message.document)) {
    return { code: "", file: message.document };
  }
  const quoted = message.reply_to_message;
  if (!quoted || quoted.from?.is_bot) {
    return { code: "" };
  }
  // The file is the code, and whatever was written with it is not.
  if (quoted.document && isCodeFile(quoted.document)) {
    return { code: "", file: quoted.document };
  }
  return { code: codeIn(quoted) };
}

export function registerRunCommandHandler(bot: Bot, options: RunCommandOptions): void {
  const runCode = createRunner(options);
  const answerer = createPrivateAnswerer(options);

  // In a private chat the answer is handled like the answer to any message, so
  // that editing the command updates it. A file's caption is read only in a
  // group: a file sent to the bot in private is run by the private handler as it always was.
  bot.on(["message:text", "message:document"], async (ctx, next) => {
    if (ctx.chat.type === "private" && ctx.message.text === undefined) {
      await next();
      return;
    }
    const request = addressedCode(ctx.message, options.botUsername);
    if (!request || !ctx.from || ctx.from.is_bot) {
      await next();
      return;
    }

    const ids = { chatId: ctx.chat.id, userId: ctx.from.id, messageId: ctx.message.message_id };
    if (ctx.chat.type === "private") {
      if (request.file) {
        await answerer.sendFile(ctx.api, ids, request.file);
      } else {
        await answerer.send(ctx.api, { ...ids, code: request.code });
      }
      return;
    }

    let code = request.code;
    if (request.file) {
      // A user over the limit gets no answer in a group, and the file is not downloaded for them.
      if (!options.rateLimiter.check(rateKey(ctx.from.id), options.rateLimitPolicy).allowed) {
        return;
      }
      const read = await readCodeFile(ctx.api, request.file, options);
      if ("refusal" in read) {
        await refuseFile(ctx.api, ids, options, read.refusal);
        return;
      }
      code = read.code;
    }

    if (code.trim() === "") {
      // Nothing to run, but a reply costs the chat a message all the same.
      if (options.rateLimiter.consume(rateKey(ctx.from.id), options.rateLimitPolicy).allowed) {
        await ctx.reply(USAGE, {
          parse_mode: "MarkdownV2",
          reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
        });
      }
      return;
    }

    const outcome = await runCode(ctx.from.id, code);
    // In a group, a user who is over a limit is not worth a message everybody reads.
    if (!outcome.ran && outcome.refusal !== "too-long") {
      return;
    }

    await ctx.reply(outcome.message.text, {
      parse_mode: "MarkdownV2",
      reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
    });
  });

  bot.on("edited_message:text", async (ctx, next) => {
    const request = addressedCode(ctx.editedMessage, options.botUsername);
    if (!request || ctx.chat.type !== "private" || !ctx.from || ctx.from.is_bot) {
      await next();
      return;
    }

    const ids = { chatId: ctx.chat.id, userId: ctx.from.id, messageId: ctx.editedMessage.message_id };
    if (request.file) {
      await answerer.editFile(ctx.api, ids, request.file);
    } else {
      await answerer.edit(ctx.api, { ...ids, code: request.code });
    }
  });
}
