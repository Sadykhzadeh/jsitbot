import { describe, expect, test } from "bun:test";

import { createApiGuard, type ApiPolicy } from "../src/runtime/telegramApi";
import { FakeClock, settle } from "./fakeClock";

const POLICY: ApiPolicy = { sendsPerSecond: 10, attempts: 3, maxWaitMs: 5_000, pollSlackMs: 50 };

const ok = { ok: true, result: true } as const;
const tooMany = (seconds: number) =>
  ({
    ok: false,
    error_code: 429,
    description: `Too Many Requests: retry after ${seconds}`,
    parameters: { retry_after: seconds },
  }) as const;
const failed = (code: number) => ({ ok: false, error_code: code, description: "boom" }) as const;

/** Runs `method` through the guard, with `answers` as what Telegram says to each try in turn. */
function setup(answers: Array<unknown> = []) {
  const clock = new FakeClock();
  const guard = createApiGuard(POLICY, clock);
  const tries: Array<{ method: string; at: number; chat?: unknown }> = [];

  const previous = async (method: string, payload: { chat_id?: unknown }) => {
    tries.push({ method, at: clock.now(), chat: payload.chat_id });
    const answer = answers.length > 0 ? answers.shift() : ok;
    if (answer instanceof Error) {
      throw answer;
    }
    return answer as never;
  };

  const call = (method: string, signal?: AbortSignal, chat?: number): Promise<unknown> =>
    guard.transformer(previous as never, method as never, { chat_id: chat } as never, signal as never);

  return { clock, guard, tries, call };
}

describe("pacing", () => {
  test("spaces out calls that send messages", async () => {
    const { clock, tries, call } = setup();

    const all = Promise.all([1, 2, 3, 4, 5].map(() => call("sendMessage")));
    await clock.advance(1_000);
    await all;

    expect(tries.map((t) => t.at)).toEqual([0, 100, 200, 300, 400]);
  });

  test("paces edits, reactions and files together with sends", async () => {
    const { clock, tries, call } = setup();

    const all = Promise.all([
      call("sendMessage"),
      call("editMessageText"),
      call("setMessageReaction"),
      call("sendDocument"),
    ]);
    await clock.advance(1_000);
    await all;

    expect(tries.map((t) => t.at)).toEqual([0, 100, 200, 300]);
  });

  test("lets a quiet bot send at once", async () => {
    const { clock, tries, call } = setup();

    await call("sendMessage");
    await clock.advance(5_000);
    await call("sendMessage");

    expect(tries.map((t) => t.at)).toEqual([0, 5_000]);
  });

  test("does not hold up inline answers or polling", async () => {
    const { tries, call } = setup();

    await Promise.all([call("answerInlineQuery"), call("answerInlineQuery"), call("getUpdates")]);

    expect(tries.map((t) => t.at)).toEqual([0, 0, 0]);
  });
});

describe("when Telegram says to wait", () => {
  test("makes the call again after the wait", async () => {
    const { clock, guard, tries, call } = setup([tooMany(2), ok]);

    const result = call("sendMessage");
    await clock.advance(1_999);
    expect(tries).toHaveLength(1);
    await clock.advance(1);

    expect(await result).toEqual(ok);
    expect(tries.map((t) => t.at)).toEqual([0, 2_000]);
    expect(guard.stats.rateLimited).toBe(1);
  });

  test("holds back the other sends to that chat, and only that chat", async () => {
    const { clock, tries, call } = setup([tooMany(2)]);

    const first = call("sendMessage", undefined, 1);
    await clock.advance(500);
    const sameChat = call("sendMessage", undefined, 1);
    const otherChat = call("sendMessage", undefined, 2);
    await clock.advance(5_000);
    await Promise.all([first, sameChat, otherChat]);

    // The refused chat is left alone for the two seconds Telegram named; the
    // other chat's answer did not have to wait for them.
    expect(tries.map((t) => [t.chat, t.at])).toEqual([
      [1, 0],
      [2, 500],
      [1, 2_000],
      [1, 2_100],
    ]);
  });

  test("gives the error back when the wait is longer than the bot will sit out", async () => {
    const { clock, tries, call } = setup([tooMany(60)]);

    const result = await call("sendMessage");
    await clock.advance(120_000);

    expect(result).toEqual(tooMany(60));
    expect(tries).toHaveLength(1);
  });

  test("gives up after the allowed number of tries", async () => {
    const { clock, tries, call } = setup([tooMany(1), tooMany(1), tooMany(1), ok]);

    const result = call("sendMessage");
    await clock.advance(10_000);

    expect(await result).toEqual(tooMany(1));
    expect(tries).toHaveLength(3);
  });

  test("waits for inline answers as well", async () => {
    const { clock, tries, call } = setup([tooMany(1), ok]);

    const result = call("answerInlineQuery");
    await clock.advance(1_000);

    expect(await result).toEqual(ok);
    expect(tries).toHaveLength(2);
  });
});

describe("server errors and lost connections", () => {
  test("tries a call that is safe to repeat again", async () => {
    const { clock, guard, tries, call } = setup([failed(502), ok]);

    const result = call("editMessageText");
    await clock.advance(1_000);

    expect(await result).toEqual(ok);
    expect(tries).toHaveLength(2);
    expect(guard.stats.failedOver).toBe(1);
  });

  test("tries such a call again after a network error, then rethrows", async () => {
    const { clock, tries, call } = setup([new Error("reset"), new Error("reset"), new Error("reset")]);

    const result = call("answerInlineQuery").catch((error: Error) => error.message);
    await clock.advance(5_000);

    expect(await result).toBe("reset");
    expect(tries).toHaveLength(3);
  });

  test("does not send a message twice because the first try may have gone through", async () => {
    const { tries, call } = setup([failed(502)]);

    expect(await call("sendMessage")).toEqual(failed(502));
    expect(tries).toHaveLength(1);

    const lost = setup([new Error("reset")]);
    await expect(lost.call("sendMessage")).rejects.toThrow("reset");
    expect(lost.tries).toHaveLength(1);
  });

  test("hands back an error that retrying cannot fix", async () => {
    const { tries, call } = setup([failed(400)]);

    expect(await call("editMessageText")).toEqual(failed(400));
    expect(tries).toHaveLength(1);
  });

  test("does not try again once the call was cancelled", async () => {
    const { tries, call } = setup([new Error("aborted")]);
    const controller = new AbortController();
    controller.abort();

    await expect(call("editMessageText", controller.signal)).rejects.toThrow("aborted");
    expect(tries).toHaveLength(1);
  });
});

describe("long polling", () => {
  test("gives up on a poll that nobody answers once its own timeout and the slack are over", async () => {
    const guard = createApiGuard(POLICY, new FakeClock());
    let signal: AbortSignal | undefined;
    const previous = (_method: string, _payload: unknown, given: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal = given;
        given.addEventListener("abort", () => reject(new Error("deadline")));
      });

    const result = guard.transformer(previous as never, "getUpdates", { timeout: 0 } as never, undefined);

    await expect(result).rejects.toThrow("deadline");
    expect(signal?.aborted).toBe(true);
  });

  test("still stops when the bot is stopped", async () => {
    const guard = createApiGuard({ ...POLICY, pollSlackMs: 60_000 }, new FakeClock());
    const stop = new AbortController();
    const previous = (_method: string, _payload: unknown, given: AbortSignal) =>
      new Promise((_resolve, reject) => given.addEventListener("abort", () => reject(new Error("stopped"))));

    const result = guard.transformer(previous as never, "getUpdates", { timeout: 30 } as never, stop.signal as never);
    stop.abort();

    await expect(result).rejects.toThrow("stopped");
  });

  test("is not paced or retried", async () => {
    const { tries, call } = setup([failed(502)]);

    expect(await call("getUpdates")).toEqual(failed(502));
    expect(tries).toHaveLength(1);
  });
});

describe("pending calls", () => {
  test("counts the calls that are waiting or in progress", async () => {
    const { clock, guard, call } = setup();

    const all = Promise.all([call("sendMessage"), call("sendMessage"), call("sendMessage")]);
    await settle();
    // The first went out at once; the other two wait for their turn.
    expect(guard.stats.pending).toBe(2);

    await clock.advance(1_000);
    await all;
    expect(guard.stats.pending).toBe(0);
  });

  test("does not leak a count when a call throws", async () => {
    const { guard, call } = setup([new Error("reset")]);

    await call("sendMessage").catch(() => undefined);

    expect(guard.stats.pending).toBe(0);
  });
});
