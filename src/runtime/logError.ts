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
  const cause = error.error;
  const prefix = `Bot error in ${updateKind(error)}:`;

  if (cause instanceof GrammyError) {
    const wait = cause.parameters.retry_after ? ` (retry_after ${cause.parameters.retry_after}s)` : "";
    return `${prefix} ${cause.method} failed with ${cause.error_code}: ${oneLine(cause.description)}${wait}`;
  }

  if (cause instanceof HttpError) {
    const reason = cause.error instanceof Error ? ` (${oneLine(cause.error.message)})` : "";
    return `${prefix} no answer from Telegram for the call${reason}`;
  }

  if (cause instanceof Error) {
    return `${prefix} ${cause.name}: ${oneLine(cause.message)}${whereFrom(cause)}`;
  }

  return `${prefix} a non-error value was thrown`;
}

export function logBotError(error: BotError): void {
  console.error(describeBotError(error));
}
