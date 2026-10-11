import { describe, expect, test } from "bun:test";

import { BOT_ID, USER_ID, createHarness } from "./helpers/botHarness";

describe("private messages", () => {
  test("runs the code in an ordinary message and replies to it", async () => {
    const harness = createHarness();

    await harness.sendMessage("6 * 7", 77);

    const replies = harness.callsTo("sendMessage");
    expect(replies).toHaveLength(1);
    expect(replies[0].payload.chat_id).toBe(USER_ID);
    expect(replies[0].payload.text).toContain("*Result*");
    expect(replies[0].payload.text).toContain("42");
    expect(replies[0].payload.reply_parameters).toEqual({ message_id: 77 });
    expect(replies[0].payload.parse_mode).toBe("MarkdownV2");
  });

  test("shows errors the same way", async () => {
    const harness = createHarness();

    await harness.sendMessage("null.name");

    const [reply] = harness.callsTo("sendMessage");
    expect(reply.payload.text).toContain("*Error*");
    expect(reply.payload.text).toContain("TypeError");
  });

  test("reacts to a result that was sent from inline mode instead of running it", async () => {
    const harness = createHarness();

    await harness.bot.handleUpdate({
      update_id: 500,
      message: {
        message_id: 9,
        date: 0,
        chat: { id: USER_ID, type: "private", first_name: "Tester" },
        from: { id: USER_ID, is_bot: false, first_name: "Tester" },
        via_bot: { id: BOT_ID, is_bot: true, first_name: "JS", username: "jsitbot" },
        text: "*Code*\n1 + 1",
      },
    });

    expect(harness.callsTo("sendMessage")).toHaveLength(0);
    expect(harness.callsTo("setMessageReaction")).toHaveLength(1);
  });

  test("tells a user who is over the rate limit instead of running the code", async () => {
    const harness = createHarness({ maxRequests: 2 });

    await harness.sendMessage("1", 1);
    await harness.sendMessage("2", 2);
    await harness.sendMessage("3", 3);

    const replies = harness.callsTo("sendMessage");
    expect(replies).toHaveLength(3);
    expect(replies[2].payload.text).toContain("Rate limit exceeded");
  });

  test("rejects code over the length limit without running it", async () => {
    const harness = createHarness();

    await harness.sendMessage("1".repeat(2_001));

    const [reply] = harness.callsTo("sendMessage");
    expect(reply.payload.text).toContain("exceeds the 2000-character limit");
  });
});
