import type { Bot } from "grammy";

import type { SandboxExecution, SandboxService } from "../services/sandbox/types";
import type { ApiStats } from "./telegramApi";

/**
 * What the sandbox did since the reporter last looked. It counts the runs; it
 * never looks at the code or at what came out of it.
 */
export interface RunStats {
  /** Runs that finished since the last line. */
  runs: number;
  /** Runs that hit the time limit since the last line. */
  timedOut: number;
  /** The longest run since the last line, in milliseconds. */
  slowestMs: number;
}

export function createRunStats(): RunStats {
  return { runs: 0, timedOut: 0, slowestMs: 0 };
}

/** Hands every run to `sandbox` and counts it in `stats`. */
export function countRuns(sandbox: SandboxService, stats: RunStats): SandboxService {
  return {
    async execute(code: string): Promise<SandboxExecution> {
      const execution = await sandbox.execute(code);
      stats.runs++;
      if (execution.timedOut) {
        stats.timedOut++;
      }
      stats.slowestMs = Math.max(stats.slowestMs, execution.durationMs);
      return execution;
    },
    warmUp: () => sandbox.warmUp?.() ?? Promise.resolve(),
    dispose: () => sandbox.dispose?.(),
  };
}

/** What the bot did since the last line. */
export interface Interval {
  updates: number;
  /** The most calls to Telegram that were waiting at once. */
  peakPending: number;
  rateLimited: number;
  failedOver: number;
  runs: number;
  timedOut: number;
  slowestMs: number;
  rssMb: number;
}

export function formatStats(interval: Interval, seconds: number): string {
  return (
    `Last ${seconds}s: ${interval.updates} updates, ` +
    `most calls to Telegram waiting at once ${interval.peakPending}, ` +
    `${interval.rateLimited} waits for a 429, ${interval.failedOver} retries after an error, ` +
    `${interval.runs} runs, ${interval.timedOut} timed out, slowest ${interval.slowestMs} ms, ` +
    `${interval.rssMb} MB resident`
  );
}

/**
 * Counts the updates the bot is given and, each time `report` is called, prints
 * one line about the time since the last call, or nothing if the bot was idle.
 * It counts; it never looks at what an update or an answer contained.
 */
export function createStatsReporter(
  bot: Bot,
  api: ApiStats,
  runStats: RunStats,
  seconds: number,
  log: (line: string) => void = (line) => console.log(line),
) {
  let updates = 0;
  let rateLimited = api.rateLimited;
  let failedOver = api.failedOver;

  const handleUpdate = bot.handleUpdate.bind(bot);
  bot.handleUpdate = (update, envelope) => {
    updates++;
    return handleUpdate(update, envelope);
  };

  return function report(): void {
    const interval: Interval = {
      updates,
      peakPending: api.peakPending,
      rateLimited: api.rateLimited - rateLimited,
      failedOver: api.failedOver - failedOver,
      runs: runStats.runs,
      timedOut: runStats.timedOut,
      slowestMs: runStats.slowestMs,
      rssMb: Math.round(process.memoryUsage.rss() / 1024 / 1024),
    };

    updates = 0;
    rateLimited = api.rateLimited;
    failedOver = api.failedOver;
    api.peakPending = api.pending;
    runStats.runs = 0;
    runStats.timedOut = 0;
    runStats.slowestMs = 0;

    if (interval.updates > 0 || interval.rateLimited > 0 || interval.failedOver > 0) {
      log(formatStats(interval, seconds));
    }
  };
}

/** Prints a line about the bot every `seconds` while it is busy. */
export function logStatsPeriodically(bot: Bot, api: ApiStats, runStats: RunStats, seconds: number): void {
  setInterval(createStatsReporter(bot, api, runStats, seconds), seconds * 1_000).unref();
}
