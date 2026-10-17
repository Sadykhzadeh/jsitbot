import { describe, expect, test } from "bun:test";
import { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";

import { GROUP_COMMANDS, PRIVATE_COMMANDS, publishCommandMenus } from "../src/bot/commandMenu";

describe("command menus", () => {
  test("only list what Telegram accepts", () => {
    for (const { command, description } of [...PRIVATE_COMMANDS, ...GROUP_COMMANDS]) {
      expect(command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(description.length).toBeGreaterThanOrEqual(3);
      expect(description.length).toBeLessThanOrEqual(256);
    }
  });

  test("list /start and /help in private and /run in groups", () => {
    expect(PRIVATE_COMMANDS.map((entry) => entry.command)).toEqual(["start", "help"]);
    expect(GROUP_COMMANDS.map((entry) => entry.command)).toContain("run");
  });

  test("are sent once for private chats and once for groups", async () => {
    const bot = new Bot("1:test", { botInfo: { id: 1, is_bot: true, username: "jsitbot" } as UserFromGetMe });
    const calls: Record<string, any>[] = [];
    bot.api.config.use(async (_previous, method, payload) => {
      calls.push({ method, ...(payload as object) });
      return { ok: true, result: true } as any;
    });

    await publishCommandMenus(bot.api);

    expect(calls.map((call) => call.method)).toEqual(["setMyCommands", "setMyCommands"]);
    expect(calls[0].scope).toBeUndefined();
    expect(calls[0].commands).toEqual(PRIVATE_COMMANDS);
    expect(calls[1].scope).toEqual({ type: "all_group_chats" });
    expect(calls[1].commands).toEqual(GROUP_COMMANDS);
  });
});
