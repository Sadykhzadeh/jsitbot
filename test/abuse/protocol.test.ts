import { afterAll, describe, expect, test } from "bun:test";

import { createHarness, type HarnessOptions } from "../helpers/botHarness";
import { createPool, expectHealthy } from "./support";

// Messages as Telegram would deliver them, through the real handlers, with the
// process sandbox behind them and the API replaced by the harness's recorder.
// Every case must leave the bot running and the sandbox healthy.
const pool = createPool();
const concurrency = { limit: 8, perUser: 3 };

function harness(options: Omit<HarnessOptions, "sandbox"> = {}) {
  return createHarness({ sandbox: pool, runCommand: true, ...options });
}

function texts(calls: Array<{ payload: Record<string, any> }>): string[] {
  return calls.map((call) => String(call.payload.text ?? ""));
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterAll(() => pool.dispose());

describe("message length", () => {
  test("code at the 2000-character limit runs", async () => {
    const code = "1" + " ".repeat(1_999);
    const h = harness();

    await h.sendMessage(code, 1);

    expect(texts(h.callsTo("sendMessage")).join("")).toContain("*Result*");
    expect(texts(h.callsTo("sendMessage")).join("")).not.toContain("Rejected");
    await expectHealthy(pool);
  });

  test("code one character over the limit is refused without running", async () => {
    const h = harness();

    await h.sendMessage("1" + " ".repeat(2_000), 1);

    const sent = texts(h.callsTo("sendMessage")).join("");
    expect(sent).toContain("Code exceeds the 2000-character limit (yours has 2001).");
    expect(sent).not.toContain("*Result*");
    await expectHealthy(pool);
  });
});

describe("messages with no code", () => {
  test("whitespace only gets the usage text, not a run", async () => {
    const h = harness();

    await h.sendMessage("   \n\t  ", 1);

    const sent = texts(h.callsTo("sendMessage")).join("");
    expect(sent).toContain("Send");
    expect(sent).not.toContain("*Result*");
    await expectHealthy(pool);
  });

  test("only a comment is an empty program, and it still gets an answer", async () => {
    const h = harness();

    await h.sendMessage("// nothing to run here", 1);

    expect(texts(h.callsTo("sendMessage")).join("")).toContain("*Result*");
    await expectHealthy(pool);
  });
});

describe("many users", () => {
  test("fifty users at once each get their own answer, none of them limited", async () => {
    const h = harness({ concurrency, maxRequests: 5 });

    for (let user = 1; user <= 50; user++) {
      void h.sendMessage(`${user} * 2`, 1, 1_000 + user);
    }
    await h.settled();
    await pause(300);
    await h.settled();

    const sends = h.callsTo("sendMessage");
    expect(new Set(sends.map((call) => call.payload.chat_id)).size).toBe(50);
    expect(texts(sends).join("")).not.toContain("Rate limit");
    await expectHealthy(pool);
  });
});

describe("inline queries", () => {
  test("hostile query text is answered, never thrown", async () => {
    const h = harness();
    const queries = [
      "'<b>' `x` ](http://a) ‮\u0000 " + "q".repeat(150),
      "```\n" + "x".repeat(200),
      "\\\\\\ ` * _ [ ] ( ) ~ > # + - = | { } . !",
      "ab",
      "1 + 1",
    ];

    for (const query of queries) {
      await h.inlineQuery(query, 5);
    }

    expect(h.callsTo("answerInlineQuery")).toHaveLength(queries.length);
    await expectHealthy(pool);
  });
});

describe("commands and entities", () => {
  test("a command addressed to another bot is not run", async () => {
    const h = harness();

    await groupText(h, "/run@some_other_bot 1 + 1", 1);

    expect(h.callsTo("sendMessage")).toHaveLength(0);
    await expectHealthy(pool);
  });

  test("/run in a photo caption is not a command", async () => {
    const h = harness();

    await h.bot.handleUpdate({
      update_id: 900,
      message: {
        message_id: 3,
        date: 0,
        chat: { id: -100, type: "supergroup", title: "g" },
        from: { id: 42, is_bot: false, first_name: "T" },
        photo: [{ file_id: "f", file_unique_id: "u", width: 1, height: 1 }],
        caption: "/run 1 + 1",
      },
    } as any);

    expect(h.callsTo("sendMessage")).toHaveLength(0);
    await expectHealthy(pool);
  });

  test("/run replying to a captioned photo runs the code block in its caption", async () => {
    const h = harness();

    await h.bot.handleUpdate({
      update_id: 901,
      message: {
        message_id: 10,
        date: 0,
        chat: { id: -100, type: "supergroup", title: "g" },
        from: { id: 43, is_bot: false, first_name: "U" },
        photo: [{ file_id: "f", file_unique_id: "u", width: 1, height: 1 }],
        caption: "look: 6 * 7",
        caption_entities: [{ type: "pre", offset: 6, length: 6 }],
      },
    } as any);
    await groupText(h, "/run", 11, {
      reply_to_message: {
        message_id: 10,
        date: 0,
        chat: { id: -100, type: "supergroup", title: "g" },
        from: { id: 43, is_bot: false, first_name: "U" },
        caption: "look: 6 * 7",
        caption_entities: [{ type: "pre", offset: 6, length: 6 }],
      },
    });

    const sent = texts(h.callsTo("sendMessage")).join("");
    expect(sent).toContain("42");
    await expectHealthy(pool);
  });

  test("a forwarded message is run like any other text", async () => {
    const h = harness();

    await h.bot.handleUpdate({
      update_id: 902,
      message: {
        message_id: 4,
        date: 0,
        chat: { id: 42, type: "private", first_name: "T" },
        from: { id: 42, is_bot: false, first_name: "T" },
        forward_origin: { type: "user", date: 0, sender_user: { id: 9, is_bot: false, first_name: "X" } },
        text: "2 * 3",
      },
    } as any);

    expect(texts(h.callsTo("sendMessage")).join("")).toContain("6");
    await expectHealthy(pool);
  });

  test("a group message with no sender is ignored without an error", async () => {
    const h = harness();

    await h.bot.handleUpdate({
      update_id: 903,
      message: {
        message_id: 5,
        date: 0,
        chat: { id: -100, type: "supergroup", title: "g" },
        text: "/run 1 + 1",
      },
    } as any);

    expect(h.callsTo("sendMessage")).toHaveLength(0);
    await expectHealthy(pool);
  });
});

async function groupText(
  h: ReturnType<typeof createHarness>,
  text: string,
  messageId: number,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await h.bot.handleUpdate({
    update_id: 800 + messageId,
    message: {
      message_id: messageId,
      date: 0,
      chat: { id: -100, type: "supergroup", title: "g" },
      from: { id: 42, is_bot: false, first_name: "T" },
      text,
      ...extra,
    },
  } as any);
}
