import { describe, expect, test } from "bun:test";

import { ReplyTracker } from "../src/bot/replyTracker";

describe("ReplyTracker", () => {
  test("finds what it was given, per chat and message", () => {
    const tracker = new ReplyTracker();

    tracker.remember(1, 10, { replyId: 100, code: "a" });
    tracker.remember(2, 10, { replyId: 200, code: "b" });

    expect(tracker.find(1, 10)).toEqual({ replyId: 100, code: "a" });
    expect(tracker.find(2, 10)).toEqual({ replyId: 200, code: "b" });
    expect(tracker.find(1, 11)).toBeUndefined();
  });

  test("replaces the entry when a message is answered again", () => {
    const tracker = new ReplyTracker();

    tracker.remember(1, 10, { replyId: 100, code: "a" });
    tracker.remember(1, 10, { replyId: 101, code: "b" });

    expect(tracker.find(1, 10)).toEqual({ replyId: 101, code: "b" });
  });

  test("forgets the oldest entries first once it is full", () => {
    const tracker = new ReplyTracker(3);

    for (let id = 1; id <= 4; id++) {
      tracker.remember(1, id, { replyId: id, code: String(id) });
    }

    expect(tracker.find(1, 1)).toBeUndefined();
    expect([2, 3, 4].map((id) => tracker.find(1, id)?.replyId)).toEqual([2, 3, 4]);
  });

  test("an answer that is updated counts as recent", () => {
    const tracker = new ReplyTracker(3);

    tracker.remember(1, 1, { replyId: 1, code: "1" });
    tracker.remember(1, 2, { replyId: 2, code: "2" });
    tracker.remember(1, 3, { replyId: 3, code: "3" });
    tracker.remember(1, 1, { replyId: 1, code: "1 again" });
    tracker.remember(1, 4, { replyId: 4, code: "4" });

    expect(tracker.find(1, 2)).toBeUndefined();
    expect(tracker.find(1, 1)?.code).toBe("1 again");
  });
});
