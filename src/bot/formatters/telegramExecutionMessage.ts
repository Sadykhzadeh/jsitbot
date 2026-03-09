import type { ParseMode } from "grammy/types";

import type { SandboxExecution } from "../../services/sandbox/types";
import {
  escapeMarkdownV2,
  toMarkdownV2CodeBlock,
  truncateText,
} from "../../utils/markdownV2";

const TELEGRAM_MESSAGE_LIMIT = 3900;
const SECTION_OVERHEAD = 64;
const INLINE_TITLE_LIMIT = 64;
const INLINE_DESCRIPTION_LIMIT = 128;

function buildSection(title: string, content: string): string {
  return `*${title}*\n${toMarkdownV2CodeBlock(content)}`;
}

function fitSection(title: string, content: string, remaining: number): { text: string; truncated: boolean } {
  const available = Math.max(0, remaining - title.length - SECTION_OVERHEAD);
  const truncated = truncateText(content, available);

  return {
    text: buildSection(title, truncated.value || " "),
    truncated: truncated.truncated,
  };
}

export function formatExecutionMessage(execution: SandboxExecution): {
  text: string;
  parseMode: ParseMode;
} {
  const parts: string[] = [];
  let remaining = TELEGRAM_MESSAGE_LIMIT;
  let wasTruncated = execution.truncated;

  const logsContent = execution.logs.length > 0 ? execution.logs.join("\n") : "(no console output)";
  const logsSection = fitSection("Console", logsContent, remaining);
  parts.push(logsSection.text);
  remaining -= logsSection.text.length + 2;
  wasTruncated = wasTruncated || logsSection.truncated;

  const outcomeTitle = execution.ok ? "Result" : "Error";
  const outcomeValue = execution.ok ? execution.result : execution.error;
  const outcomeSection = fitSection(outcomeTitle, outcomeValue, remaining);
  parts.push(outcomeSection.text);
  wasTruncated = wasTruncated || outcomeSection.truncated;

  const durationLine = `_Duration: ${escapeMarkdownV2(`${execution.durationMs}ms`)}${
    wasTruncated ? " \\(truncated\\)" : ""
  }_`;
  parts.push(durationLine);

  return {
    text: parts.join("\n\n"),
    parseMode: "MarkdownV2",
  };
}

export function formatRejectionMessage(message: string): { text: string; parseMode: ParseMode } {
  return {
    text: `*Rejected*\n${toMarkdownV2CodeBlock(message)}`,
    parseMode: "MarkdownV2",
  };
}

export function formatHelpMessage(botUsername: string): { text: string; parseMode: ParseMode } {
  const body = [
    "*JS Sandbox Bot*",
    "",
    "Send JavaScript in a private chat to execute it inside an isolated QuickJS runtime\\.",
    "",
    `Inline mode: \`@${escapeMarkdownV2(botUsername)} 1 \\+ 1\``,
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
      ? `ok in ${execution.durationMs}ms`
      : `failed in ${execution.durationMs}ms`;
  const description = truncateText(logSummary, INLINE_DESCRIPTION_LIMIT).value;

  return { title, description };
}
