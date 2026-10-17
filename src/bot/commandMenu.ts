import type { Api } from "grammy";
import type { BotCommand } from "grammy/types";

// What Telegram lists when the user types "/". A private chat runs plain
// messages, so it only needs the help; a group needs to be told about /run.
export const PRIVATE_COMMANDS: BotCommand[] = [
  { command: "start", description: "What this bot does" },
  { command: "help", description: "Examples and limits" },
];

export const GROUP_COMMANDS: BotCommand[] = [
  { command: "run", description: "Run JavaScript: /run 6 * 7, or reply to code with /run" },
  { command: "help", description: "Examples and limits" },
];

export async function publishCommandMenus(api: Api): Promise<void> {
  await api.setMyCommands(PRIVATE_COMMANDS);
  await api.setMyCommands(GROUP_COMMANDS, { scope: { type: "all_group_chats" } });
}
