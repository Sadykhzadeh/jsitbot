import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";

import { SlidingWindowRateLimiter } from "../../src/security/rateLimiter";
import { registerInlineQueryHandler } from "../../src/bot/handlers/inlineQuery";
import { registerPrivateMessageHandler } from "../../src/bot/handlers/privateMessage";
import { QuickJsSandboxService } from "../../src/services/sandbox/quickjsSandbox";
import type { SandboxService } from "../../src/services/sandbox/types";

export const BOT_ID = 999;
export const USER_ID = 42;

export interface ApiCall {
  method: string;
  payload: Record<string, any>;
}

export interface HarnessOptions {
  sandbox?: SandboxService;
  maxRequests?: number;
  /** Methods that should fail, with the error text Telegram would give. */
  failures?: Record<string, string>;
}

/**
 * A bot wired to the real handlers with Telegram replaced by a recorder: every
 * API call the handlers make is captured, and updates are fed in directly.
 */
export function createHarness(options: HarnessOptions = {}) {
  const botInfo = {
    id: BOT_ID,
    is_bot: true,
    first_name: "JS",
    username: "jsitbot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: true,
  } as UserFromGetMe;
  const bot = new Bot("1:test", { botInfo });
  const calls: ApiCall[] = [];
  let nextMessageId = 1_000;

  bot.api.config.use(async (_previous, method, payload) => {
    const body = payload as Record<string, any>;
    calls.push({ method, payload: body });

    const failure = options.failures?.[method];
    if (failure) {
      return { ok: false, error_code: 400, description: failure } as any;
    }
    if (method === "sendMessage") {
      return {
        ok: true,
        result: {
          message_id: nextMessageId++,
          date: 0,
          chat: { id: body.chat_id, type: "private" },
          text: body.text,
        },
      } as any;
    }
    if (method === "editMessageText") {
      return {
        ok: true,
        result: { message_id: body.message_id, date: 0, chat: { id: body.chat_id, type: "private" }, text: body.text },
      } as any;
    }

    return { ok: true, result: true } as any;
  });

  const sandbox = options.sandbox ?? new QuickJsSandboxService();
  const rateLimiter = new SlidingWindowRateLimiter();
  const rateLimitPolicy = { windowMs: 10_000, maxRequests: options.maxRequests ?? 1_000 };

  registerPrivateMessageHandler(bot, {
    botUserId: BOT_ID,
    sandbox,
    rateLimiter,
    rateLimitPolicy,
    maxCodeLength: 2_000,
  });
  registerInlineQueryHandler(bot, {
    sandbox,
    rateLimiter,
    rateLimitPolicy,
    maxCodeLength: 2_000,
    minCodeLength: 3,
    botUsername: "jsitbot",
  });

  let nextUpdateId = 1;
  const from = { id: USER_ID, is_bot: false, first_name: "Tester" };
  const chat = { id: USER_ID, type: "private" as const, first_name: "Tester" };

  return {
    bot,
    calls,
    sandbox,

    callsTo(method: string): ApiCall[] {
      return calls.filter((call) => call.method === method);
    },

    async sendMessage(text: string, messageId = 1): Promise<void> {
      const update: Update = {
        update_id: nextUpdateId++,
        message: { message_id: messageId, date: 0, chat, from, text },
      };
      await bot.handleUpdate(update);
    },

    async editMessage(text: string, messageId = 1): Promise<void> {
      const update: Update = {
        update_id: nextUpdateId++,
        edited_message: { message_id: messageId, date: 0, edit_date: 1, chat, from, text },
      };
      await bot.handleUpdate(update);
    },

    async inlineQuery(query: string): Promise<void> {
      const update: Update = {
        update_id: nextUpdateId++,
        inline_query: { id: `q${nextUpdateId}`, from, query, offset: "" },
      };
      await bot.handleUpdate(update);
    },
  };
}
