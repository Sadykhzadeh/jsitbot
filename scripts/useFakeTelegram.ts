// Preload for running the real bot against scripts/fakeTelegram.ts:
//
//   FAKE_TELEGRAM=http://127.0.0.1:PORT bun --preload ./scripts/useFakeTelegram.ts src/index.ts
//
// grammY sends its requests through node-fetch, so the Telegram address is
// swapped there and the bot's own code stays as it is.
const root = process.env.FAKE_TELEGRAM;

if (!root) {
  throw new Error("FAKE_TELEGRAM is not set");
}

const nodeFetch = require("node-fetch");
const real = nodeFetch.default;

nodeFetch.default = (url: string, init?: unknown) =>
  real(String(url).replace("https://api.telegram.org", root), init);
