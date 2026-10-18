import { GrammyError, HttpError, type Bot, type Context } from "grammy";

import { ConfigError, loadEnv } from "./config/env";
import { createBot } from "./bot/createBot";
import type { ConcurrentMiddleware } from "./bot/concurrency";
import { logBotError } from "./runtime/logError";
import { listenForShutdown } from "./runtime/shutdown";
import { logStatsPeriodically } from "./runtime/stats";
import { createApiGuard } from "./runtime/telegramApi";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

let env;
try {
  env = loadEnv(Bun.env);
} catch (error) {
  if (error instanceof ConfigError) {
    fail(`Configuration error: ${error.message}`);
  }
  throw error;
}

const apiGuard = createApiGuard(env.telegramApi);

let bot: Bot | undefined;
let concurrency: ConcurrentMiddleware<Context> | undefined;
listenForShutdown({
  bot: () => bot,
  beforeStop: () => concurrency?.close(),
  activity: { pending: () => apiGuard.stats.pending, lastAt: () => apiGuard.stats.lastActivityAt },
  policy: {
    graceMs: env.shutdown.graceMs,
    // A run shows nothing to Telegram until it is over: its time limit, the
    // 150 ms the sandbox allows past it, the restart of the sandbox process
    // after a kill, and some room.
    quietMs: env.sandbox.timeoutMs + 400,
  },
});

try {
  ({ bot, concurrency } = await createBot(env));
} catch (error) {
  // Both of these say what is wrong in a line; a stack trace adds nothing.
  if (error instanceof GrammyError && error.error_code === 401) {
    fail("Telegram refused BOT_TOKEN (401 Unauthorized). Check that it is the token BotFather sent for this bot.");
  }
  if (error instanceof HttpError) {
    fail(`Could not reach Telegram: ${error.message}`);
  }
  throw error;
}

// Updates are handled with the Api object of bot.api at the time, so this
// reaches every call a handler makes.
bot.api.config.use(apiGuard.transformer);

// Replaces the handler createBot installs, which printed the whole error: for a
// failed Telegram call that includes the message that was being sent.
bot.catch(logBotError);

logStatsPeriodically(bot, apiGuard.stats, env.statsEverySeconds);

await bot.start({
  // Say which updates are wanted rather than inherit whatever list Telegram
  // last stored for this token: edited messages are re-run.
  allowed_updates: ["message", "edited_message", "inline_query"],
  onStart(info) {
    console.log(`Bot started as @${info.username}`);
  },
});
