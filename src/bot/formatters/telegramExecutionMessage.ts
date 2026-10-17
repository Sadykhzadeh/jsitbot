import type { ParseMode } from "grammy/types";

import type { SandboxExecution } from "../../services/sandbox/types";
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

/**
 * Adds where an error happened. Only worth the extra line when the code has
 * several of them: for a one-liner the location is obvious.
 */
function describeError(execution: SandboxExecution, code: string): string {
  if (execution.ok) {
    return execution.result;
  }

  const sourceLines = code.split("\n");
  if (!execution.line || sourceLines.length < 2 || execution.line > sourceLines.length) {
    return execution.error;
  }

  const source = sourceLines[execution.line - 1].trim();
  const excerpt = truncateText(source, ERROR_SOURCE_EXCERPT_LIMIT).value;

  return `${execution.error}\n    at line ${execution.line}${excerpt ? `: ${excerpt}` : ""}`;
}

function buildSection(title: string, content: string): string {
  return `*${title}*\n${toMarkdownV2CodeBlock(content)}`;
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
): string {
  const needs = sections.map((section) => section.content.length);
  const longestDuration = durationLine(true);
  // What the message weighs when every section is empty: titles, code fences, line breaks.
  const overhead =
    sections.reduce((sum, section) => sum + buildSection(section.title, " ").length + 1, 0) +
    longestDuration.length;
  let budget = TELEGRAM_MESSAGE_LIMIT - overhead;

  while (true) {
    const rooms = allocate(needs, Math.max(0, budget));
    let truncated = alreadyTruncated;
    const parts = sections.map((section, index) => {
      const cut = truncateText(section.content, rooms[index]);
      truncated = truncated || cut.truncated;
      return buildSection(section.title, cut.value || " ");
    });

    const text = [...parts, durationLine(truncated)].join("\n");
    if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
      return text;
    }

    // Escaping made the text longer than the characters counted: scale the budget by how much.
    const room = rooms.reduce((sum, value) => sum + value, 0);
    const scaled = Math.floor((room * (TELEGRAM_MESSAGE_LIMIT - overhead)) / (text.length - overhead));
    budget = Math.min(scaled, room) - 1;
  }
}

export function formatExecutionMessage(execution: SandboxExecution): {
  text: string;
  parseMode: ParseMode;
};
export function formatExecutionMessage(execution: SandboxExecution, code: string): {
  text: string;
  parseMode: ParseMode;
};
export function formatExecutionMessage(
  execution: SandboxExecution,
  code = "",
): {
  text: string;
  parseMode: ParseMode;
} {
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
  const text = renderExecutionSections(
    sections,
    (truncated) => `_Duration: ${duration}${truncated ? " \\(truncated\\)" : ""}_`,
    execution.truncated,
  );

  return { text, parseMode: "MarkdownV2" };
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

export function formatHelpMessage(botUsername: string): { text: string; parseMode: ParseMode } {
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
    "",
    "*Good to know*",
    escapeMarkdownV2("• The value of the last statement is the result. Use return to stop early."),
    escapeMarkdownV2("• Top-level await works."),
    escapeMarkdownV2("• TypeScript annotations are fine, the types are stripped."),
    escapeMarkdownV2("• Edit your message and the answer updates."),
    `• Inline, in any chat: ${inlineCode(`@${botUsername} 1 + 1`)}`,
  ].join("\n");

  return {
    text: body,
    parseMode: "MarkdownV2",
  };
}

export function formatInlineExecutionPreview(execution: SandboxExecution): {
  title: string;
  description: string;
} {
  const headline = execution.ok ? execution.result : execution.error;
  const titlePrefix = execution.ok ? "Result: " : "Error: ";
  const title = truncateText(`${titlePrefix}${headline}`, INLINE_TITLE_LIMIT).value;

  const logSummary = execution.logs.length > 0
    ? `console: ${execution.logs.join(" | ")}`
    : execution.ok
      ? `done in ${execution.durationMs}ms`
      : `failed in ${execution.durationMs}ms`;
  const description = truncateText(logSummary, INLINE_DESCRIPTION_LIMIT).value;

  return { title, description };
}
