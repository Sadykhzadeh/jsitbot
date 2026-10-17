import { GrammyError, type Api, type Bot } from "grammy";
import type { ParseMode } from "grammy/types";

import { stripCodeFence } from "../codeInput";
import { isBotCommand } from "../commands";
import { ReplyTracker, type TrackedReply } from "../replyTracker";
import { createRunner, type RunnerOptions } from "../runner";

interface PrivateMessageHandlerOptions extends RunnerOptions {
  botUserId: number;
  replies?: ReplyTracker;
}

interface Request {
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
}

function isNotModified(error: unknown): boolean {
  return error instanceof GrammyError && /message is not modified/i.test(error.description);
}

export function registerPrivateMessageHandler(bot: Bot, options: PrivateMessageHandlerOptions): void {
  const replies = options.replies ?? new ReplyTracker();
  const runCode = createRunner(options);

  async function answerFor(request: Request): Promise<Answer> {
    const outcome = await runCode(request.userId, request.code);

    return { text: outcome.message.text, parseMode: outcome.message.parseMode, quote: outcome.ran };
  }

  /** Updates the earlier answer when there is one that can still be edited, sends a new one otherwise. */
  async function deliver(
    api: Api,
    request: Request,
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
        // Deleted, or too old to edit: say it again as a new message.
      }
    }

    const sent = await api.sendMessage(request.chatId, answer.text, {
      parse_mode: answer.parseMode,
      ...(answer.quote ? { reply_parameters: { message_id: request.messageId } } : {}),
    });
    return sent.message_id;
  }

  async function run(api: Api, request: Request, earlier: TrackedReply | undefined): Promise<void> {
    const answer = await answerFor(request);
    const replyId = await deliver(api, request, answer, earlier);

    replies.remember(request.chatId, request.messageId, { replyId, code: request.code });
  }

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

    const code = stripCodeFence(text);

    await run(
      ctx.api,
      { chatId: ctx.chat.id, userId: ctx.from.id, messageId: ctx.message.message_id, code },
      undefined,
    );
  });

  // Editing a message re-runs it and updates the answer in place.
  bot.chatType("private").on("edited_message:text", async (ctx) => {
    if (ctx.editedMessage.via_bot?.id === options.botUserId) {
      return;
    }

    const text = ctx.editedMessage.text;
    if (isBotCommand(text)) {
      return;
    }

    const code = stripCodeFence(text);

    const request = {
      chatId: ctx.chat.id,
      userId: ctx.from.id,
      messageId: ctx.editedMessage.message_id,
      code,
    };
    const earlier = replies.find(request.chatId, request.messageId);

    // Telegram also reports edits that left the text alone, such as formatting.
    if (earlier?.code === code) {
      return;
    }

    await run(ctx.api, request, earlier);
  });
}
