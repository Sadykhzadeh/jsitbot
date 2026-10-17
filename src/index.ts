import { GrammyError, HttpError } from "grammy";

import { ConfigError, loadEnv } from "./config/env";
import { createBot } from "./bot/createBot";

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

let bot;
try {
  bot = await createBot(env);
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

await bot.start({
  // Say which updates are wanted rather than inherit whatever list Telegram
  // last stored for this token: edited messages are re-run.
  allowed_updates: ["message", "edited_message", "inline_query"],
  onStart(info) {
    console.log(`Bot started as @${info.username}`);
  },
});
