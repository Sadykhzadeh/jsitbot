import type { Bot } from "grammy";
import type { Message } from "grammy/types";

import { rateKey, createRunner, type RunnerOptions } from "../runner";
import { stripCodeFence } from "../codeInput";

interface RunCommandOptions extends RunnerOptions {
  botUsername: string;
}

const COMMAND = /^\/run(?:@([A-Za-z0-9_]+))?(?=\s|$)/;

/** What to answer to /run without any code to run. */
const USAGE = [
  "Send `/run 6 * 7` and the bot answers with the result\\.",
  "Or reply to a message that has code in it with /run\\.",
].join("\n");

/** The code in a message that is being replied to: its first code block if it has one, the whole text if not. */
function codeIn(message: Message): string {
  const text = message.text ?? message.caption;
  if (!text) {
    return "";
  }

  const entities = message.text !== undefined ? message.entities : message.caption_entities;
  const block = entities?.find((entity) => entity.type === "pre");

  return block ? text.slice(block.offset, block.offset + block.length) : stripCodeFence(text);
}

/**
 * Finds out whether a message asks the bot to run something, and what. A chat
 * with many people in it is not a place to run every message that looks like
 * code, so the bot only reacts when it is addressed: `/run code`, `@bot code`,
 * or either of them as a reply to a message that holds the code. Returns
 * undefined for any other message, and an empty code for a request that names
 * nothing to run.
 */
export function addressedCode(message: Message, botUsername: string): { code: string } | undefined {
  const text = message.text;
  if (text === undefined) {
    return undefined;
  }

  let rest: string;
  const command = COMMAND.exec(text);
  if (command) {
    // "/run@other_bot" is meant for another bot.
    if (command[1] && command[1].toLowerCase() !== botUsername.toLowerCase()) {
      return undefined;
    }
    rest = text.slice(command[0].length);
  } else if (text.slice(0, botUsername.length + 1).toLowerCase() === `@${botUsername.toLowerCase()}`) {
    const after = text.slice(botUsername.length + 1);
    if (after !== "" && !/^\s/.test(after)) {
      return undefined;
    }
    rest = after;
  } else {
    return undefined;
  }

  const own = stripCodeFence(rest.trim());
  if (own.trim() !== "") {
    return { code: own };
  }

  const quoted = message.reply_to_message;
  return { code: quoted && !quoted.from?.is_bot ? codeIn(quoted) : "" };
}

export function registerRunCommandHandler(bot: Bot, options: RunCommandOptions): void {
  const runCode = createRunner(options);

  bot.on("message:text", async (ctx, next) => {
    const request = addressedCode(ctx.message, options.botUsername);
    if (!request || !ctx.from || ctx.from.is_bot) {
      await next();
      return;
    }

    const inPrivate = ctx.chat.type === "private";
    const reply = (text: string, quote: boolean) =>
      ctx.reply(text, {
        parse_mode: "MarkdownV2",
        ...(quote
          ? { reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true } }
          : {}),
      });

    if (request.code.trim() === "") {
      // Nothing to run, but a reply costs the chat a message all the same.
      if (options.rateLimiter.consume(rateKey(ctx.from.id), options.rateLimitPolicy).allowed) {
        await reply(USAGE, !inPrivate);
      }
      return;
    }

    const outcome = await runCode(ctx.from.id, request.code);
    if (!outcome.ran && outcome.refusal !== "too-long" && !inPrivate) {
      // In a group, a user who is over a limit is not worth a message everybody reads.
      return;
    }

    await reply(outcome.message.text, outcome.ran || !inPrivate);
  });
}
