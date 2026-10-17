import type { Bot } from "grammy";

import type { Clock } from "./telegramApi";

export interface ShutdownPolicy {
  /** The longest the bot waits for answers in progress before it gives up and exits. */
  graceMs: number;
  /**
   * How long nothing may have happened before the bot counts itself done. A run
   * has no call to Telegram to show for itself until it is over, so this has to
   * be longer than the slowest run, the time limit and the kill that follows it.
   */
  quietMs: number;
}

export interface Activity {
  /** Calls to Telegram that have been started and are not finished. */
  pending(): number;
  /** When one last started or finished. */
  lastAt(): number;
}

const POLL_MS = 25;

const systemClock: Clock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Waits until the bot has nothing left to answer: no call to Telegram is in
 * progress and none has started for `quietMs`. Updates already taken from
 * Telegram are confirmed to it when polling stops, so an answer that is not sent
 * before the process exits is never sent.
 */
export async function drain(
  activity: Activity,
  policy: ShutdownPolicy,
  signalledAt: number,
  clock: Clock = systemClock,
): Promise<"idle" | "gave-up"> {
  for (;;) {
    const now = clock.now();
    const quietFor = now - Math.max(signalledAt, activity.lastAt());

    if (activity.pending() === 0 && quietFor >= policy.quietMs) {
      return "idle";
    }
    if (now - signalledAt >= policy.graceMs) {
      return "gave-up";
    }

    await clock.sleep(POLL_MS);
  }
}

export interface ShutdownHooks {
  /** The bot, once there is one. A signal before that has nothing to stop. */
  bot(): Bot | undefined;
  activity: Activity;
  policy: ShutdownPolicy;
  exit?: (code: number) => void;
  log?: (line: string) => void;
  clock?: Clock;
}

/**
 * Stops polling when the process is asked to end, lets the answers in progress
 * go out, then exits. A second signal exits at once. Without this a deploy
 * killed the bot between taking a message from Telegram and answering it, and
 * Telegram does not send that message again.
 */
export function createShutdown(hooks: ShutdownHooks): (signal: string) => Promise<void> {
  const exit = hooks.exit ?? ((code) => process.exit(code));
  const log = hooks.log ?? ((line) => console.log(line));
  const clock = hooks.clock ?? systemClock;
  let started = false;

  return async (signal) => {
    if (started) {
      exit(1);
      return;
    }
    started = true;

    const bot = hooks.bot();
    if (!bot) {
      exit(0);
      return;
    }

    const signalledAt = clock.now();
    log(`${signal} received: no longer taking messages, finishing the ones in progress`);

    // The wait is bounded even if Telegram does not answer the call that stops polling.
    const bound = clock.sleep(hooks.policy.graceMs + 1_000).then(() => "bound" as const);
    const finished = (async () => {
      await bot.stop().catch((error: unknown) => {
        log(`Could not confirm the last update to Telegram: ${error instanceof Error ? error.message : "unknown error"}`);
      });
      return drain(hooks.activity, hooks.policy, signalledAt, clock);
    })();

    const outcome = await Promise.race([finished, bound]);
    const took = Math.round(clock.now() - signalledAt);

    if (outcome === "idle") {
      log(`Stopped after ${took} ms`);
      exit(0);
    } else {
      log(`Stopped after ${took} ms with ${hooks.activity.pending()} calls to Telegram unfinished`);
      exit(1);
    }
  };
}

/** Wires the shutdown to the signals a service manager sends. */
export function listenForShutdown(hooks: ShutdownHooks, signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"]): void {
  const shutdown = createShutdown(hooks);

  for (const signal of signals) {
    process.on(signal, () => void shutdown(signal));
  }
}
