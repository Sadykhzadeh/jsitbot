import type { Bot } from "grammy";

import type { SandboxService } from "../../services/sandbox/types";
import {
  type RateLimitPolicy,
  SlidingWindowRateLimiter,
  isCodeLengthAllowed,
} from "../../security/rateLimiter";
import {
  formatExecutionMessage,
  formatRejectionMessage,
} from "../formatters/telegramExecutionMessage";

interface PrivateMessageHandlerOptions {
  botUserId: number;
  sandbox: SandboxService;
  rateLimiter: SlidingWindowRateLimiter;
  rateLimitPolicy: RateLimitPolicy;
  maxCodeLength: number;
}

export function registerPrivateMessageHandler(bot: Bot, options: PrivateMessageHandlerOptions): void {
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
    if (code.startsWith("/")) {
      return;
    }

    const rateLimit = options.rateLimiter.consume(
      `private:${ctx.from.id}`,
      options.rateLimitPolicy,
    );
    if (!rateLimit.allowed) {
      const message = formatRejectionMessage(
        `Rate limit exceeded. Try again in ${Math.ceil(rateLimit.retryAfterMs / 1000)}s.`,
      );
      await ctx.reply(message.text, { parse_mode: message.parseMode });
      return;
    }

    if (!isCodeLengthAllowed(code, options.maxCodeLength)) {
      const message = formatRejectionMessage(
        `Code exceeds the ${options.maxCodeLength}-character limit.`,
      );
      await ctx.reply(message.text, { parse_mode: message.parseMode });
      return;
    }

    const execution = await options.sandbox.execute(code);
    const message = formatExecutionMessage(execution, code);

    await ctx.reply(message.text, {
      parse_mode: message.parseMode,
      reply_parameters: { message_id: ctx.msg.message_id },
    });
  });
}
