import { GrammyError, type Api, type Bot } from "grammy";
import type { ParseMode } from "grammy/types";

import type { SandboxService } from "../../services/sandbox/types";
import {
  type RateLimitPolicy,
  SandboxTimeBudget,
  SlidingWindowRateLimiter,
  type TimeBudgetPolicy,
  TIMEOUT_PENALTY_REQUESTS,
  isCodeLengthAllowed,
} from "../../security/rateLimiter";
import { isBotCommand } from "../commands";
import {
  formatExecutionMessage,
  formatRejectionMessage,
} from "../formatters/telegramExecutionMessage";
import { ReplyTracker, type TrackedReply } from "../replyTracker";

interface PrivateMessageHandlerOptions {
  botUserId: number;
  sandbox: SandboxService;
  rateLimiter: SlidingWindowRateLimiter;
  rateLimitPolicy: RateLimitPolicy;
  timeBudget: SandboxTimeBudget;
  timeBudgetPolicy: TimeBudgetPolicy;
  maxCodeLength: number;
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

  async function answerFor(request: Request): Promise<Answer> {
    const rateLimit = options.rateLimiter.consume(
      `private:${request.userId}`,
      options.rateLimitPolicy,
    );
    if (!rateLimit.allowed) {
      const message = formatRejectionMessage(
        `Rate limit exceeded. Try again in ${Math.ceil(rateLimit.retryAfterMs / 1000)}s.`,
      );
      return { text: message.text, parseMode: message.parseMode, quote: false };
    }

    if (!isCodeLengthAllowed(request.code, options.maxCodeLength)) {
      const message = formatRejectionMessage(
        `Code exceeds the ${options.maxCodeLength}-character limit.`,
      );
      return { text: message.text, parseMode: message.parseMode, quote: false };
    }

    const budgetKey = `user:${request.userId}`;
    const budget = options.timeBudget.check(budgetKey, options.timeBudgetPolicy);
    if (!budget.allowed) {
      const message = formatRejectionMessage(
        `Your code has used up its run time for now. Try again in ${Math.ceil(budget.retryAfterMs / 1000)}s.`,
      );
      return { text: message.text, parseMode: message.parseMode, quote: false };
    }

    const execution = await options.sandbox.execute(request.code);
    options.timeBudget.record(budgetKey, execution.durationMs, options.timeBudgetPolicy);
    if (execution.timedOut) {
      options.rateLimiter.charge(
        `private:${request.userId}`,
        options.rateLimitPolicy,
        TIMEOUT_PENALTY_REQUESTS,
      );
    }
    const message = formatExecutionMessage(execution, request.code);
    return { text: message.text, parseMode: message.parseMode, quote: true };
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

    const code = ctx.message.text;
    if (isBotCommand(code)) {
      return;
    }

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

    const code = ctx.editedMessage.text;
    if (isBotCommand(code)) {
      return;
    }

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
