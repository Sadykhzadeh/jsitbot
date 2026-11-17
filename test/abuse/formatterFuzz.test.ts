import { describe, test } from "bun:test";

import {
  formatCompactExecution,
  formatExecutionMessage,
  formatInlineExecutionPreview,
} from "../../src/bot/formatters/telegramExecutionMessage";
import type { SandboxExecution } from "../../src/services/sandbox/types";
import { markdownV2Problem } from "../helpers/markdownV2";

const CASES = 20_000;
const SEED = 0x5eed;
const MESSAGE_LIMIT = 4_000;

// mulberry32: a small seeded generator, so a failing case can be replayed from its number.
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPECIAL = "_*[]()~`>#+-=|{}.!\\".split("");
const MARKUP = ["](", "](http://x)", "<b>", "</b>", "*bold*", "_it_", "~s~", "||", "[a](b)", "```", "> q", "# h"];
const ODD = [
  "\u{1F600}", // a surrogate pair
  "\uD83D", // a lone high surrogate
  "\uDE00", // a lone low surrogate
  "​",
  "‍",
  "‮",
  "‬",
  "﻿",
  "\0",
  "\x1b[31m",
  "\t",
  "é",
  "中",
  "“",
  "’",
  'import x from "y"\n',
  "export const z = 1;\n",
  "'",
  '"',
];

/** A fixed set of pieces from which every text is built, weighted towards the characters that matter. */
function piece(next: () => number, heavy: boolean): string {
  // In a heavy text most pieces are backticks and backslashes, which the code
  // blocks escape, so the text grows as it is escaped.
  const roll = heavy && next() < 0.7 ? 0.25 + next() * 0.15 : next();
  if (roll < 0.25) return SPECIAL[Math.floor(next() * SPECIAL.length)];
  if (roll < 0.4) return "`".repeat(1 + Math.floor(next() * 4));
  if (roll < 0.45) return "\\".repeat(1 + Math.floor(next() * 3));
  if (roll < 0.6) return MARKUP[Math.floor(next() * MARKUP.length)];
  if (roll < 0.7) return ODD[Math.floor(next() * ODD.length)];
  if (roll < 0.72) return "x".repeat(1 + Math.floor(next() * 300));
  if (roll < 0.8) return "\n";
  if (roll < 0.9) return " ";
  return String.fromCharCode(97 + Math.floor(next() * 26));
}

function text(next: () => number, pieces: number, heavy: boolean): string {
  let out = "";
  for (let i = 0; i < pieces; i++) out += piece(next, heavy);
  return out;
}

/** Up to `max` characters, built from pieces. */
function bounded(next: () => number, max: number, heavy = false): string {
  // Skewed towards short texts, so the long ones that reach the limits are rare.
  const target = Math.floor(max * next() ** 20);
  let out = "";
  while (out.length < target) {
    out += text(next, 1 + Math.floor(next() * 12), heavy);
  }
  return out.slice(0, target);
}

function lines(next: () => number, count: number, each: number, heavy: boolean): string[] {
  return Array.from({ length: count }, () => bounded(next, each, heavy));
}

/** An execution as the sandbox would hand it over: its limits are kept, its content is hostile. */
function execution(next: () => number, heavy: boolean): SandboxExecution {
  // Few lines most of the time, up to fifty now and then.
  const logs = lines(next, Math.min(50, Math.floor(51 * next() ** 20)), 2_000, heavy);
  const durationMs = Math.floor(next() * 800);
  if (next() < 0.5) {
    const result = bounded(next, 4_000, heavy);
    return { ok: true, logs, result, durationMs, timedOut: false, truncated: result.length >= 4_000 };
  }
  const error = bounded(next, 4_000, heavy);
  const hasLine = next() < 0.5;
  return {
    ok: false,
    logs,
    error,
    line: hasLine ? 1 + Math.floor(next() * 5) : undefined,
    column: hasLine && next() < 0.5 ? 1 + Math.floor(next() * 40) : undefined,
    durationMs,
    timedOut: false,
    truncated: false,
  };
}

function lone(text: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
}

/** Throws with the seed, the case number and its input, but only when the check fails. */
function check(ok: boolean, index: number, input: () => unknown): void {
  if (!ok) {
    throw new Error(`case ${index} (seed ${SEED}): ${JSON.stringify(input()).slice(0, 600)}`);
  }
}

describe("formatter fuzz", () => {
  test("20,000 seeded executions format as valid, bounded MarkdownV2", () => {
    const next = random(SEED);

    for (let index = 0; index < CASES; index++) {
      const heavy = next() < 0.3;
      const exec = execution(next, heavy);
      const code = bounded(next, 2_000, heavy);
      const message = formatExecutionMessage(exec, code);
      const input = () => ({ exec, code, text: message.text });

      check(message.parseMode === "MarkdownV2", index, input);
      check(message.text.length <= MESSAGE_LIMIT, index, input);
      check(markdownV2Problem(message.text) === undefined, index, input);
      check(!lone(message.text), index, input);
    }
  }, 120_000);

  test("the inline preview and the compact share stay well-formed and within their limits", () => {
    const next = random(SEED + 1);

    for (let index = 0; index < CASES / 4; index++) {
      const heavy = next() < 0.3;
      const exec = execution(next, heavy);
      const code = bounded(next, 700, heavy);
      const input = () => ({ exec, code });

      const preview = formatInlineExecutionPreview(exec);
      check(preview.title.length <= 64, index, input);
      check(preview.description.length <= 128, index, input);
      check(!lone(preview.title + preview.description), index, input);

      const compact = formatCompactExecution(exec, code);
      if (compact) {
        check(markdownV2Problem(compact.text) === undefined, index, input);
        check(compact.text.length <= MESSAGE_LIMIT, index, input);
        check(!lone(compact.title + compact.text), index, input);
      }
    }
  }, 120_000);
});
