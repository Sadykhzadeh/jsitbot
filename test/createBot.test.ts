import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createBot } from "../src/bot/createBot";
import { loadEnv } from "../src/config/env";
import { createRunStats } from "../src/runtime/stats";
import { createApiGuard } from "../src/runtime/telegramApi";

const TOKEN = "123456789:AAHsecretValue0123456789abcdefghijk";
const BOT_ID = 999;

describe("a bot from createBot", () => {
  const sent: Array<{ chat_id: number; text: string }> = [];
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        const method = new URL(request.url).pathname.split("/").pop();
        if (method === "getMe") {
          return Response.json({ ok: true, result: { id: BOT_ID, is_bot: true, first_name: "JS", username: "jsitbot" } });
        }
        if (method === "sendMessage") {
          const body = (await request.json()) as { chat_id: number; text: string };
          sent.push(body);
          return Response.json({
            ok: true,
            result: { message_id: 500 + sent.length, date: 0, chat: { id: body.chat_id, type: "private" }, text: body.text },
          });
        }
        return Response.json({ ok: true, result: true });
      },
    });
  });

  afterAll(() => {
    server.stop(true);
  });

  test("answers a message that arrives before its sandbox is ready", async () => {
    const env = loadEnv({ BOT_TOKEN: TOKEN });
    const { bot, sandboxReady } = await createBot(env, createRunStats(), createApiGuard(env.telegramApi), `http://127.0.0.1:${server.port}`);
    // What bot.start does before it polls.
    await bot.init();

    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: 42, type: "private", first_name: "T" },
        from: { id: 42, is_bot: false, first_name: "T" },
        text: "6 * 7",
      },
    });

    for (let waited = 0; sent.length === 0 && waited < 5_000; waited += 10) {
      await Bun.sleep(10);
    }
    expect(sent).toHaveLength(1);
    expect(sent[0].chat_id).toBe(42);
    expect(sent[0].text).toContain("42");

    await (await sandboxReady).dispose?.();
  });

  test("reports a sandbox that cannot start", async () => {
    const env = loadEnv({ BOT_TOKEN: TOKEN });
    const { sandboxReady } = await createBot(
      env,
      createRunStats(),
      createApiGuard(env.telegramApi),
      `http://127.0.0.1:${server.port}`,
      () => Promise.reject(new Error("no process and no engine")),
    );

    await expect(sandboxReady).rejects.toThrow("no process and no engine");
  });
});
