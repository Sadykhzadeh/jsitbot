import { describe, expect, test } from "bun:test";
import type { Bot } from "grammy";
import { fileURLToPath } from "node:url";

import { startFakeTelegram } from "../scripts/fakeTelegram";
import { createShutdown, drain, type Activity, type ShutdownPolicy } from "../src/runtime/shutdown";
import { FakeClock } from "./fakeClock";

const POLICY: ShutdownPolicy = { graceMs: 8_000, quietMs: 1_100 };

/** Activity that the test moves by hand. */
function activity(): Activity & { calls: number; at: number } {
  const state = {
    calls: 0,
    at: -Infinity,
    pending: () => state.calls,
    lastAt: () => state.at,
  };
  return state;
}

describe("drain", () => {
  test("is done once nothing has happened for the quiet time", async () => {
    const clock = new FakeClock();
    const result = drain(activity(), POLICY, 0, clock);

    await clock.advance(1_099);
    let settled = false;
    result.then(() => (settled = true));
    await clock.advance(0);
    expect(settled).toBe(false);

    await clock.advance(1);
    expect(await result).toBe("idle");
  });

  test("waits for a call that is still in progress", async () => {
    const clock = new FakeClock();
    const busy = activity();
    busy.calls = 1;
    const result = drain(busy, POLICY, 0, clock);

    await clock.advance(5_000);
    busy.calls = 0;
    busy.at = clock.now();
    await clock.advance(1_000);
    let settled = false;
    result.then(() => (settled = true));
    await clock.advance(0);
    expect(settled).toBe(false);

    await clock.advance(100);
    expect(await result).toBe("idle");
  });

  test("starts the quiet time again when a call goes out", async () => {
    const clock = new FakeClock();
    const busy = activity();
    const result = drain(busy, POLICY, 0, clock);

    await clock.advance(1_000);
    busy.at = clock.now();
    await clock.advance(1_000);
    let settled = false;
    result.then(() => (settled = true));
    await clock.advance(0);
    expect(settled).toBe(false);

    await clock.advance(100);
    expect(await result).toBe("idle");
  });

  test("gives up when the grace time is over", async () => {
    const clock = new FakeClock();
    const busy = activity();
    busy.calls = 3;
    const result = drain(busy, POLICY, 0, clock);

    await clock.advance(8_000);

    expect(await result).toBe("gave-up");
  });
});

describe("shutdown on a signal", () => {
  function setup(options: { stop?: () => Promise<void>; hasBot?: boolean } = {}) {
    const clock = new FakeClock();
    const busy = activity();
    const exits: number[] = [];
    const lines: string[] = [];
    const stops: number[] = [];
    const bot = {
      stop: async () => {
        stops.push(clock.now());
        await options.stop?.();
      },
    } as unknown as Bot;

    const shutdown = createShutdown({
      bot: () => (options.hasBot === false ? undefined : bot),
      activity: busy,
      policy: POLICY,
      exit: (code) => void exits.push(code),
      log: (line) => void lines.push(line),
      clock,
    });

    return { clock, busy, exits, lines, stops, shutdown };
  }

  test("stops polling, waits for the quiet time and exits cleanly", async () => {
    const { clock, exits, lines, stops, shutdown } = setup();

    const done = shutdown("SIGTERM");
    await clock.advance(1_200);
    await done;

    expect(stops).toEqual([0]);
    expect(exits).toEqual([0]);
    expect(lines.at(-1)).toMatch(/^Stopped after \d+ ms$/);
  });

  test("lets an answer in progress go out before it exits", async () => {
    const { clock, busy, exits, shutdown } = setup();
    busy.calls = 1;

    const done = shutdown("SIGTERM");
    await clock.advance(3_000);
    expect(exits).toEqual([]);

    busy.calls = 0;
    busy.at = clock.now();
    await clock.advance(1_200);
    await done;

    expect(exits).toEqual([0]);
  });

  test("exits with an error and says so when answers are still unfinished at the grace time", async () => {
    const { clock, busy, exits, lines, shutdown } = setup();
    busy.calls = 2;

    const done = shutdown("SIGTERM");
    await clock.advance(8_000);
    await done;

    expect(exits).toEqual([1]);
    expect(lines.at(-1)).toBe("Stopped after 8000 ms with 2 calls to Telegram unfinished");
  });

  test("does not hang on a stop that Telegram never answers", async () => {
    const { clock, exits, shutdown } = setup({ stop: () => new Promise(() => undefined) });

    const done = shutdown("SIGTERM");
    await clock.advance(9_100);
    await done;

    expect(exits).toEqual([1]);
  });

  test("goes on when the last update cannot be confirmed", async () => {
    const { clock, exits, lines, shutdown } = setup({ stop: () => Promise.reject(new Error("offline")) });

    const done = shutdown("SIGTERM");
    await clock.advance(1_200);
    await done;

    expect(lines[1]).toBe("Could not confirm the last update to Telegram: offline");
    expect(exits).toEqual([0]);
  });

  test("a second signal exits at once", async () => {
    const { clock, busy, exits, shutdown } = setup();
    busy.calls = 1;

    const first = shutdown("SIGTERM");
    await clock.advance(100);
    await shutdown("SIGINT");

    expect(exits).toEqual([1]);
    void first;
  });

  test("a signal before the bot exists has nothing to wait for", async () => {
    const { exits, stops, shutdown } = setup({ hasBot: false });

    await shutdown("SIGTERM");

    expect(exits).toEqual([0]);
    expect(stops).toEqual([]);
  });
});

// A real process and a real signal; Windows has no SIGTERM to send.
describe.skipIf(process.platform === "win32")("the bot process", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));

  async function start(telegramUrl: string) {
    const bot = Bun.spawn([process.execPath, "--preload", "./scripts/useFakeTelegram.ts", "src/index.ts"], {
      cwd: root,
      env: { ...process.env, BOT_TOKEN: "123456:test-token-0123456789", FAKE_TELEGRAM: telegramUrl },
      stdout: "pipe",
      stderr: "pipe",
    });

    let output = "";
    const decoder = new TextDecoder();
    const pump = (async () => {
      for await (const chunk of bot.stdout) {
        output += decoder.decode(chunk, { stream: true });
      }
    })();

    const startedBy = performance.now() + 10_000;
    while (!output.includes("Bot started")) {
      if (bot.exitCode !== null || performance.now() > startedBy) {
        throw new Error(`The bot did not start:
${output}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    return { bot, output: async () => (await pump, output) };
  }

  const message = (updateId: number, userId: number, text: string) =>
    ({
      update_id: updateId,
      message: {
        message_id: updateId,
        date: 0,
        chat: { id: userId, type: "private", first_name: "u" },
        from: { id: userId, is_bot: false, first_name: "u" },
        text,
      },
    }) as never;

  test("answers the messages it already took before it exits on SIGTERM", async () => {
    const telegram = startFakeTelegram({ latencyMs: 20 });
    const { bot, output } = await start(telegram.url);

    // Two programs that run until they are cut off, from two people: about a
    // second and a half of work that is still going when the signal arrives.
    telegram.push(message(1, 101, "while (true) {}"));
    telegram.push(message(2, 102, "while (true) {}"));
    await telegram.waitForOffset(2);

    const signalledAt = performance.now();
    bot.kill("SIGTERM");
    const code = await bot.exited;
    const tookMs = performance.now() - signalledAt;
    const log = await output();
    telegram.stop();

    expect(telegram.calls.get("sendMessage")).toBe(2);
    expect(code).toBe(0);
    expect(tookMs).toBeLessThan(8_000);
    expect(log).toContain("SIGTERM received");
    expect(log).toMatch(/Stopped after \d+ ms/);
  }, 20_000);

  test("exits within a couple of seconds when it is idle", async () => {
    const telegram = startFakeTelegram();
    const { bot } = await start(telegram.url);

    const signalledAt = performance.now();
    bot.kill("SIGTERM");
    const code = await bot.exited;
    const tookMs = performance.now() - signalledAt;
    telegram.stop();

    expect(code).toBe(0);
    expect(tookMs).toBeLessThan(3_000);
  }, 20_000);
});
