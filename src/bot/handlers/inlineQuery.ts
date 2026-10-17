import {
  InlineKeyboard,
  InlineQueryResultBuilder,
  type Bot,
} from "grammy";

import type { SandboxService } from "../../services/sandbox/types";
import {
  type RateLimitPolicy,
  SandboxTimeBudget,
  SlidingWindowRateLimiter,
  type TimeBudgetPolicy,
  TIMEOUT_PENALTY_REQUESTS,
  isCodeLengthAllowed,
  isInlineQueryLongEnough,
} from "../../security/rateLimiter";
import {
  formatCompactExecution,
  formatExecutionMessage,
  formatInlineExecutionPreview,
  formatHelpMessage,
  formatRejectionMessage,
} from "../formatters/telegramExecutionMessage";

interface InlineQueryHandlerOptions {
  sandbox: SandboxService;
  rateLimiter: SlidingWindowRateLimiter;
  rateLimitPolicy: RateLimitPolicy;
  timeBudget: SandboxTimeBudget;
  timeBudgetPolicy: TimeBudgetPolicy;
  maxCodeLength: number;
  minCodeLength: number;
  botUsername: string;
}

const HELP_CACHE_SECONDS = 600;

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
          // The same for everybody and for every short query, unlike a run.
          cache_time: HELP_CACHE_SECONDS,
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

    const budgetKey = `user:${ctx.from.id}`;
    const budget = options.timeBudget.check(budgetKey, options.timeBudgetPolicy);
    if (!budget.allowed) {
      const rejection = formatRejectionMessage(
        `Your code has used up its run time for now. Try again in ${Math.ceil(budget.retryAfterMs / 1000)}s.`,
      );
      await ctx.answerInlineQuery(
        [
          buildArticle(
            "run-time",
            "Run time used up",
            "Your code kept the sandbox busy for too long. Try again shortly.",
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
    options.timeBudget.record(budgetKey, execution.durationMs, options.timeBudgetPolicy);
    if (execution.timedOut) {
      options.rateLimiter.charge(
        `inline:${ctx.from.id}`,
        options.rateLimitPolicy,
        TIMEOUT_PENALTY_REQUESTS,
      );
    }
    const message = formatExecutionMessage(execution, code);
    const preview = formatInlineExecutionPreview(execution);

    const articles = [buildArticle("execution", preview.title, preview.description, message.text)];
    const compact = formatCompactExecution(execution, code);
    if (compact) {
      articles.push(buildArticle("compact", compact.title, "Just the code and its result", compact.text));
    }

    await ctx.answerInlineQuery(
      articles,
      {
        cache_time: 0,
        is_personal: true,
      },
    );
  });
}
