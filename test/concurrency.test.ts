import { describe, expect, test } from "bun:test";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";

import { handleConcurrently } from "../src/bot/concurrency";
import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";
import type { SandboxService } from "../src/services/sandbox/types";
import { createHarness } from "./helpers/botHarness";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createBot(policy: { limit: number; perUser: number }) {
  const bot = new Bot("1:test", {
    botInfo: { id: 1, is_bot: true, first_name: "B", username: "b" } as UserFromGetMe,
  });
  const errors: unknown[] = [];
  bot.catch((error) => {
    errors.push(error.error);
  });
  bot.use(handleConcurrently(bot, policy));

  let nextId = 1;
  const message = (userId: number, text: string): Update => ({
    update_id: nextId++,
    message: {
      message_id: nextId,
      date: 0,
      chat: { id: userId, type: "private", first_name: "U" },
      from: { id: userId, is_bot: false, first_name: "U" },
      text,
    },
  });

  /** What the polling loop does: hand updates over one after the other. */
  async function poll(...updates: Update[]): Promise<void> {
    for (const update of updates) {
      await bot.handleUpdate(update);
    }
  }

  return { bot, errors, message, poll };
}

async function until(condition: () => boolean, limitMs = 3_000): Promise<void> {
  const startedAt = performance.now();
  while (!condition()) {
    if (performance.now() - startedAt > limitMs) {
      throw new Error("Timed out waiting for the handlers");
    }
    await sleep(2);
  }
}

describe("handling updates concurrently", () => {
  test("updates from different users are handled at the same time", async () => {
    const { bot, message, poll } = createBot({ limit: 8, perUser: 3 });
    const done: string[] = [];
    bot.on("message:text", async (ctx) => {
      await sleep(60);
      done.push(ctx.message.text);
    });

    const startedAt = performance.now();
    await poll(...Array.from({ length: 8 }, (_, user) => message(user + 1, `from ${user + 1}`)));
    await until(() => done.length === 8);

    // Eight handlers of 60 ms one after the other would take at least 480 ms, because a
    // sleep never ends early. Anything below that was concurrent; the rest is machine load.
    expect(performance.now() - startedAt).toBeLessThan(450);
  });

  test("one user's updates run one after the other, in the order they came", async () => {
    const { bot, message, poll } = createBot({ limit: 8, perUser: 3 });
    const log: string[] = [];
    bot.on("message:text", async (ctx) => {
      log.push(`start ${ctx.message.text}`);
      await sleep(ctx.message.text === "first" ? 40 : 5);
      log.push(`end ${ctx.message.text}`);
    });

    await poll(message(7, "first"), message(7, "second"), message(7, "third"));
    await until(() => log.length === 6);

    expect(log).toEqual(["start first", "end first", "start second", "end second", "start third", "end third"]);
  });

  test("a slow update from one user does not hold up another user", async () => {
    const { bot, message, poll } = createBot({ limit: 8, perUser: 3 });
    const finished: string[] = [];
    bot.on("message:text", async (ctx) => {
      await sleep(ctx.message.text === "slow" ? 150 : 1);
      finished.push(ctx.message.text);
    });

    await poll(message(1, "slow"), message(2, "quick"));
    await until(() => finished.length === 2);

    expect(finished).toEqual(["quick", "slow"]);
  });

  test("never has more than the limit in progress, and polling waits for a place", async () => {
    const { bot, message, poll } = createBot({ limit: 2, perUser: 3 });
    let active = 0;
    let mostActive = 0;
    const done: number[] = [];
    bot.on("message:text", async () => {
      active++;
      mostActive = Math.max(mostActive, active);
      await sleep(40);
      active--;
      done.push(1);
    });

    await poll(message(1, "a"), message(2, "b"));

    let thirdAccepted = false;
    const third = poll(message(3, "c")).then(() => {
      thirdAccepted = true;
    });
    await sleep(15);
    expect(thirdAccepted).toBe(false);

    await third;
    await until(() => done.length === 3);
    expect(mostActive).toBe(2);
  });

  test("drops what a user sends beyond the per-user limit", async () => {
    const { bot, message, poll } = createBot({ limit: 8, perUser: 3 });
    const handled: string[] = [];
    bot.on("message:text", async (ctx) => {
      await sleep(30);
      handled.push(ctx.message.text);
    });

    await poll(...["1", "2", "3", "4", "5"].map((text) => message(5, text)), message(6, "other user"));
    await until(() => handled.length === 4);
    await sleep(60);

    expect([...handled].sort()).toEqual(["1", "2", "3", "other user"]);
  });

  test("drops a user's updates beyond the per-user limit even while every place is taken", async () => {
    const { bot, message, poll } = createBot({ limit: 1, perUser: 3 });
    const handled: string[] = [];
    bot.on("message:text", async (ctx) => {
      await sleep(ctx.message.text === "holder" ? 80 : 5);
      handled.push(ctx.message.text);
    });

    void poll(message(2, "holder"));
    await sleep(5);
    await poll(...["1", "2", "3", "4", "5"].map((text) => message(1, text)));
    await sleep(300);

    expect(handled.filter((text) => text !== "holder")).toEqual(["1", "2", "3"]);
  });

  test("one user's queued updates do not keep the other places from a different user", async () => {
    const { bot, message, poll } = createBot({ limit: 2, perUser: 3 });
    const finished: string[] = [];
    bot.on("message:text", async (ctx) => {
      await sleep(ctx.message.text.startsWith("slow") ? 60 : 5);
      finished.push(ctx.message.text);
    });

    await poll(message(1, "slow a"), message(1, "slow b"), message(1, "slow c"));
    await poll(message(2, "quick"));
    await until(() => finished.length === 4);

    expect(finished.indexOf("quick")).toBeLessThan(finished.indexOf("slow b"));
  });

  test("a user can send again once earlier updates have finished", async () => {
    const { bot, message, poll } = createBot({ limit: 8, perUser: 1 });
    const handled: string[] = [];
    bot.on("message:text", async (ctx) => {
      await sleep(10);
      handled.push(ctx.message.text);
    });

    await poll(message(5, "one"), message(5, "dropped"));
    await until(() => handled.length === 1);
    await poll(message(5, "two"));
    await until(() => handled.length === 2);

    expect(handled).toEqual(["one", "two"]);
  });

  test("an error in a handler goes to the bot's error handler and the bot carries on", async () => {
    const { bot, errors, message, poll } = createBot({ limit: 8, perUser: 3 });
    const handled: string[] = [];
    bot.on("message:text", async (ctx) => {
      if (ctx.message.text === "boom") {
        throw new Error("handler failed");
      }
      handled.push(ctx.message.text);
    });

    await poll(message(1, "boom"), message(1, "after"), message(2, "other"));
    await until(() => handled.length === 2 && errors.length === 1);

    expect((errors[0] as Error).message).toBe("handler failed");
    expect(handled.sort()).toEqual(["after", "other"]);
  });

  test("updates without a sender are not held to a per-user limit", async () => {
    const { bot, poll } = createBot({ limit: 8, perUser: 1 });
    let handled = 0;
    bot.on("channel_post", async () => {
      await sleep(10);
      handled++;
    });

    const post = (id: number): Update => ({
      update_id: 100 + id,
      channel_post: { message_id: id, date: 0, chat: { id: -1, type: "channel", title: "c" }, text: "x" },
    });
    await poll(post(1), post(2), post(3));
    await until(() => handled === 3);
  });
});

describe("with the real handlers", () => {
  const policy = { limit: 8, perUser: 3 };

  /** The real sandbox, slowed down so a run is still going when the next update arrives. */
  function slowSandbox(delayMs: number): SandboxService {
    const real = new QuickJsSandboxService();
    return {
      async execute(code) {
        await sleep(delayMs);
        return real.execute(code);
      },
    };
  }

  test("an edit that arrives during a run changes that run's reply instead of sending a second one", async () => {
    const harness = createHarness({ concurrency: policy, sandbox: slowSandbox(60) });

    await harness.sendMessage("1 + 1", 5);
    await harness.editMessage("20 + 22", 5);
    await until(() => harness.callsTo("editMessageText").length === 1);

    expect(harness.callsTo("sendMessage")).toHaveLength(1);
    expect(harness.callsTo("editMessageText")[0].payload.text).toContain("42");
  });

  test("answers many users in the time Telegram needs for a few", async () => {
    const harness = createHarness({ concurrency: policy, apiLatencyMs: 40 });

    const startedAt = performance.now();
    for (let user = 1; user <= 16; user++) {
      await harness.sendMessage(`${user} * 2`, 1, 1_000 + user);
    }
    await until(() => harness.callsTo("sendMessage").length === 16);
    const elapsed = performance.now() - startedAt;

    const answers = harness.callsTo("sendMessage").map((call) => call.payload.chat_id);
    expect(new Set(answers).size).toBe(16);
    // One after the other it takes at least 16 x 40 ms = 640 ms of waiting for Telegram,
    // so anything below that was concurrent; the rest is machine load.
    expect(elapsed).toBeLessThan(600);
  });
});
