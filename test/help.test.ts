import { describe, expect, test } from "bun:test";

import { formatHelpMessage } from "../src/bot/formatters/telegramExecutionMessage";
import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const MARKDOWN_V2_SPECIAL = /(?<!\\)[_[\]()~`>#+\-=|{}.!]/;

/** The text as Telegram would parse it for escaping: code spans and bold markers taken out. */
function proseOf(text: string): string {
  return text.replace(/`[^`]*`/g, "").replace(/\*[^*\n]+\*/g, "");
}

function examplesIn(text: string): string[] {
  return [...text.matchAll(/`([^`]*)`/g)].map((match) => match[1].replace(/\\(.)/g, "$1"));
}

describe("help message", () => {
  const help = formatHelpMessage("jsitbot");

  test("is MarkdownV2 with every special character in the prose escaped", () => {
    expect(help.parseMode).toBe("MarkdownV2");
    expect(proseOf(help.text)).not.toMatch(MARKDOWN_V2_SPECIAL);
  });

  test("fits in one message", () => {
    expect(help.text.length).toBeLessThan(2_000);
  });

  test("names the bot in the inline example", () => {
    expect(examplesIn(help.text)).toContain("@jsitbot 1 + 1");
  });

  test("escapes a bot name that contains an underscore", () => {
    const text = formatHelpMessage("my_js_bot").text;

    expect(proseOf(text)).not.toMatch(MARKDOWN_V2_SPECIAL);
    expect(examplesIn(text)).toContain("@my_js_bot 1 + 1");
  });

  test("every example in it actually runs", async () => {
    const sandbox = new QuickJsSandboxService();
    const runnable = examplesIn(help.text).filter((example) => !example.startsWith("@"));

    expect(runnable.length).toBeGreaterThanOrEqual(4);
    for (const example of runnable) {
      const execution = await sandbox.execute(example);

      expect(execution.ok).toBe(true);
    }
  });
});
