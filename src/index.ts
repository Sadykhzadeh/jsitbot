import { env } from "./config/env";
import { createBot } from "./bot/createBot";

const bot = await createBot(env);

await bot.start({
  onStart(info) {
    console.log(`Bot started as @${info.username}`);
  },
});
