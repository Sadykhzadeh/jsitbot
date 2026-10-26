// Code pasted from a chat, a README or an answer on a forum usually comes in a
// fence, with a language name after the opening one. As JavaScript that is a
// pair of empty template literals around the real program, and it fails with
// "not a function", so the fence is taken off first.
const FENCED_BLOCK = /^```[A-Za-z0-9_+#-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/;
const FENCED_ONE_LINER = /^```([^`\n][^\n]*?)```$/;
// The name of a language that may stand before the code of a fence on one line.
// Only these, and only before something that can start code: any other word, or
// an operator after it, may be part of the code.
const LANGUAGE_NAME = /^(?:js|javascript|mjs|node|ts|typescript)[ \t]+(?=[A-Za-z0-9_$"'`([{!~])/i;

export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const block = FENCED_BLOCK.exec(trimmed);
  if (block) {
    return block[1];
  }

  const oneLiner = FENCED_ONE_LINER.exec(trimmed);

  return oneLiner ? oneLiner[1].replace(LANGUAGE_NAME, "") : text;
}
