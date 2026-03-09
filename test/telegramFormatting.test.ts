import { describe, expect, test } from "bun:test";

import {
  formatExecutionMessage,
  formatInlineExecutionPreview,
} from "../src/bot/formatters/telegramExecutionMessage";

describe("telegramExecutionMessage", () => {
  test("formats execution results as MarkdownV2", () => {
    const message = formatExecutionMessage({
      ok: true,
      logs: ["hello_world", "`value`"],
      result: "2 + 2 = 4",
      durationMs: 12,
      timedOut: false,
      truncated: false,
    });

    expect(message.parseMode).toBe("MarkdownV2");
    expect(message.text).toContain("*Console*");
    expect(message.text).toContain("*Result*");
    expect(message.text).toContain("hello_world");
    expect(message.text).toContain("\\`value\\`");
  });

  test("marks truncated output", () => {
    const message = formatExecutionMessage({
      ok: false,
      logs: [],
      error: "x".repeat(6_000),
      durationMs: 50,
      timedOut: false,
      truncated: false,
    });

    expect(message.text.length).toBeLessThan(4096);
    expect(message.text).toContain("truncated");
  });

  test("builds inline preview from result and logs", () => {
    const preview = formatInlineExecutionPreview({
      ok: true,
      logs: ["hello", "world"],
      result: "2",
      durationMs: 8,
      timedOut: false,
      truncated: false,
    });

    expect(preview.title).toBe("Result: 2");
    expect(preview.description).toContain("console: hello | world");
  });

  test("builds inline preview from errors", () => {
    const preview = formatInlineExecutionPreview({
      ok: false,
      logs: [],
      error: "ReferenceError: x is not defined",
      durationMs: 15,
      timedOut: false,
      truncated: false,
    });

    expect(preview.title).toContain("Error:");
    expect(preview.description).toContain("failed in 15ms");
  });
});
