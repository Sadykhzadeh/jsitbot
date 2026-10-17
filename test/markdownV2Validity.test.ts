import { describe, expect, test } from "bun:test";

import {
  formatExecutionMessage,
  formatHelpMessage,
  formatInlineExecutionPreview,
  formatRejectionMessage,
} from "../src/bot/formatters/telegramExecutionMessage";
import type { SandboxExecution } from "../src/services/sandbox/types";

const SPECIAL = "_*[]()~`>#+-=|{}.!";

/**
 * Checks a message the way Telegram's MarkdownV2 parser would: outside a code
 * block every special character is escaped, inside one only ` and \ are, and
 * every bold, italic and code block that is opened is closed. Returns what is
 * wrong, or undefined.
 */
function problem(text: string): string | undefined {
  let inBlock = false;
  let inSpan = false;
  let bold = false;
  let italic = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (c === "\\") {
      if (i + 1 >= text.length) return "ends with a lone backslash";
      i++;
      continue;
    }
    if (c === "`") {
      if (inSpan) {
        inSpan = false;
      } else if (text.startsWith("```", i) && !inSpan) {
        inBlock = !inBlock;
        i += 2;
      } else if (!inBlock) {
        inSpan = true;
      } else {
        return `unescaped backtick at ${i}`;
      }
      continue;
    }
    if (inBlock || inSpan) continue;

    if (c === "*") bold = !bold;
    else if (c === "_") italic = !italic;
    else if (SPECIAL.includes(c)) return `unescaped ${c} at ${i}`;
  }

  if (inBlock || inSpan) return "code left open";
  if (bold || italic) return "bold or italic left open";
  return undefined;
}

// A small deterministic generator, so a failure can be reproduced.
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const PIECES = [
  "`", "``", "```", "\\", "\\`", "*", "_", "[", "](", ")", "~", ">", "#", "+", "-", "=", "|", "{", "}", ".", "!",
  "\n", "\n\n", " ", "a", "z", "0", "😀", "👨‍👩‍👧", "é", "я", "‮", "​", "\t",
];

function randomText(next: () => number, maxLength: number): string {
  let out = "";
  const target = Math.floor(next() * maxLength);
  while (out.length < target) {
    out += PIECES[Math.floor(next() * PIECES.length)];
  }
  return out;
}

function randomExecution(next: () => number): SandboxExecution {
  const logs = Array.from({ length: Math.floor(next() * 5) }, () => randomText(next, next() < 0.2 ? 2000 : 80));
  const base = {
    logs,
    durationMs: Math.floor(next() * 2000),
    timedOut: false as const,
    truncated: next() < 0.3,
  };

  return next() < 0.5
    ? { ...base, ok: true, result: randomText(next, next() < 0.2 ? 4000 : 120) }
    : { ...base, ok: false, error: randomText(next, next() < 0.2 ? 4000 : 120), line: 1 + Math.floor(next() * 6) };
}

describe("MarkdownV2 output", () => {
  test("the checker itself notices a broken message", () => {
    expect(problem("*Result*\n```\nplain\n```")).toBeUndefined();
    expect(problem("*Result*\n```\na\\`b\n```")).toBeUndefined();
    expect(problem("*Result*\n```\na`b\n```")).toContain("backtick");
    expect(problem("*Result*\n```\nabc")).toContain("left open");
    expect(problem("_Duration: 1.5ms_")).toContain("unescaped");
  });

  test("every message built from awkward text is valid and fits in one message", () => {
    const next = generator(20241018);

    for (let round = 0; round < 1500; round++) {
      const execution = randomExecution(next);
      const code = randomText(next, next() < 0.3 ? 2000 : 100);
      const message = formatExecutionMessage(execution, code);

      expect(problem(message.text)).toBeUndefined();
      expect(message.text.length).toBeLessThanOrEqual(4096);
    }
  });

  test("help and rejection messages are valid, whatever the bot is called", () => {
    for (const username of ["jsitbot", "my_test_bot", "a_b_c_bot"]) {
      expect(problem(formatHelpMessage(username).text)).toBeUndefined();
    }
    expect(problem(formatRejectionMessage("Rate limit exceeded. Try again in 3s.").text)).toBeUndefined();
    expect(problem(formatRejectionMessage("`` \ ```").text)).toBeUndefined();
  });

  test("the text never ends in the middle of a surrogate pair", () => {
    const next = generator(7);

    for (let round = 0; round < 300; round++) {
      const execution = randomExecution(next);
      const message = formatExecutionMessage(execution, randomText(next, 2000));
      const preview = formatInlineExecutionPreview(execution);

      for (const text of [message.text, preview.title, preview.description]) {
        expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text)).toBe(false);
      }
    }
  });
});
