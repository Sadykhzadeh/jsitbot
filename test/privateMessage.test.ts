import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";
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
    expect(replies[0].payload.reply_parameters).toEqual({ message_id: 77, allow_sending_without_reply: true });
    expect(replies[0].payload.parse_mode).toBe("MarkdownV2");
  });

  test("still answers when the message it replies to has been deleted meanwhile", async () => {
    const harness = createHarness({ deletedReplyTargets: true });

    await harness.sendMessage("6 * 7", 77);

    const [reply] = harness.callsTo("sendMessage");
    expect(reply.payload.reply_parameters.allow_sending_without_reply).toBe(true);
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

describe("edited messages", () => {
  test("updates the earlier answer instead of sending another", async () => {
    const harness = createHarness();

    await harness.sendMessage("1 + 1", 5);
    const [first] = harness.callsTo("sendMessage");

    await harness.editMessage("20 + 22", 5);

    expect(harness.callsTo("sendMessage")).toHaveLength(1);
    const [edit] = harness.callsTo("editMessageText");
    expect(edit.payload.chat_id).toBe(USER_ID);
    expect(edit.payload.message_id).toBe(1_000);
    expect(edit.payload.text).toContain("42");
    expect(edit.payload.text).toContain("20 + 22");
    expect(edit.payload.parse_mode).toBe("MarkdownV2");
    expect(first.payload.text).toContain("*Result*");
  });

  test("keeps updating the same answer across several edits", async () => {
    const harness = createHarness();

    await harness.sendMessage("1", 5);
    await harness.editMessage("2", 5);
    await harness.editMessage("3", 5);

    const edits = harness.callsTo("editMessageText");
    expect(edits.map((edit) => edit.payload.message_id)).toEqual([1_000, 1_000]);
    expect(edits[1].payload.text).toContain("3");
  });

  test("keeps answers to different messages apart", async () => {
    const harness = createHarness();

    await harness.sendMessage("1", 5);
    await harness.sendMessage("2", 6);
    await harness.editMessage("20", 5);
    await harness.editMessage("30", 6);

    const edits = harness.callsTo("editMessageText");
    expect(edits.map((edit) => edit.payload.message_id)).toEqual([1_000, 1_001]);
  });

  test("does nothing when the text did not change", async () => {
    const harness = createHarness();

    await harness.sendMessage("1 + 1", 5);
    await harness.editMessage("1 + 1", 5);

    expect(harness.callsTo("editMessageText")).toHaveLength(0);
    expect(harness.callsTo("sendMessage")).toHaveLength(1);
  });

  test("answers an edit the bot has no record of as a new message", async () => {
    const harness = createHarness();

    await harness.editMessage("6 * 7", 5);

    expect(harness.callsTo("editMessageText")).toHaveLength(0);
    const [reply] = harness.callsTo("sendMessage");
    expect(reply.payload.text).toContain("42");
    expect(reply.payload.reply_parameters).toEqual({ message_id: 5, allow_sending_without_reply: true });
  });

  test("sends a new answer when the old one can no longer be edited", async () => {
    const harness = createHarness({
      failures: { editMessageText: "Bad Request: message to edit not found" },
    });

    await harness.sendMessage("1", 5);
    await harness.editMessage("2", 5);

    expect(harness.callsTo("sendMessage")).toHaveLength(2);
    expect(harness.callsTo("sendMessage")[1].payload.text).toContain("*Result*");
  });

  test("does not send a second answer when Telegram fails to make the edit", async () => {
    const harness = createHarness({
      failures: { editMessageText: "Bad Gateway" },
      failureCodes: { editMessageText: 502 },
    });

    await harness.sendMessage("1", 5);
    await harness.editMessage("2", 5).catch(() => undefined);

    expect(harness.callsTo("sendMessage")).toHaveLength(1);
  });

  test("does not send a second answer when the edit is held back by the rate limit", async () => {
    const harness = createHarness({
      failures: { editMessageText: "Too Many Requests: retry after 600" },
      failureCodes: { editMessageText: 429 },
    });

    await harness.sendMessage("1", 5);
    await harness.editMessage("2", 5).catch(() => undefined);

    expect(harness.callsTo("sendMessage")).toHaveLength(1);
  });

  test("does not repeat an answer Telegram says is already up to date", async () => {
    const harness = createHarness({
      failures: {
        editMessageText:
          "Bad Request: message is not modified: specified new message content and reply markup are exactly the same",
      },
    });

    await harness.sendMessage("1", 5);
    await harness.editMessage("1 ", 5);

    expect(harness.callsTo("editMessageText")).toHaveLength(1);
    expect(harness.callsTo("sendMessage")).toHaveLength(1);
  });

  test("ignores an edit that turns the message into a command", async () => {
    const harness = createHarness();

    await harness.sendMessage("1", 5);
    await harness.editMessage("/start", 5);

    expect(harness.callsTo("editMessageText")).toHaveLength(0);
  });

  test("counts an edit against the rate limit", async () => {
    const harness = createHarness({ maxRequests: 2 });

    await harness.sendMessage("1", 5);
    await harness.editMessage("2", 5);
    await harness.editMessage("3", 5);

    const edits = harness.callsTo("editMessageText");
    expect(edits).toHaveLength(2);
    expect(edits[1].payload.text).toContain("Rate limit exceeded");
  });

  test("shows the length limit on the earlier answer", async () => {
    const harness = createHarness();

    await harness.sendMessage("1", 5);
    await harness.editMessage("2".repeat(2_001), 5);

    const [edit] = harness.callsTo("editMessageText");
    expect(edit.payload.text).toContain("exceeds the 2000-character limit");
  });
});

describe("runs that time out", () => {
  test("cost more of the rate limit than ordinary ones", async () => {
    const harness = createHarness({
      maxRequests: 4,
      sandbox: new QuickJsSandboxService({ timeoutMs: 100 }),
    });

    await harness.sendMessage("while (true) {}", 1);
    await harness.sendMessage("1", 2);
    await harness.sendMessage("2", 3);

    const replies = harness.callsTo("sendMessage").map((call) => call.payload.text as string);
    expect(replies[0]).toContain("timed out");
    expect(replies[1]).toContain("*Result*");
    expect(replies[2]).toContain("Rate limit exceeded");
  });

  test("leave ordinary runs at one request each", async () => {
    const harness = createHarness({ maxRequests: 4 });

    for (let message = 1; message <= 4; message++) {
      await harness.sendMessage(String(message), message);
    }

    const replies = harness.callsTo("sendMessage").map((call) => call.payload.text as string);
    expect(replies.every((text) => text.includes("*Result*"))).toBe(true);
  });
});

describe("code in a fence", () => {
  test("is run without the fence and the language name", async () => {
    const harness = createHarness();

    await harness.sendMessage("```js\nconst n = 20;\nn + 22\n```", 3);

    const [reply] = harness.callsTo("sendMessage");
    expect(reply.payload.text).toContain("*Result*\n```\n42\n```");
    expect(reply.payload.text).not.toContain("not a function");
  });

  test("is stripped in an edit as well", async () => {
    const harness = createHarness();

    await harness.sendMessage("1", 3);
    await harness.editMessage("```\n6 * 7\n```", 3);

    const [edit] = harness.callsTo("editMessageText");
    expect(edit.payload.text).toContain("*Result*\n```\n42\n```");
  });
});

describe("code over the length limit", () => {
  test("is told how long it is", async () => {
    const harness = createHarness();

    await harness.sendMessage("1".repeat(2_345));

    const [reply] = harness.callsTo("sendMessage");
    expect(reply.payload.text).toContain("exceeds the 2000-character limit (yours has 2345)");
  });
});
