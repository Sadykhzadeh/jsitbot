import type { Bot } from "grammy";

import { formatHelpMessage, type HelpLimits } from "../formatters/telegramExecutionMessage";

export function registerStartHelpHandlers(bot: Bot, botUsername: string, limits: HelpLimits): void {
  const help = formatHelpMessage(botUsername, limits);

  bot.command(["start", "help"], async (ctx) => {
    await ctx.reply(help.text, {
      parse_mode: help.parseMode,
    });
  });
}
