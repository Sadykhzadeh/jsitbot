const SPECIAL = "_*[]()~`>#+-=|{}.!";

/**
 * Checks a message the way Telegram's MarkdownV2 parser would: outside a code
 * block every special character is escaped, inside one only ` and \ are, and
 * every bold, italic and code block that is opened is closed. Returns what is
 * wrong, or undefined.
 */
export function markdownV2Problem(text: string): string | undefined {
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
