import { describe, expect, test } from "bun:test";
import { Bot } from "grammy";
import type { Message, MessageEntity, Update, UserFromGetMe } from "grammy/types";

import { addressedCode, registerRunCommandHandler } from "../src/bot/handlers/runCommand";
import { registerPrivateMessageHandler } from "../src/bot/handlers/privateMessage";
import { SandboxTimeBudget, SlidingWindowRateLimiter } from "../src/security/rateLimiter";
import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const BOT_ID = 999;
type ReplyMessage = NonNullable<Message["reply_to_message"]>;

const GROUP_ID = -100123;
const sandbox = new QuickJsSandboxService();

function createBotUnderTest(options: { maxRequests?: number } = {}) {
  const bot = new Bot("1:test", {
    botInfo: {
      id: BOT_ID,
      is_bot: true,
      first_name: "JS",
      username: "jsitbot",
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: true,
    } as UserFromGetMe,
  });
  const calls: { method: string; payload: Record<string, any> }[] = [];
  let nextSentId = 5_000;
  bot.api.config.use(async (_previous, method, payload) => {
    calls.push({ method, payload: payload as Record<string, any> });
    return { ok: true, result: { message_id: nextSentId++, date: 0, chat: { id: 1, type: "private" } } } as any;
  });

  const shared = {
    sandbox,
    rateLimiter: new SlidingWindowRateLimiter(),
    rateLimitPolicy: { windowMs: 10_000, maxRequests: options.maxRequests ?? 1_000 },
    timeBudget: new SandboxTimeBudget(),
    timeBudgetPolicy: { windowMs: 10_000, maxMs: 10_000_000 },
    maxCodeLength: 2_000,
  };
  registerRunCommandHandler(bot, { ...shared, botUsername: "jsitbot" });
  registerPrivateMessageHandler(bot, { ...shared, botUserId: BOT_ID });

  let updateId = 1;
  let messageId = 10;
  return {
    sent: () => calls.filter((call) => call.method === "sendMessage").map((call) => call.payload),
    documents: () => calls.filter((call) => call.method === "sendDocument").map((call) => ({ payload: call.payload })),

    async say(
      text: string,
      extra: { chat?: "group" | "private"; replyTo?: Partial<Message>; entities?: MessageEntity[]; userId?: number } = {},
    ): Promise<number> {
      const id = messageId++;
      const userId = extra.userId ?? 42;
      const chat =
        extra.chat === "private"
          ? { id: userId, type: "private" as const, first_name: "T" }
          : { id: GROUP_ID, type: "supergroup" as const, title: "Chat" };
      await bot.handleUpdate({
        update_id: updateId++,
        message: {
          message_id: id,
          date: 0,
          chat,
          from: { id: userId, is_bot: false, first_name: "T" },
          text,
          ...(extra.entities ? { entities: extra.entities } : {}),
          ...(extra.replyTo ? { reply_to_message: { message_id: 1, date: 0, chat, ...extra.replyTo } } : {}),
        },
      } as Update);
      return id;
    },
  };
}

describe("addressedCode", () => {
  const message = (text: string, rest: Partial<Message> = {}) =>
    ({ message_id: 1, date: 0, chat: { id: 1, type: "supergroup", title: "t" }, text, ...rest }) as Message;

  test("takes the code after /run, /run@bot and @bot", () => {
    expect(addressedCode(message("/run 1 + 1"), "jsitbot")).toEqual({ code: "1 + 1" });
    expect(addressedCode(message("/run@jsitbot 1 + 1"), "jsitbot")).toEqual({ code: "1 + 1" });
    expect(addressedCode(message("/run@JSitBot 1 + 1"), "jsitbot")).toEqual({ code: "1 + 1" });
    expect(addressedCode(message("@jsitbot 1 + 1"), "jsitbot")).toEqual({ code: "1 + 1" });
    expect(addressedCode(message("@JSitBot\nconst a = 2;\na * 3"), "jsitbot")).toEqual({ code: "const a = 2;\na * 3" });
  });

  test("takes code that is written in a fence", () => {
    expect(addressedCode(message("/run ```js\n1 + 1\n```"), "jsitbot")).toEqual({ code: "1 + 1" });
  });

  test("leaves everything else alone", () => {
    for (const text of ["1 + 1", "hello @jsitbot", "/runaway 1", "/run@other_bot 1", "@jsitbotx 1", "/start", "/ru"]) {
      expect(addressedCode(message(text), "jsitbot")).toBeUndefined();
    }
  });

  test("falls back to the text of the message that is replied to", () => {
    const quoted = message("[1, 2].length", { from: { id: 7, is_bot: false, first_name: "A" } });

    expect(addressedCode(message("/run", { reply_to_message: quoted as ReplyMessage }), "jsitbot")).toEqual({ code: "[1, 2].length" });
    expect(addressedCode(message("@jsitbot", { reply_to_message: quoted as ReplyMessage }), "jsitbot")).toEqual({
      code: "[1, 2].length",
    });
  });

  test("prefers the first code block of the message that is replied to", () => {
    const text = "try this:\nlet a = 1;\na + 1\nthanks";
    const quoted = message(text, { entities: [{ type: "pre", offset: 10, length: 16 }] });

    expect(addressedCode(message("/run", { reply_to_message: quoted as ReplyMessage }), "jsitbot")).toEqual({ code: "let a = 1;\na + 1" });
  });

  test("code of its own wins over the replied message", () => {
    const quoted = message("2 + 2");

    expect(addressedCode(message("/run 1 + 1", { reply_to_message: quoted as ReplyMessage }), "jsitbot")).toEqual({ code: "1 + 1" });
  });

  test("has no code when the replied message is a bot's or has no text", () => {
    const fromBot = message("*Code*", { from: { id: BOT_ID, is_bot: true, first_name: "JS" } });
    const photo = { message_id: 1, date: 0, chat: { id: 1, type: "supergroup", title: "t" } } as Message;

    expect(addressedCode(message("/run", { reply_to_message: fromBot as ReplyMessage }), "jsitbot")).toEqual({ code: "" });
    expect(addressedCode(message("/run", { reply_to_message: photo as ReplyMessage }), "jsitbot")).toEqual({ code: "" });
    expect(addressedCode(message("/run"), "jsitbot")).toEqual({ code: "" });
  });
});

describe("running code in a group", () => {
  test("answers /run with the result, as a reply to the command", async () => {
    const chat = createBotUnderTest();

    const id = await chat.say("/run 6 * 7");

    const [reply] = chat.sent();
    expect(chat.sent()).toHaveLength(1);
    expect(reply.chat_id).toBe(GROUP_ID);
    expect(reply.text).toContain("*Result*\n```\n42\n```");
    expect(reply.reply_parameters).toEqual({ message_id: id, allow_sending_without_reply: true });
    expect(reply.parse_mode).toBe("MarkdownV2");
  });

  test("runs the code of the message that is replied to", async () => {
    const chat = createBotUnderTest();

    await chat.say("/run", { replyTo: { text: "'abc'.toUpperCase()" } });

    expect(chat.sent()[0].text).toContain("ABC");
  });

  test("runs a message addressed to the bot by name", async () => {
    const chat = createBotUnderTest();

    await chat.say("@jsitbot Math.max(3, 9)");

    expect(chat.sent()[0].text).toContain("9");
  });

  test("says nothing about ordinary talk and code that nobody asked to run", async () => {
    const chat = createBotUnderTest();

    await chat.say("1 + 1");
    await chat.say("const x = 5; x");
    await chat.say("anyone know what /run does?");
    await chat.say("/run@another_bot 1 + 1");

    expect(chat.sent()).toHaveLength(0);
  });

  test("explains /run when there is nothing to run", async () => {
    const chat = createBotUnderTest();

    await chat.say("/run");

    expect(chat.sent()).toHaveLength(1);
    expect(chat.sent()[0].text).toContain("/run 6 * 7");
  });

  test("stays silent for a user who is over the rate limit", async () => {
    const chat = createBotUnderTest({ maxRequests: 2 });

    await chat.say("/run 1");
    await chat.say("/run 2");
    await chat.say("/run 3");
    await chat.say("/run");

    expect(chat.sent()).toHaveLength(2);
  });

  test("counts one user's runs apart from another's", async () => {
    const chat = createBotUnderTest({ maxRequests: 1 });

    await chat.say("/run 1", { userId: 1 });
    await chat.say("/run 2", { userId: 1 });
    await chat.say("/run 3", { userId: 2 });

    expect(chat.sent().map((reply) => reply.text.match(/\n(\d)\n/)?.[1])).toEqual(["1", "3"]);
  });

  test("tells a user whose code is too long", async () => {
    const chat = createBotUnderTest();

    await chat.say(`/run ${"1".repeat(2_001)}`);

    expect(chat.sent()[0].text).toContain("exceeds the 2000-character limit");
  });
});

describe("the same commands in a private chat", () => {
  test("/run works, and a message that begins with the bot's name is run once", async () => {
    const chat = createBotUnderTest();

    await chat.say("/run 6 * 7", { chat: "private" });
    await chat.say("@jsitbot 1 + 1", { chat: "private" });

    const replies = chat.sent();
    expect(replies).toHaveLength(2);
    expect(replies[0].text).toContain("42");
    expect(replies[1].text).toContain("*Code*\n```\n1 + 1\n```");
  });

  test("ordinary text still goes to the private handler", async () => {
    const chat = createBotUnderTest();

    await chat.say("2 + 2", { chat: "private" });

    expect(chat.sent()).toHaveLength(1);
    expect(chat.sent()[0].text).toContain("4");
  });
});

describe("output that does not fit, from /run", () => {
  const LONG_OUTPUT = 'for (let i = 0; i < 3; i++) console.log(String(i).repeat(1500)); "done"';

  test("a private chat gets the whole output as a file after the answer, as a private message does", async () => {
    const chat = createBotUnderTest();

    await chat.say(`/run ${LONG_OUTPUT}`, { chat: "private" });

    const [reply] = chat.sent();
    expect(reply.text).toContain("truncated");
    const [file] = chat.documents();
    expect(file).toBeDefined();
    expect(file.payload.document.filename).toBe("output.txt");
    expect(file.payload.reply_parameters.message_id).toBe(5_000);
    const text = new TextDecoder().decode((await file.payload.document.toRaw()) as Uint8Array);
    for (const digit of ["0", "1", "2"]) {
      expect(text).toContain(digit.repeat(1500));
    }
  });

  test("a group does not get the file, since it would be one more message for everybody", async () => {
    const chat = createBotUnderTest();

    await chat.say(`/run ${LONG_OUTPUT}`);

    expect(chat.sent()[0].text).toContain("truncated");
    expect(chat.documents()).toHaveLength(0);
  });
});
