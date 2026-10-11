import { env } from "./config/env";
import { createBot } from "./bot/createBot";

const bot = await createBot(env);

await bot.start({
  // Say which updates are wanted rather than inherit whatever list Telegram
  // last stored for this token: edited messages are re-run.
  allowed_updates: ["message", "edited_message", "inline_query"],
  onStart(info) {
    console.log(`Bot started as @${info.username}`);
  },
});
