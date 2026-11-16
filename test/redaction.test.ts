import { describe, expect, test } from "bun:test";
import { format } from "node:util";
import { Bot } from "grammy";

import { redactConsoleErrors } from "../src/runtime/logError";

const SECRET = "123456789:AAHsecretValue0123456789abcdefghijk";

/** Stands in for the console; keeps the text each method was asked to write. */
function capturingConsole() {
  const lines: string[] = [];
  const write = (...args: unknown[]) => void lines.push(format(...args));
  return { lines, output: { log: write, error: write, warn: write } as unknown as Console };
}

describe("redactConsoleErrors", () => {
  test("takes the token out of an error printed with console.error, in the message or anywhere else", () => {
    const { lines, output } = capturingConsole();
    redactConsoleErrors([SECRET], output);

    output.error(new Error(`request to https://api.telegram.org/bot${SECRET}/setMyCommands failed`));

    expect(lines.join("\n")).not.toContain(SECRET);
    expect(lines.join("\n")).toContain("bot<token>/setMyCommands");
  });

  test("takes the token out of text printed with console.warn", () => {
    const { lines, output } = capturingConsole();
    redactConsoleErrors([SECRET], output);

    output.warn(`warned with ${SECRET}`);

    expect(lines).toEqual(["warned with <token>"]);
  });

  test("leaves console.log alone", () => {
    const { lines, output } = capturingConsole();
    redactConsoleErrors([SECRET], output);

    output.log(`printed ${SECRET}`);

    expect(lines).toEqual([`printed ${SECRET}`]);
  });

  test("hides the token in the error a failed Telegram call throws, as the startup code prints it", async () => {
    const { lines, output } = capturingConsole();
    redactConsoleErrors([SECRET], output);
    const bot = new Bot(SECRET, { client: { apiRoot: "http://127.0.0.1:9" } });

    const failure = await bot.api.getMe().catch((error: unknown) => error);
    output.error("Could not publish the command menu:", failure);

    expect(failure).toBeInstanceOf(Error);
    expect(lines.join("\n")).toContain("Could not publish the command menu:");
    expect(lines.join("\n")).not.toContain(SECRET);
  });
});
