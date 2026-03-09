const MARKDOWN_V2_SPECIAL_CHARS = /[_*[\]()~`>#+\-=|{}.!]/g;
const CODE_BLOCK_SPECIAL_CHARS = /[`\\]/g;

export function escapeMarkdownV2(text: string): string {
  return text.replaceAll("\\", "\\\\").replace(MARKDOWN_V2_SPECIAL_CHARS, "\\$&");
}

export function escapeMarkdownV2Code(text: string): string {
  return text.replace(CODE_BLOCK_SPECIAL_CHARS, "\\$&");
}

export function truncateText(text: string, maxLength: number): { value: string; truncated: boolean } {
  if (text.length <= maxLength) {
    return { value: text, truncated: false };
  }

  return {
    value: `${text.slice(0, Math.max(0, maxLength - 3))}...`,
    truncated: true,
  };
}

export function toMarkdownV2CodeBlock(text: string): string {
  return `\`\`\`\n${escapeMarkdownV2Code(text)}\n\`\`\``;
}
