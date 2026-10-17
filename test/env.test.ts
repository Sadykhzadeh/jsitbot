import { describe, expect, test } from "bun:test";

import { ConfigError, loadEnv } from "../src/config/env";

const TOKEN = "123456789:AAH-valid_token0123456789abcdefghijk";

describe("loadEnv", () => {
  test("reads the token and fills in the limits", () => {
    const env = loadEnv({ BOT_TOKEN: TOKEN });

    expect(env.botToken).toBe(TOKEN);
    expect(env.sandbox.timeoutMs).toBe(700);
    expect(env.limits.privateRateLimit.maxRequests).toBe(5);
  });

  test("ignores whitespace around the token", () => {
    expect(loadEnv({ BOT_TOKEN: `  ${TOKEN}\n` }).botToken).toBe(TOKEN);
  });

  test("names the variable when the token is missing or empty", () => {
    for (const source of [{}, { BOT_TOKEN: "" }, { BOT_TOKEN: "   " }]) {
      expect(() => loadEnv(source)).toThrow(ConfigError);
      expect(() => loadEnv(source)).toThrow(/BOT_TOKEN is not set/);
    }
  });

  test("rejects values that cannot be a token, such as the placeholder in .env.example", () => {
    for (const bad of ["replace_with_your_bot_token", "123456789", "abc:def", "12 34:abc", `"${TOKEN}"`]) {
      expect(() => loadEnv({ BOT_TOKEN: bad })).toThrow(/does not look like a Telegram bot token/);
    }
  });

  test("never repeats the value it rejected", () => {
    const secret = "123456789:not a valid token but secret-ish";

    try {
      loadEnv({ BOT_TOKEN: secret });
      throw new Error("loadEnv accepted a bad token");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).not.toContain("secret-ish");
    }
  });
});
