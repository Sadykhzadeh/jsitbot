import type { ParseMode } from "grammy/types";

import type { SandboxExecution } from "../../services/sandbox/types";
import {
  escapeMarkdownV2,
  toMarkdownV2CodeBlock,
  truncateText,
} from "../../utils/markdownV2";

const TELEGRAM_MESSAGE_LIMIT = 4000;
const SECTION_OVERHEAD = 64;
const INLINE_TITLE_LIMIT = 64;
const INLINE_DESCRIPTION_LIMIT = 128;

function buildSection(title: string, content: string): string {
  return `*${title}*\n${toMarkdownV2CodeBlock(content)}`;
}

function fitSection(title: string, content: string, maxSectionLength: number): { text: string; truncated: boolean } {
  const available = Math.max(0, maxSectionLength - title.length - SECTION_OVERHEAD);
  const truncated = truncateText(content, available);

  return {
    text: buildSection(title, truncated.value || " "),
    truncated: truncated.truncated,
  };
}

interface ExecutionSection {
  key: "code" | "console" | "outcome";
  title: string;
  content: string;
  maxLength: number;
  minLength: number;
  priority: number;
}

function renderExecutionSections(
  sections: ExecutionSection[],
  durationLine: string,
): { text: string; truncated: boolean } {
  const maxLengths = Object.fromEntries(
    sections.map((section) => [section.key, section.maxLength]),
  ) as Record<ExecutionSection["key"], number>;

  let truncated = false;

  while (true) {
    const renderedSections = sections.map((section) => {
      const rendered = fitSection(section.title, section.content, maxLengths[section.key]);
      truncated = truncated || rendered.truncated;
      return { ...section, rendered };
    });

    const text = [...renderedSections.map((section) => section.rendered.text), durationLine].join("\n");
    if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
      return { text, truncated };
    }

    const overflow = text.length - TELEGRAM_MESSAGE_LIMIT;
    const shrinkTarget = [...sections]
      .sort((left, right) => left.priority - right.priority)
      .find((section) => maxLengths[section.key] > section.minLength);

    if (!shrinkTarget) {
      return { text: text.slice(0, TELEGRAM_MESSAGE_LIMIT), truncated: true };
    }

    maxLengths[shrinkTarget.key] = Math.max(
      shrinkTarget.minLength,
      maxLengths[shrinkTarget.key] - Math.max(overflow, 96),
    );
    truncated = true;
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
  const trimmedCode = code.trim().length > 0 ? code : " ";
  const outcomeTitle = execution.ok ? "Result" : "Error";
  const outcomeValue = execution.ok ? execution.result : execution.error;
  const sections: ExecutionSection[] = [
    {
      key: "code",
      title: "Code",
      content: trimmedCode,
      maxLength: TELEGRAM_MESSAGE_LIMIT,
      minLength: 640,
      priority: 3,
    },
    {
      key: "outcome",
      title: outcomeTitle,
      content: outcomeValue,
      maxLength: Math.min(1200, TELEGRAM_MESSAGE_LIMIT),
      minLength: 180,
      priority: 2,
    },
  ];

  if (execution.logs.length > 0) {
    sections.splice(1, 0, {
      key: "console",
      title: "Console",
      content: execution.logs.join("\n"),
      maxLength: Math.min(900, TELEGRAM_MESSAGE_LIMIT),
      minLength: 0,
      priority: 1,
    });
  }

  const baseDurationLine = `_Duration: ${escapeMarkdownV2(`${execution.durationMs}ms`)}_`;
  const rendered = renderExecutionSections(sections, baseDurationLine);
  const wasTruncated = execution.truncated || rendered.truncated;
  const durationLine = `_Duration: ${escapeMarkdownV2(`${execution.durationMs}ms`)}${
    wasTruncated ? " \\(truncated\\)" : ""
  }_`;
  const finalRendered = renderExecutionSections(sections, durationLine);

  return {
    text: finalRendered.text,
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
    "Send JavaScript in private chat to run it inside an isolated QuickJS runtime\\.",
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
      ? `done in ${execution.durationMs}ms`
      : `failed in ${execution.durationMs}ms`;
  const description = truncateText(logSummary, INLINE_DESCRIPTION_LIMIT).value;

  return { title, description };
}
