import type { ParseMode } from "grammy/types";

import type { SandboxExecution, SandboxExecutionFailure } from "../../services/sandbox/types";
import {
  escapeMarkdownV2,
  escapeMarkdownV2Code,
  toMarkdownV2CodeBlock,
  truncateText,
} from "../../utils/markdownV2";

const TELEGRAM_MESSAGE_LIMIT = 4000;
const INLINE_TITLE_LIMIT = 64;
const INLINE_DESCRIPTION_LIMIT = 128;
const ERROR_SOURCE_EXCERPT_LIMIT = 60;

// Phone keyboards turn " and ' into curly quotes, and word processors turn -- into
// a dash. The engine can only say "unexpected character" about them.
const CURLY_QUOTES = /[\u2018\u2019\u201C\u201D]/;
const CURLY_QUOTES_HINT = "Hint: the code has curly quotes (\u201C \u201D \u2018 \u2019), JavaScript needs straight ones (\" ').";
const LOOKALIKE_CHARACTERS = /[\u2010-\u2015\u2212\u00D7\u00F7\u200B-\u200D\u2060\uFEFF\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF5E]/;
const LOOKALIKE_HINT = "Hint: the code has look-alike characters (dashes, \u00D7, \u00F7, full-width signs, zero-width spaces), JavaScript needs the plain ones.";

// Code copied from a tutorial often starts with an import. A script has none of
// them, and the engine reports the first as "expecting '('" and the second as an
// unsupported keyword, neither of which says what is wrong.
const MODULE_ERROR = /^SyntaxError: (?:expecting '\('|unsupported keyword: (?:export|import))/;
const MODULE_STATEMENT = /^\s*(?:import\s*[\w${*"']|export\b)/m;
const MODULE_HINT = "Hint: this runs as a script, not a module, so import and export do not work.";

// Node programs call require, read process or fetch a URL. The sandbox has none of
// them, and the engine says only that the name is not defined.
const HOST_ERROR = /^ReferenceError: '?(?:require|module|exports|process|fetch|fs|__dirname|__filename)'? is not defined$/;
const HOST_HINT = "Hint: the sandbox has no require, process, fetch or file system: it runs JavaScript with no access to files or the network.";

// A code fence that is opened and never closed is not taken off, so the engine
// reads its backticks as template literals and reports the end of the input.
const OPENING_FENCE = /^\s*```/;
const FENCE_HINT = "Hint: the code starts with a code fence that is never closed. Send the code without the fence, or add the closing fence at the end.";

// A program can print half of a surrogate pair. Telegram cannot store that, so
// it is shown as the replacement character. This runs on the text that is
// about to be sent, after the cut: a whole megabyte of output is never scanned.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function wellFormed(text: string): string {
  return text.replace(LONE_SURROGATE, "�");
}

function describeError(execution: SandboxExecution, code: string): string {
  if (execution.ok) {
    return execution.result;
  }

  const located = locateError(execution, code);
  const opening = code.indexOf("```");
  if (OPENING_FENCE.test(code) && !code.includes("```", opening + 3)) {
    return located + "\n" + FENCE_HINT;
  }
  if (/^SyntaxError: unexpected character/.test(execution.error) && CURLY_QUOTES.test(code)) {
    return located + "\n" + CURLY_QUOTES_HINT;
  }
  if (/^SyntaxError: unexpected character/.test(execution.error) && LOOKALIKE_CHARACTERS.test(code)) {
    return located + "\n" + LOOKALIKE_HINT;
  }
  if (MODULE_ERROR.test(execution.error) && MODULE_STATEMENT.test(code)) {
    return located + "\n" + MODULE_HINT;
  }
  if (HOST_ERROR.test(execution.error)) {
    return located + "\n" + HOST_HINT;
  }

  return located;
}

/**
 * Adds where an error happened. Only worth the extra line when the code has
 * several of them: for a one-liner the location is obvious.
 */
function locateError(execution: SandboxExecutionFailure, code: string): string {
  // A line break from a Windows keyboard leaves a carriage return at the end of its line.
  const sourceLines = code.split("\n").map((line) => line.replace(/\r$/, ""));
  if (execution.column && execution.line && execution.line <= sourceLines.length) {
    // Shown the way Node shows a syntax error: the line, a caret under the
    // column, then the message.
    return `${caretBlock(sourceLines[execution.line - 1], execution.column)}\n${execution.error}`;
  }
  if (!execution.line || sourceLines.length < 2 || execution.line > sourceLines.length) {
    return execution.error;
  }

  const source = sourceLines[execution.line - 1].trim();
  const excerpt = truncateText(source, ERROR_SOURCE_EXCERPT_LIMIT).value;

  return `${execution.error}\n    at line ${execution.line}${excerpt ? `: ${excerpt}` : ""}`;
}

/** Characters of a source line shown around a syntax error; a longer line is cut to a window around the column. */
const CARET_WINDOW = 80;

/**
 * The source line and a caret under the column. The engine counts the column in
 * code points, but a character outside the BMP takes two cells in a monospace
 * font, so the caret is placed by cells. Tabs are kept in the caret line so it
 * lines up with the source. A long line is cut to a window around the error,
 * with "..." where it was cut, so the caret stays in view.
 */
function caretBlock(source: string, column: number): string {
  const chars = Array.from(source);
  const at = column - 1;
  let from = 0;
  let to = chars.length;
  if (chars.length > CARET_WINDOW) {
    from = Math.min(Math.max(0, at - CARET_WINDOW / 2), chars.length - CARET_WINDOW);
    to = from + CARET_WINDOW;
  }

  const lead = from > 0 ? "..." : "";
  const shown = `${lead}${chars.slice(from, to).join("")}${to < chars.length ? "..." : ""}`;

  let caret = " ".repeat(lead.length);
  for (const character of chars.slice(from, Math.min(at, to))) {
    if (character === "\t") {
      caret += "\t";
    } else {
      caret += (character.codePointAt(0) ?? 0) > 0xffff ? "  " : " ";
    }
  }

  return `${shown}\n${caret}^`;
}

function buildSection(title: string, content: string): string {
  return `*${title}*\n${toMarkdownV2CodeBlock(wellFormed(content))}`;
}

interface ExecutionSection {
  title: string;
  content: string;
}

/**
 * Splits a budget of characters between sections so that nobody gets more than
 * it needs and the sections that need more share what is left equally: a
 * 30-character result keeps all of it, and a long result and a long console
 * log get half of the room each.
 */
function allocate(needs: number[], budget: number): number[] {
  const order = needs.map((_, index) => index).sort((a, b) => needs[a] - needs[b]);
  const rooms = needs.map(() => 0);
  let remaining = budget;

  order.forEach((index, position) => {
    const share = Math.floor(remaining / (order.length - position));
    rooms[index] = Math.min(needs[index], share);
    remaining -= rooms[index];
  });

  return rooms;
}

function renderExecutionSections(
  sections: ExecutionSection[],
  durationLine: (truncated: boolean) => string,
  alreadyTruncated: boolean,
): { text: string; cut: boolean } {
  const needs = sections.map((section) => section.content.length);
  const longestDuration = durationLine(true);
  // What the message weighs when every section is empty: titles, code fences, line breaks.
  const overhead =
    sections.reduce((sum, section) => sum + buildSection(section.title, " ").length + 1, 0) +
    longestDuration.length;
  let budget = TELEGRAM_MESSAGE_LIMIT - overhead;

  while (true) {
    const rooms = allocate(needs, Math.max(0, budget));
    let cutHere = false;
    const parts = sections.map((section, index) => {
      const cut = truncateText(section.content, rooms[index]);
      cutHere = cutHere || cut.truncated;
      return buildSection(section.title, cut.value || " ");
    });

    const text = [...parts, durationLine(cutHere || alreadyTruncated)].join("\n");
    if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
      return { text, cut: cutHere };
    }

    // Escaping made the text longer than the characters counted: scale the budget by how much.
    const room = rooms.reduce((sum, value) => sum + value, 0);
    const scaled = Math.floor((room * (TELEGRAM_MESSAGE_LIMIT - overhead)) / (text.length - overhead));
    budget = Math.min(scaled, room) - 1;
  }
}

export interface ExecutionMessage {
  text: string;
  parseMode: ParseMode;
  /** Whether this message had to leave out part of the code, console or result to fit. */
  cut: boolean;
}

export function formatExecutionMessage(execution: SandboxExecution): ExecutionMessage;
export function formatExecutionMessage(execution: SandboxExecution, code: string): ExecutionMessage;
export function formatExecutionMessage(execution: SandboxExecution, code = ""): ExecutionMessage {
  const sections: ExecutionSection[] = [
    { title: "Code", content: code.trim().length > 0 ? code : " " },
  ];
  if (execution.logs.length > 0) {
    sections.push({ title: "Console", content: execution.logs.join("\n") });
  }
  sections.push({
    title: execution.ok ? "Result" : "Error",
    content: describeError(execution, code),
  });

  const duration = escapeMarkdownV2(`${execution.durationMs}ms`);
  const { text, cut } = renderExecutionSections(
    sections,
    (truncated) => `_Duration: ${duration}${truncated ? " \\(truncated\\)" : ""}_`,
    execution.truncated,
  );

  return { text, parseMode: "MarkdownV2", cut };
}

/** Everything the sandbox returned, as plain text, for a message that could not hold it all. */
export function formatExecutionDocument(execution: SandboxExecution, code: string): string {
  const sections = [["Code", code]];
  if (execution.logs.length > 0) {
    sections.push(["Console", execution.logs.join("\n")]);
  }
  sections.push([execution.ok ? "Result" : "Error", describeError(execution, code)]);

  return sections.map(([title, content]) => `${title}\n${"-".repeat(title.length)}\n${content}\n`).join("\n");
}

export function formatRejectionMessage(message: string): { text: string; parseMode: ParseMode } {
  return {
    text: `*Rejected*\n${toMarkdownV2CodeBlock(message)}`,
    parseMode: "MarkdownV2",
  };
}

function inlineCode(text: string): string {
  return `\`${escapeMarkdownV2Code(text)}\``;
}

export interface HelpLimits {
  timeoutMs: number;
  memoryLimitBytes: number;
  maxCodeLength: number;
}

export function formatHelpMessage(
  botUsername: string,
  limits: HelpLimits,
): { text: string; parseMode: ParseMode } {
  const body = [
    "*JS Sandbox Bot*",
    escapeMarkdownV2(
      "Send JavaScript and get the result back. It runs in an isolated QuickJS sandbox with short time and memory limits, and has no network or file access.",
    ),
    "",
    "*Examples*",
    inlineCode("1 + 1"),
    inlineCode("[1, 2, 3].map(n => n * 2)"),
    inlineCode('const user = { name: "Ada" }; user'),
    inlineCode('console.log("hi"); await Promise.resolve(42)'),
    inlineCode("const n: number = 5; n * 2"),
    inlineCode("console.table([{ n: 1 }, { n: 2 }])"),
    inlineCode('await new Promise(r => setTimeout(r, 5000)); "slept"'),
    "",
    "*Good to know*",
    escapeMarkdownV2("• The value of the last statement is the result. Use return to stop early."),
    escapeMarkdownV2("• Top-level await works."),
    escapeMarkdownV2("• TypeScript annotations are fine, the types are stripped."),
    escapeMarkdownV2("• In a private chat, edit your message and the answer updates."),
    escapeMarkdownV2("• A sleep does not use up the time limit: it returns at once."),
    escapeMarkdownV2(
      `• Limits: ${limits.timeoutMs} ms per run, ${Math.round(limits.memoryLimitBytes / (1024 * 1024))} MB of memory, ${limits.maxCodeLength} characters of code.`,
    ),
    `• Inline, in any chat: ${inlineCode(`@${botUsername} 1 + 1`)}`,
    `• In a group: ${inlineCode("/run 6 * 7")}, or reply to a message that has code, or to a JavaScript or TypeScript file, with /run, or send such a file with /run as its caption\\.`,
  ].join("\n");

  return {
    text: body,
    parseMode: "MarkdownV2",
  };
}

// The list of inline results shows one line per title and description.
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function formatInlineExecutionPreview(execution: SandboxExecution): {
  title: string;
  description: string;
} {
  const headline = execution.ok ? execution.result : execution.error;
  const titlePrefix = execution.ok ? "Result: " : "Error: ";
  const title = wellFormed(truncateText(oneLine(`${titlePrefix}${headline}`), INLINE_TITLE_LIMIT).value);

  const where = !execution.ok && execution.line
    ? execution.column
      ? `at line ${execution.line}, column ${execution.column}`
      : `at line ${execution.line}`
    : undefined;
  const logSummary = execution.logs.length > 0
    ? `console: ${execution.logs.join(" | ")}`
    : execution.ok
      ? `done in ${execution.durationMs}ms`
      : (where ?? `failed in ${execution.durationMs}ms`);
  const description = wellFormed(truncateText(oneLine(logSummary), INLINE_DESCRIPTION_LIMIT).value);

  return { title, description };
}

const COMPACT_CODE_LIMIT = 600;
const COMPACT_RESULT_LIMIT = 300;

/**
 * The code with its result as a comment, in one block, for sharing in a chat
 * where the Code, Console and Result sections would be more than anyone wants
 * to read. Only for a run that printed nothing and whose result is one short
 * line: anything else is better served by the full message.
 */
export function formatCompactExecution(
  execution: SandboxExecution,
  code: string,
): { title: string; text: string; parseMode: ParseMode } | undefined {
  if (
    !execution.ok ||
    execution.logs.length > 0 ||
    execution.result.includes("\n") ||
    execution.result.length > COMPACT_RESULT_LIMIT ||
    code.length > COMPACT_CODE_LIMIT
  ) {
    return undefined;
  }

  return {
    title: wellFormed(truncateText(`Share: ${execution.result}`, INLINE_TITLE_LIMIT).value),
    text: toMarkdownV2CodeBlock(wellFormed(`${code.trim()}\n// => ${execution.result}`)),
    parseMode: "MarkdownV2",
  };
}
