import { Bot } from "grammy";

import type { AppEnv } from "../config/env";
import { publishCommandMenus } from "./commandMenu";
import { handleConcurrently } from "./concurrency";
import { registerInlineQueryHandler } from "./handlers/inlineQuery";
import { registerPrivateMessageHandler } from "./handlers/privateMessage";
import { registerRunCommandHandler } from "./handlers/runCommand";
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

  // The menu is a convenience: starting must not wait for it or fail without it.
  publishCommandMenus(bot.api).catch((error) => console.error("Could not publish the command menu:", error));

  bot.use(handleConcurrently(bot, config.limits.concurrency));

  registerStartHelpHandlers(bot, botUsername);
  // Before the private handler, so that "/run" and "@bot" are taken out of the
  // messages it would otherwise run as code.
  registerRunCommandHandler(bot, {
    botUsername,
    sandbox,
    rateLimiter,
    rateLimitPolicy: config.limits.privateRateLimit,
    timeBudget,
    timeBudgetPolicy: config.limits.sandboxTimeBudget,
    maxCodeLength: config.limits.maxCodeLength,
  });
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
