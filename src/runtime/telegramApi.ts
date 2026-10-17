import type { Transformer } from "grammy";

export interface ApiPolicy {
  /** Messages the bot may send per second, over all chats. Telegram's own limit is about 30. */
  sendsPerSecond: number;
  /** Tries per call, the first one included. */
  attempts: number;
  /** The longest "retry after" the bot will sit out. A longer one is given back as the error. */
  maxWaitMs: number;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const systemClock: Clock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// The calls Telegram counts against the limit on messages sent.
const PACED = new Set(["sendMessage", "sendDocument", "editMessageText", "setMessageReaction"]);

// Calls that do the same thing when they are made twice, so a server error or a
// lost connection can be tried again without answering a user twice. A
// sendMessage that failed with a 5xx may have been delivered.
const REPEATABLE = new Set([
  "editMessageText",
  "answerInlineQuery",
  "setMessageReaction",
  "setMyCommands",
  "getMe",
  "deleteWebhook",
]);

// Polling has its own back-off in grammY and must not be held up here.
const UNTOUCHED = new Set(["getUpdates"]);

const SERVER_ERROR_BACKOFF_MS = 250;

export interface ApiStats {
  /** Calls started and not yet finished, waiting for a turn or a retry included. */
  pending: number;
  /** Calls made again after Telegram said to wait. */
  rateLimited: number;
  /** Calls made again after a server error or a lost connection. */
  failedOver: number;
}

/**
 * Sits between the bot and Telegram. It spaces out the calls that send messages
 * so a burst cannot go over the limit and have most of its answers refused, and
 * it makes a call again when Telegram asks the bot to wait, once that wait is
 * over. When Telegram does say to wait, every paced call waits with it, not only
 * the one that was refused.
 */
export function createApiGuard(policy: ApiPolicy, clock: Clock = systemClock) {
  const interval = 1_000 / policy.sendsPerSecond;
  // The earliest moment the next paced call may go out.
  let nextSlot = 0;
  const stats: ApiStats = { pending: 0, rateLimited: 0, failedOver: 0 };

  async function takeTurn(): Promise<void> {
    const now = clock.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + interval;

    if (at > now) {
      await clock.sleep(at - now);
    }
  }

  function holdAll(ms: number): void {
    nextSlot = Math.max(nextSlot, clock.now() + ms);
  }

  const transformer: Transformer = async (previous, method, payload, signal) => {
    if (UNTOUCHED.has(method)) {
      return previous(method, payload, signal);
    }

    stats.pending++;
    try {
      for (let attempt = 1; ; attempt++) {
        if (PACED.has(method)) {
          await takeTurn();
        }

        let response;
        try {
          response = await previous(method, payload, signal);
        } catch (error) {
          if (attempt >= policy.attempts || !REPEATABLE.has(method) || signal?.aborted) {
            throw error;
          }
          stats.failedOver++;
          await clock.sleep(SERVER_ERROR_BACKOFF_MS * attempt);
          continue;
        }

        if (response.ok || attempt >= policy.attempts) {
          return response;
        }

        if (response.error_code === 429) {
          const waitMs = (response.parameters?.retry_after ?? 1) * 1_000;
          if (waitMs > policy.maxWaitMs) {
            return response;
          }
          stats.rateLimited++;
          holdAll(waitMs);
          await clock.sleep(waitMs);
          continue;
        }

        if (response.error_code >= 500 && REPEATABLE.has(method)) {
          stats.failedOver++;
          await clock.sleep(SERVER_ERROR_BACKOFF_MS * attempt);
          continue;
        }

        return response;
      }
    } finally {
      stats.pending--;
    }
  };

  return { transformer, stats };
}
