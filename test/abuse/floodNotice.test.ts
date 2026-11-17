import { describe, expect, test } from "bun:test";

import { createPrivateAnswerer } from "../../src/bot/handlers/privateMessage";
import { ReplyTracker } from "../../src/bot/replyTracker";
import { SandboxTimeBudget, SlidingWindowRateLimiter } from "../../src/security/rateLimiter";
import type { SandboxExecution, SandboxService } from "../../src/services/sandbox/types";

const WINDOW_MS = 10_000;
const NOTICE = "Rate limit exceeded";

// Answers every run with "1" at once, so the only thing a test counts is the
// notices the answerer sends to a user over the limit.
const quickSandbox: SandboxService = {
  async execute(): Promise<SandboxExecution> {
    return { ok: true, logs: [], result: "1", durationMs: 0, timedOut: false, truncated: false };
  },
};

function setup() {
  let now = 1_000_000;
  const sent: Array<{ chat: number; text: string }> = [];
  const api = {
    async sendMessage(chat: number, text: string) {
      sent.push({ chat, text });
      return { message_id: sent.length };
    },
    async editMessageText(chat: number, _id: number, text: string) {
      sent.push({ chat, text });
      return true;
    },
    async deleteMessage() {
      return true;
    },
    async sendDocument() {
      return { message_id: 1 };
    },
  };
  const answerer = createPrivateAnswerer({
    sandbox: quickSandbox,
    rateLimiter: new SlidingWindowRateLimiter(),
    rateLimitPolicy: { windowMs: WINDOW_MS, maxRequests: 1 },
    timeBudget: new SandboxTimeBudget(),
    timeBudgetPolicy: { windowMs: WINDOW_MS, maxMs: 10_000_000 },
    maxCodeLength: 2_000,
    replies: new ReplyTracker(),
    clock: () => now,
  });

  /** One message from `user`: the first in a window runs, the second is over the limit. */
  async function message(user: number, messageId: number): Promise<void> {
    await answerer.send(api as never, { chatId: user, userId: user, messageId, code: "1" });
  }

  return {
    answerer,
    sent,
    at(ms: number) {
      now = ms;
    },
    message,
    notices: (user?: number) => sent.filter((call) => call.text.includes(NOTICE) && (user === undefined || call.chat === user)),
  };
}

describe("the notice to a user over the limit", () => {
  test("a refusal one millisecond before the window ends is silent", async () => {
    const t = setup();

    t.at(0);
    await t.message(1, 1); // allowed
    await t.message(1, 2); // refused: the notice
    t.at(WINDOW_MS - 1);
    await t.message(1, 3); // refused again: silent

    expect(t.notices(1)).toHaveLength(1);
  });

  test("a refusal at the moment the window ends gets a new notice", async () => {
    const t = setup();

    t.at(0);
    await t.message(1, 1);
    await t.message(1, 2);
    t.at(WINDOW_MS - 1);
    await t.message(1, 3);
    t.at(WINDOW_MS);
    await t.message(1, 4); // the window has reopened: allowed
    await t.message(1, 5); // refused again, and the notice is due

    expect(t.notices(1)).toHaveLength(2);
  });

  test("ten thousand distinct users in one window each get one notice, and the record is swept after the window", async () => {
    const t = setup();
    const users = 10_000;

    for (let user = 1; user <= users; user++) {
      t.at(user); // all within one window
      await t.message(user, 1);
      await t.message(user, 2);
    }
    expect(t.notices()).toHaveLength(users);
    expect(t.answerer.notified()).toBe(users);

    // Past the window, one new notice sweeps everything that has expired.
    t.at(users + WINDOW_MS);
    await t.message(users + 1, 1);
    await t.message(users + 1, 2);

    expect(t.notices()).toHaveLength(users + 1);
    expect(t.answerer.notified()).toBe(1);
  });
});
