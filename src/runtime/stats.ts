import type { Bot } from "grammy";

import type { ApiStats } from "./telegramApi";

/** What the bot did since the last line. */
export interface Interval {
  updates: number;
  /** The most calls to Telegram that were waiting at once. */
  peakPending: number;
  rateLimited: number;
  failedOver: number;
  rssMb: number;
}

export function formatStats(interval: Interval, seconds: number): string {
  return (
    `Last ${seconds}s: ${interval.updates} updates, ` +
    `most calls to Telegram waiting at once ${interval.peakPending}, ` +
    `${interval.rateLimited} waits for a 429, ${interval.failedOver} retries after an error, ` +
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
      rssMb: Math.round(process.memoryUsage.rss() / 1024 / 1024),
    };

    updates = 0;
    rateLimited = api.rateLimited;
    failedOver = api.failedOver;
    api.peakPending = api.pending;

    if (interval.updates > 0 || interval.rateLimited > 0 || interval.failedOver > 0) {
      log(formatStats(interval, seconds));
    }
  };
}

/** Prints a line about the bot every `seconds` while it is busy. */
export function logStatsPeriodically(bot: Bot, api: ApiStats, seconds: number): void {
  setInterval(createStatsReporter(bot, api, seconds), seconds * 1_000).unref();
}
