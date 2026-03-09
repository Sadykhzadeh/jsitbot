import type { Bot } from "grammy";

import { formatHelpMessage } from "../formatters/telegramExecutionMessage";

export function registerStartHelpHandlers(bot: Bot, botUsername: string): void {
  const help = formatHelpMessage(botUsername);

  bot.command(["start", "help"], async (ctx) => {
    await ctx.reply(help.text, {
      parse_mode: help.parseMode,
    });
  });
}
