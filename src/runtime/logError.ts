import { format } from "node:util";
import { BotError, GrammyError, HttpError } from "grammy";

// Longest piece of any message that is copied into a log line.
const MAX_MESSAGE_LENGTH = 200;
// A bot token has its numeric id, a colon and a long secret.
const TOKEN_PATTERN = /\d{5,}:[A-Za-z0-9_-]{20,}/g;

function oneLine(text: string): string {
  const flat = text.replace(TOKEN_PATTERN, "<token>").replace(/\s+/g, " ").trim();
  return flat.length > MAX_MESSAGE_LENGTH ? `${flat.slice(0, MAX_MESSAGE_LENGTH)}...` : flat;
}

/** The first few places in the bot's own code an error passed through. */
function whereFrom(error: Error): string {
  const frames = (error.stack ?? "")
    .split("\n")
    .filter((line) => line.trimStart().startsWith("at "))
    .map((line) => line.trim().slice(3))
    .filter((frame) => !frame.includes("node_modules"))
    .slice(0, 3);

  return frames.length > 0 ? ` at ${frames.join(" < ")}` : "";
}

/** Which kind of update was being handled, never what was in it. */
function updateKind(error: BotError): string {
  const update = error.ctx.update as unknown as Record<string, unknown>;
  const kind = Object.keys(update).find((key) => key !== "update_id");

  return `${kind ?? "update"}#${update.update_id}`;
}

/**
 * One line for an error raised while handling an update. A failed Telegram call
 * carries the payload it sent, which holds the code a user wrote and the answer
 * built from it, so the line says what failed and leaves that out.
 */
export function describeBotError(error: BotError): string {
  return `Bot error in ${updateKind(error)}: ${describeCause(error.error)}`;
}

/** The same line for an error that was not raised by a handler, such as a failed call made at startup. */
export function describeAnyError(error: unknown): string {
  return error instanceof BotError ? describeBotError(error) : describeCause(error);
}

function describeCause(cause: unknown): string {
  if (cause instanceof GrammyError) {
    const wait = cause.parameters.retry_after ? ` (retry_after ${cause.parameters.retry_after}s)` : "";
    return `${cause.method} failed with ${cause.error_code}: ${oneLine(cause.description)}${wait}`;
  }

  if (cause instanceof HttpError) {
    const reason = cause.error instanceof Error ? ` (${oneLine(cause.error.message)})` : "";
    return `no answer from Telegram for the call${reason}`;
  }

  if (cause instanceof Error) {
    return `${cause.name}: ${oneLine(cause.message)}${whereFrom(cause)}`;
  }

  return "a non-error value was thrown";
}

/**
 * One line for an error that nothing handled. Every given secret is taken out
 * of it, because an error from a failed fetch carries the address it was sent to.
 */
export function describeFailure(error: unknown, secrets: readonly string[]): string {
  const line =
    error instanceof Error
      ? `${error.name}: ${oneLine(error.message)}${whereFrom(error)}`
      : "a non-error value was thrown";

  return redact(line, secrets);
}

function redact(text: string, secrets: readonly string[]): string {
  return secrets.reduce((kept, secret) => kept.split(secret).join("<token>"), text);
}

/**
 * Sends console.error and console.warn through redaction. Code that is not the
 * bot's own error handling, such as the startup call that publishes the command
 * menu, prints a failed Telegram call as the error object, and that object
 * carries the address the call was sent to. What is written is the same text,
 * with the given secrets taken out.
 */
export function redactConsoleErrors(secrets: readonly string[], output: Console = console): void {
  for (const method of ["error", "warn"] as const) {
    const write = output[method].bind(output);

    output[method] = (...args: unknown[]) => write(redact(format(...args), secrets));
  }
}

export function logBotError(error: BotError): void {
  console.error(describeBotError(error));
}
