import {
  InlineKeyboard,
  InlineQueryResultBuilder,
  type Bot,
} from "grammy";

import type { SandboxService } from "../../services/sandbox/types";
import {
  type RateLimitPolicy,
  SlidingWindowRateLimiter,
  isCodeLengthAllowed,
  isInlineQueryLongEnough,
} from "../../security/rateLimiter";
import {
  formatExecutionMessage,
  formatInlineExecutionPreview,
  formatHelpMessage,
  formatRejectionMessage,
} from "../formatters/telegramExecutionMessage";

interface InlineQueryHandlerOptions {
  sandbox: SandboxService;
  rateLimiter: SlidingWindowRateLimiter;
  rateLimitPolicy: RateLimitPolicy;
  maxCodeLength: number;
  minCodeLength: number;
  botUsername: string;
}

function buildArticle(
  id: string,
  title: string,
  description: string,
  text: string,
  replyMarkup?: InlineKeyboard,
){
  return InlineQueryResultBuilder.article(id, title, {
    description,
    reply_markup: replyMarkup,
  }).text(text, {
      parse_mode: "MarkdownV2",
    });
}

export function registerInlineQueryHandler(bot: Bot, options: InlineQueryHandlerOptions): void {
  bot.on("inline_query", async (ctx) => {
    const code = ctx.inlineQuery.query;

    if (!isInlineQueryLongEnough(code, options.minCodeLength)) {
      const help = formatHelpMessage(options.botUsername);
      await ctx.answerInlineQuery(
        [
          buildArticle(
            "help",
            "Run JavaScript safely",
            "Type more code or open the bot in private chat.",
            help.text,
          ),
        ],
        {
          cache_time: 0,
          is_personal: true,
          button: {
            text: "Open private chat",
            start_parameter: "inline-help",
          },
        },
      );
      return;
    }

    if (!isCodeLengthAllowed(code, options.maxCodeLength)) {
      const rejection = formatRejectionMessage(
        `Inline code exceeds the ${options.maxCodeLength}-character limit.`,
      );
      await ctx.answerInlineQuery(
        [
          buildArticle(
            "too-long",
            "Code too long",
            "The inline query exceeds the maximum supported length.",
            rejection.text,
          ),
        ],
        {
          cache_time: 0,
          is_personal: true,
        },
      );
      return;
    }

    const rateLimit = options.rateLimiter.consume(
      `inline:${ctx.from.id}`,
      options.rateLimitPolicy,
    );
    if (!rateLimit.allowed) {
      const rejection = formatRejectionMessage(
        `Rate limit exceeded. Try again in ${Math.ceil(rateLimit.retryAfterMs / 1000)}s.`,
      );
      await ctx.answerInlineQuery(
        [
          buildArticle(
            "rate-limited",
            "Rate limited",
            "Too many inline executions.",
            rejection.text,
          ),
        ],
        {
          cache_time: 0,
          is_personal: true,
        },
      );
      return;
    }

    const execution = await options.sandbox.execute(code);
    const message = formatExecutionMessage(execution, code);
    const preview = formatInlineExecutionPreview(execution);

    await ctx.answerInlineQuery(
      [
        buildArticle(
          "execution",
          preview.title,
          preview.description,
          message.text,
        ),
      ],
      {
        cache_time: 0,
        is_personal: true,
      },
    );
  });
}
