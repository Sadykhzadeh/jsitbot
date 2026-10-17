import { describe, expect, test } from "bun:test";
import { BotError, Context, GrammyError, HttpError } from "grammy";
import type { Update } from "grammy/types";

import { describeBotError } from "../src/runtime/logError";

const CODE = "const secret = 'hunter2'; secret";
const TOKEN = "123456789:AAH-valid_token0123456789abcdefghijk";

function botError(cause: unknown, update: Update = message()): BotError {
  const api = {} as never;
  return new BotError(cause, new Context(update, api, {} as never));
}

function message(): Update {
  return {
    update_id: 77,
    message: { message_id: 1, date: 0, chat: { id: 5, type: "private", first_name: "u" }, text: CODE },
  } as Update;
}

describe("describeBotError", () => {
  test("names the failed call and leaves out the payload that came with it", () => {
    const cause = new GrammyError(
      "Call to 'sendMessage' failed!",
      { ok: false, error_code: 400, description: "Bad Request: message is too long" },
      "sendMessage",
      { chat_id: 5, text: `*Code*\n${CODE}` },
    );

    const line = describeBotError(botError(cause));

    expect(line).toBe("Bot error in message#77: sendMessage failed with 400: Bad Request: message is too long");
    expect(line).not.toContain("hunter2");
  });

  test("says how long Telegram asked the bot to wait", () => {
    const cause = new GrammyError(
      "Call to 'sendMessage' failed!",
      {
        ok: false,
        error_code: 429,
        description: "Too Many Requests: retry after 3",
        parameters: { retry_after: 3 },
      },
      "sendMessage",
      {},
    );

    expect(describeBotError(botError(cause))).toContain("(retry_after 3s)");
  });

  test("keeps a network failure to one line and hides a token in it", () => {
    const cause = new HttpError("Network request for 'sendMessage' failed!", new Error(`connect failed: /bot${TOKEN}/sendMessage`));

    const line = describeBotError(botError(cause));

    expect(line).toContain("no answer from Telegram");
    expect(line).not.toContain(TOKEN);
    expect(line).toContain("<token>");
    expect(line).not.toContain("\n");
  });

  test("shortens a long message and points at where the error came from", () => {
    const cause = new Error(`unexpected ${"x".repeat(1_000)}\nsecond line`);

    const line = describeBotError(botError(cause));

    expect(line.length).toBeLessThan(600);
    expect(line).not.toContain("\n");
    expect(line).toContain("Error: unexpected ");
    expect(line).toContain("...");
    expect(line).toContain(" at ");
  });

  test("names the kind of update for an inline query", () => {
    const update = { update_id: 9, inline_query: { id: "1", from: { id: 1 }, query: CODE, offset: "" } } as Update;

    expect(describeBotError(botError(new Error("x"), update))).toStartWith("Bot error in inline_query#9:");
  });

  test("copes with something that is not an error", () => {
    expect(describeBotError(botError("just a string"))).toBe("Bot error in message#77: a non-error value was thrown");
  });
});
