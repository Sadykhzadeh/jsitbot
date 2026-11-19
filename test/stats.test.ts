import { describe, expect, test } from "bun:test";
import type { Bot } from "grammy";

import { countRuns, createRunStats, createStatsReporter, formatStats } from "../src/runtime/stats";
import type { ApiStats } from "../src/runtime/telegramApi";
import type { SandboxExecution } from "../src/services/sandbox/types";

function setup() {
  const handled: number[] = [];
  const bot = {
    handleUpdate: async (update: { update_id: number }) => void handled.push(update.update_id),
  } as unknown as Bot;
  const api: ApiStats = { pending: 0, peakPending: 0, rateLimited: 0, failedOver: 0, lastActivityAt: 0 };
  const runs = createRunStats();
  const lines: string[] = [];
  const report = createStatsReporter(bot, api, runs, 60, (line) => void lines.push(line));

  return { bot, api, runs, lines, report, handled };
}

const feed = (bot: Bot, ...ids: number[]) =>
  Promise.all(ids.map((id) => bot.handleUpdate({ update_id: id } as never)));

describe("stats line", () => {
  test("counts updates and still hands them on", async () => {
    const { bot, lines, report, handled } = setup();

    await feed(bot, 1, 2, 3);
    report();

    expect(handled).toEqual([1, 2, 3]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Last 60s: 3 updates, /);
  });

  test("says nothing while the bot is idle", async () => {
    const { bot, lines, report } = setup();

    report();
    await feed(bot, 1);
    report();
    report();

    expect(lines).toHaveLength(1);
  });

  test("reports each interval on its own", async () => {
    const { bot, api, lines, report } = setup();

    await feed(bot, 1, 2);
    api.peakPending = 7;
    api.rateLimited = 2;
    api.failedOver = 1;
    report();
    await feed(bot, 3);
    api.rateLimited = 3;
    report();

    expect(lines[0]).toContain("2 updates, most calls to Telegram waiting at once 7, 2 waits for a 429, 1 retries after an error");
    expect(lines[1]).toContain("1 updates, most calls to Telegram waiting at once 0, 1 waits for a 429, 0 retries after an error");
  });

  test("speaks up when only retries happened", () => {
    const { api, lines, report } = setup();

    api.failedOver = 1;
    report();

    expect(lines).toHaveLength(1);
  });

  test("counts the runs of the interval, the timeouts and the slowest", async () => {
    const { bot, runs, lines, report } = setup();
    const finished = (durationMs: number, timedOut: boolean): SandboxExecution =>
      timedOut
        ? { ok: false, error: "InternalError: interrupted", logs: [], durationMs, timedOut, truncated: false }
        : { ok: true, result: "2", logs: [], durationMs, timedOut, truncated: false };
    const sandbox = countRuns(
      {
        execute: async (code: string) => (code === "spin" ? finished(700, true) : finished(3, false)),
      },
      runs,
    );

    await feed(bot, 1);
    await sandbox.execute("1 + 1");
    await sandbox.execute("spin");
    report();
    await feed(bot, 2);
    await sandbox.execute("1 + 1");
    report();

    expect(lines[0]).toContain("2 runs, 1 timed out, slowest 700 ms");
    expect(lines[1]).toContain("1 runs, 0 timed out, slowest 3 ms");
  });

  test("starts the next peak from what is waiting now", async () => {
    const { bot, api, lines, report } = setup();

    await feed(bot, 1);
    api.peakPending = 9;
    api.pending = 2;
    report();
    await feed(bot, 2);
    report();

    expect(lines[1]).toContain("waiting at once 2,");
  });
});

describe("formatStats", () => {
  test("is one line of counts", () => {
    const line = formatStats(
      { updates: 4, peakPending: 1, rateLimited: 0, failedOver: 0, runs: 3, timedOut: 1, slowestMs: 700, rssMb: 52 },
      60,
    );

    expect(line).toBe(
      "Last 60s: 4 updates, most calls to Telegram waiting at once 1, 0 waits for a 429, 0 retries after an error, 3 runs, 1 timed out, slowest 700 ms, 52 MB resident",
    );
  });
});
