import { Bot } from "grammy";

import type { AppEnv } from "../config/env";
import { handleConcurrently } from "./concurrency";
import { registerInlineQueryHandler } from "./handlers/inlineQuery";
import { registerPrivateMessageHandler } from "./handlers/privateMessage";
import { registerStartHelpHandlers } from "./handlers/startHelp";
import { SandboxTimeBudget, SlidingWindowRateLimiter } from "../security/rateLimiter";
import { createSandbox } from "../services/sandbox/createSandbox";

export async function createBot(config: AppEnv): Promise<Bot> {
  const bot = new Bot(config.botToken);
  const me = await bot.api.getMe();
  const botUsername = me.username ?? "jsitbot";

  const sandbox = await createSandbox({
    timeoutMs: config.sandbox.timeoutMs,
    memoryLimitBytes: config.sandbox.memoryLimitBytes,
    maxStackSizeBytes: config.sandbox.maxStackSizeBytes,
    maxLogs: 50,
    maxLogLength: 2_000,
    maxResultLength: 4_000,
  });
  const rateLimiter = new SlidingWindowRateLimiter();
  const timeBudget = new SandboxTimeBudget();

  bot.use(handleConcurrently(bot, config.limits.concurrency));

  registerStartHelpHandlers(bot, botUsername);
  registerPrivateMessageHandler(bot, {
    botUserId: me.id,
    sandbox,
    rateLimiter,
    rateLimitPolicy: config.limits.privateRateLimit,
    timeBudget,
    timeBudgetPolicy: config.limits.sandboxTimeBudget,
    maxCodeLength: config.limits.maxCodeLength,
  });
  registerInlineQueryHandler(bot, {
    sandbox,
    rateLimiter,
    rateLimitPolicy: config.limits.inlineRateLimit,
    timeBudget,
    timeBudgetPolicy: config.limits.sandboxTimeBudget,
    maxCodeLength: config.limits.maxCodeLength,
    minCodeLength: config.limits.inlineMinLength,
    botUsername,
  });

  bot.catch((error) => {
    console.error("Bot error:", error.error);
  });

  return bot;
}
