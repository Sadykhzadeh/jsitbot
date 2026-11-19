import { describe, expect, test } from "bun:test";
import { Bot, type Api } from "grammy";
import type { Message, MessageEntity, Update, UserFromGetMe } from "grammy/types";

import { addressedCode, registerRunCommandHandler } from "../src/bot/handlers/runCommand";
import { registerPrivateMessageHandler } from "../src/bot/handlers/privateMessage";
import { SandboxTimeBudget, SlidingWindowRateLimiter } from "../src/security/rateLimiter";
import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";
import { handleConcurrently } from "../src/bot/concurrency";
import { ReplyTracker } from "../src/bot/replyTracker";
import { registerStartHelpHandlers } from "../src/bot/handlers/startHelp";
import { HELP_LIMITS } from "./helpers/botHarness";

const CODE_FILE = { file_id: "file-1", file_unique_id: "u1", file_name: "answer.js", file_size: 10 };
const encode = (text: string) => new TextEncoder().encode(text);

const BOT_ID = 999;
type ReplyMessage = NonNullable<Message["reply_to_message"]>;

const GROUP_ID = -100123;
const sandbox = new QuickJsSandboxService();

function createBotUnderTest(
  options: { maxRequests?: number; concurrency?: boolean; readFile?: (api: Api, fileId: string, maxBytes: number) => Promise<Uint8Array> } = {},
) {
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
    readFile: options.readFile,
  };
  const concurrency = options.concurrency ? handleConcurrently(bot, { limit: 8, perUser: 3 }) : undefined;
  if (concurrency) {
    bot.use(concurrency);
  }
  const replies = new ReplyTracker();
  registerStartHelpHandlers(bot, "jsitbot", HELP_LIMITS);
  registerRunCommandHandler(bot, { ...shared, botUsername: "jsitbot", replies });
  registerPrivateMessageHandler(bot, { ...shared, botUserId: BOT_ID, replies });

  let updateId = 1;
  let messageId = 10;
  return {
    sent: () => calls.filter((call) => call.method === "sendMessage").map((call) => call.payload),
    edits: () => calls.filter((call) => call.method === "editMessageText").map((call) => call.payload),
    /** Waits until the updates taken by the concurrency middleware have all finished. */
    async settle(): Promise<void> {
      while (concurrency && concurrency.inProgress() > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    },
    documents: () => calls.filter((call) => call.method === "sendDocument").map((call) => ({ payload: call.payload })),

    async say(
      text: string,
      extra: {
        chat?: "group" | "private";
        replyTo?: Partial<Message>;
        entities?: MessageEntity[];
        userId?: number;
        messageId?: number;
      } = {},
    ): Promise<number> {
      const id = extra.messageId ?? messageId++;
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

    async edit(
      text: string,
      editedId: number,
      userId = 42,
      chat: "group" | "private" = "private",
      replyTo?: Partial<Message>,
    ): Promise<void> {
      const target = chat === "private" ? { id: userId, type: "private", first_name: "T" } : { id: GROUP_ID, type: "supergroup", title: "Chat" };
      await bot.handleUpdate({
        update_id: updateId++,
        edited_message: {
          message_id: editedId,
          date: 0,
          edit_date: 1,
          chat: target,
          from: { id: userId, is_bot: false, first_name: "T" },
          text,
          ...(replyTo ? { reply_to_message: { message_id: 1, date: 0, chat: target, ...replyTo } } : {}),
        },
      } as Update);
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

  test("takes a code file that is replied to as the code, not the caption sent with it", () => {
    const quoted = { message_id: 1, date: 0, chat: { id: 1, type: "supergroup", title: "t" }, document: CODE_FILE, caption: "1 + 1" } as Message;

    expect(addressedCode(message("/run", { reply_to_message: quoted as ReplyMessage }), "jsitbot")).toEqual({
      code: "",
      file: CODE_FILE,
    });
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

  test("runs the code file that is replied to", async () => {
    const chat = createBotUnderTest({ readFile: async () => encode("6 * 7") });

    const id = await chat.say("/run", { replyTo: { document: CODE_FILE } });

    expect(chat.sent()[0].text).toContain("42");
    expect(chat.sent()[0].reply_parameters).toEqual({ message_id: id, allow_sending_without_reply: true });
  });

  test("refuses a code file that is too big without reading it", async () => {
    let read = 0;
    const chat = createBotUnderTest({
      readFile: async () => {
        read++;
        return encode("1");
      },
    });

    await chat.say("/run", { replyTo: { document: { ...CODE_FILE, file_size: 6_001 } } });

    expect(read).toBe(0);
    expect(chat.sent()[0].text).toContain("File exceeds the 2000-character limit.");
  });

  test("does not download a replied-to file for a user over the request limit", async () => {
    let read = 0;
    const chat = createBotUnderTest({
      maxRequests: 1,
      readFile: async () => {
        read++;
        return encode("6 * 7");
      },
    });

    await chat.say("/run 1 + 1");
    await chat.say("/run", { replyTo: { document: CODE_FILE } });

    expect(read).toBe(0);
    expect(chat.sent()).toHaveLength(1);
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

  test("answers /run addressed to its own name, as it answers /run", async () => {
    const chat = createBotUnderTest();

    await chat.say("/run@jsitbot 6 * 7");

    expect(chat.sent()).toHaveLength(1);
    expect(chat.sent()[0].text).toContain("42");
  });

  test("does not answer an edit of a command, since a group's messages are not re-run", async () => {
    const chat = createBotUnderTest();

    const id = await chat.say("/run 6 * 7");
    await chat.edit("/run 7 * 7", id, 42, "group");
    await chat.settle();

    expect(chat.sent()).toHaveLength(1);
    expect(chat.edits()).toHaveLength(0);
  });

  test("answers /help for this bot, and nothing that is meant for another bot", async () => {
    const chat = createBotUnderTest();

    // Telegram marks a command with a bot_command entity; grammY only reads commands that have one.
    const command = (text: string) => ({ entities: [{ type: "bot_command" as const, offset: 0, length: text.length }] });

    await chat.say("/help@other_bot", command("/help@other_bot"));
    await chat.say("/start@other_bot", command("/start@other_bot"));
    expect(chat.sent()).toHaveLength(0);

    await chat.say("/help@jsitbot", command("/help@jsitbot"));
    expect(chat.sent()).toHaveLength(1);
    expect(chat.sent()[0].text).toContain("JS Sandbox Bot");
  });
});

describe("the same commands in a private chat", () => {
  test("/run that replies to a code file runs the file, and an edit of the command runs it again", async () => {
    let contents = "1 + 1";
    const chat = createBotUnderTest({ readFile: async () => encode(contents) });

    const id = await chat.say("/run", { chat: "private", replyTo: { document: CODE_FILE } });
    contents = "2 + 2";
    await chat.edit("/run", id, 42, "private", { document: CODE_FILE });

    expect(chat.sent()[0].text).toContain("*Result*\n```\n2\n```");
    expect(chat.edits()[0].text).toContain("*Result*\n```\n4\n```");
  });

  test("charges every read of a file on an edit, so repeated edits stop reading it at the limit", async () => {
    let read = 0;
    const chat = createBotUnderTest({
      maxRequests: 3,
      readFile: async () => {
        read++;
        return encode("6 * 7");
      },
    });

    const id = await chat.say("/run", { chat: "private", replyTo: { document: CODE_FILE } });
    for (let edit = 0; edit < 5; edit++) {
      await chat.edit("/run", id, 42, "private", { document: CODE_FILE });
    }

    // The send reads the file and its run is charged; each of the first two edits is charged for its read.
    expect(read).toBe(3);
    expect(chat.edits()).toHaveLength(0);
    const notices = chat.sent().filter((message) => message.text.includes("Rate limit exceeded"));
    expect(notices).toHaveLength(1);
  });

  test("/run works, and a message that begins with the bot's name is run once", async () => {
    const chat = createBotUnderTest();

    await chat.say("/run 6 * 7", { chat: "private" });
    await chat.say("@jsitbot 1 + 1", { chat: "private" });

    const replies = chat.sent();
    expect(replies).toHaveLength(2);
    expect(replies[0].text).toContain("42");
    expect(replies[1].text).toContain("*Code*\n```\n1 + 1\n```");
  });

  test("an edit of the command updates the answer, as an edit of an ordinary message does", async () => {
    const chat = createBotUnderTest();

    const id = await chat.say("/run 6 * 7", { chat: "private" });
    await chat.edit("/run 7 * 7", id);

    expect(chat.sent()).toHaveLength(1);
    expect(chat.edits()).toHaveLength(1);
    expect(chat.edits()[0].text).toContain("49");
  });

  test("an edit to code that fails shows the error in the answer", async () => {
    const chat = createBotUnderTest();

    const id = await chat.say("/run 6 * 7", { chat: "private" });
    await chat.edit("/run 6 * (", id);

    expect(chat.edits()).toHaveLength(1);
    expect(chat.edits()[0].text).toContain("*Error*");
  });

  test("an edit that comes while the first run is still going updates its answer, and sends no second one", async () => {
    const chat = createBotUnderTest({ concurrency: true });

    // Dispatched one after the other, as polling does: the edit arrives while the first run is still going.
    await chat.say("/run 6 * 7", { chat: "private", messageId: 77 });
    await chat.edit("/run 7 * 7", 77);
    await chat.settle();

    expect(chat.sent()).toHaveLength(1);
    expect(chat.edits()).toHaveLength(1);
    expect(chat.edits()[0].text).toContain("49");
  });

  test("the /run@botname form is tracked too", async () => {
    const chat = createBotUnderTest();

    const id = await chat.say("/run@jsitbot 6 * 7", { chat: "private" });
    await chat.edit("/run@jsitbot 7 * 7", id);

    expect(chat.sent()).toHaveLength(1);
    expect(chat.edits()).toHaveLength(1);
    expect(chat.edits()[0].text).toContain("49");
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
