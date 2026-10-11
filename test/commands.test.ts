import { describe, expect, test } from "bun:test";

import { isBotCommand } from "../src/bot/commands";
import { createHarness } from "./helpers/botHarness";

describe("isBotCommand", () => {
  test("recognises commands, with or without the bot's name and arguments", () => {
    for (const text of ["/start", "/help", "/start@jsitbot", "/help me", "/unknown", "/x\nsecond line"]) {
      expect(isBotCommand(text)).toBe(true);
    }
  });

  test("does not mistake code for a command", () => {
    for (const text of [
      `/a/.test("a")`,
      `/\\d+/.exec("a12")`,
      "/abc/",
      "/abc/g.flags",
      "// just a comment\n1 + 1",
      "/* note */ 2 * 3",
      "1 + 1",
      "",
    ]) {
      expect(isBotCommand(text)).toBe(false);
    }
  });
});

describe("commands and code in a private chat", () => {
  test("runs code that starts with a regular expression literal", async () => {
    const harness = createHarness();

    await harness.sendMessage(`/a+/.test("caat")`);

    const replies = harness.callsTo("sendMessage");
    expect(replies).toHaveLength(1);
    expect(replies[0].payload.text).toContain("*Result*");
    expect(replies[0].payload.text).toContain("true");
  });

  test("runs code that starts with a comment", async () => {
    const harness = createHarness();

    await harness.sendMessage("// add them up\n1 + 2");

    expect(harness.callsTo("sendMessage")[0].payload.text).toContain("3");
  });

  test("leaves commands alone", async () => {
    const harness = createHarness();

    await harness.sendMessage("/start");
    await harness.sendMessage("/help please");
    await harness.sendMessage("/nonsense@jsitbot 1 + 1");

    expect(harness.callsTo("sendMessage")).toHaveLength(0);
  });
});
