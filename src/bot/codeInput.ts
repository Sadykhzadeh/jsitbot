// Code pasted from a chat, a README or an answer on a forum usually comes in a
// fence, with a language name after the opening one. As JavaScript that is a
// pair of empty template literals around the real program, and it fails with
// "not a function", so the fence is taken off first.
const FENCED_BLOCK = /^```[A-Za-z0-9_+#-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/;
const FENCED_ONE_LINER = /^```([^`\n][^\n]*?)```$/;

export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = FENCED_BLOCK.exec(trimmed) ?? FENCED_ONE_LINER.exec(trimmed);

  return match ? match[1] : text;
}
