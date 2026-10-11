// "/start", "/help me", "/start@jsitbot": the command word, an optional bot
// name, then a space or the end of the message. Anything else that happens to
// begin with a slash, such as a regular expression literal, is code.
const COMMAND_PATTERN = /^\/[A-Za-z0-9_]{1,64}(@[A-Za-z0-9_]{1,64})?(\s|$)/;

export function isBotCommand(text: string): boolean {
  return COMMAND_PATTERN.test(text);
}
