import { describe, expect, test } from "bun:test";

import { formatHelpMessage } from "../src/bot/formatters/telegramExecutionMessage";
import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";
import { HELP_LIMITS } from "./helpers/botHarness";

const MARKDOWN_V2_SPECIAL = /(?<!\\)[_[\]()~`>#+\-=|{}.!]/;

/** The text as Telegram would parse it for escaping: code spans and bold markers taken out. */
function proseOf(text: string): string {
  return text.replace(/`[^`]*`/g, "").replace(/\*[^*\n]+\*/g, "");
}

function examplesIn(text: string): string[] {
  return [...text.matchAll(/`([^`]*)`/g)].map((match) => match[1].replace(/\\(.)/g, "$1"));
}

describe("help message", () => {
  const help = formatHelpMessage("jsitbot", HELP_LIMITS);

  test("is MarkdownV2 with every special character in the prose escaped", () => {
    expect(help.parseMode).toBe("MarkdownV2");
    expect(proseOf(help.text)).not.toMatch(MARKDOWN_V2_SPECIAL);
  });

  test("fits in one message", () => {
    expect(help.text.length).toBeLessThan(2_000);
  });

  test("states the limits it was given", () => {
    expect(help.text).toContain("Limits: 700 ms per run, 64 MB of memory, 2000 characters of code\\.");
    expect(formatHelpMessage("jsitbot", { timeoutMs: 1_500, memoryLimitBytes: 32 * 1024 * 1024, maxCodeLength: 500 }).text).toContain(
      "1500 ms per run, 32 MB of memory, 500 characters of code",
    );
  });

  test("names the bot in the inline example", () => {
    expect(examplesIn(help.text)).toContain("@jsitbot 1 + 1");
  });

  test("escapes a bot name that contains an underscore", () => {
    const text = formatHelpMessage("my_js_bot", HELP_LIMITS).text;

    expect(proseOf(text)).not.toMatch(MARKDOWN_V2_SPECIAL);
    expect(examplesIn(text)).toContain("@my_js_bot 1 + 1");
  });

  test("every example in it actually runs", async () => {
    const sandbox = new QuickJsSandboxService();
    const runnable = examplesIn(help.text).filter((example) => !/^[@/]/.test(example));

    expect(runnable.length).toBeGreaterThanOrEqual(4);
    for (const example of runnable) {
      const execution = await sandbox.execute(example);

      expect(execution.ok).toBe(true);
    }
  });
});

describe("help message for groups", () => {
  test("shows how to run code in a group", () => {
    expect(examplesIn(formatHelpMessage("jsitbot", HELP_LIMITS).text)).toContain("/run 6 * 7");
  });
});
