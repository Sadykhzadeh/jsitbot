import { GrammyError, HttpError, type Bot, type Context } from "grammy";

import { ConfigError, loadEnv } from "./config/env";
import { createBot } from "./bot/createBot";
import type { ConcurrentMiddleware } from "./bot/concurrency";
import { listenForCrashes } from "./runtime/crash";
import { describeAnyError, logBotError, redactConsoleErrors } from "./runtime/logError";
import { listenForShutdown } from "./runtime/shutdown";
import { createRunStats, logStatsPeriodically } from "./runtime/stats";
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

listenForCrashes([env.botToken]);
redactConsoleErrors([env.botToken]);

const apiGuard = createApiGuard(env.telegramApi);

const runStats = createRunStats();
let bot: Bot | undefined;
let concurrency: ConcurrentMiddleware<Context> | undefined;
listenForShutdown({
  bot: () => bot,
  beforeStop: () => concurrency?.close(),
  activity: {
    pending: () => apiGuard.stats.pending + (concurrency?.inProgress() ?? 0),
    lastAt: () => apiGuard.stats.lastActivityAt,
  },
  policy: {
    graceMs: env.shutdown.graceMs,
    // A run shows nothing to Telegram until it is over: its time limit, the
    // 150 ms the sandbox allows past it, the restart of the sandbox process
    // after a kill, and some room.
    quietMs: env.sandbox.timeoutMs + 400,
  },
});

try {
  const created = await createBot(env, runStats, apiGuard);
  ({ bot, concurrency } = created);
  // The bot polls before the sandbox is ready, so a sandbox that cannot start
  // is reported here and ends the process, as it did when startup waited for it.
  created.sandboxReady.catch((error) => fail(`The sandbox could not start: ${describeAnyError(error)}`));
} catch (error) {
  // Both of these say what is wrong in a line; a stack trace adds nothing.
  if (error instanceof GrammyError && error.error_code === 401) {
    fail("Telegram refused BOT_TOKEN (401 Unauthorized). Check that it is the token BotFather sent for this bot.");
  }
  if (error instanceof GrammyError) {
    fail(`Telegram did not start the bot: ${error.method} failed with ${error.error_code}: ${error.description}. Check BOT_TOKEN in .env.`);
  }
  if (error instanceof HttpError) {
    fail(`Could not reach Telegram to check BOT_TOKEN (${error.message}). Check the network connection.`);
  }
  throw error;
}

// Replaces the handler createBot installs, which printed the whole error: for a
// failed Telegram call that includes the message that was being sent.
bot.catch(logBotError);

logStatsPeriodically(bot, apiGuard.stats, runStats, env.statsEverySeconds);

await bot.start({
  // Say which updates are wanted rather than inherit whatever list Telegram
  // last stored for this token: edited messages are re-run.
  allowed_updates: ["message", "edited_message", "inline_query"],
  onStart(info) {
    console.log(`Bot started as @${info.username}`);
  },
});
