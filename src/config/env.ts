const DEFAULT_TIMEOUT_MS = 700;
const DEFAULT_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_STACK_SIZE_BYTES = 512 * 1024;
const DEFAULT_MAX_CODE_LENGTH = 2000;
const DEFAULT_INLINE_MIN_LENGTH = 3;
// Updates handled at once, and how many one user may have going or waiting.
const DEFAULT_CONCURRENCY = {
  limit: 8,
  perUser: 3,
};
const DEFAULT_PRIVATE_RATE_LIMIT = {
  windowMs: 10_000,
  maxRequests: 5,
};
const DEFAULT_INLINE_RATE_LIMIT = {
  windowMs: 10_000,
  maxRequests: 12,
};
// Sandbox time one user may use per window, private messages and inline queries
// together. Two runs that hit the 700 ms timeout use it up.
const DEFAULT_SANDBOX_TIME_BUDGET = {
  windowMs: 10_000,
  maxMs: 1_000,
};
// Calls to Telegram. It allows a bot about 30 messages a second over all chats
// and answers 429 with a time to wait above that, so sends stay under it.
const DEFAULT_TELEGRAM_API = {
  sendsPerSecond: 25,
  attempts: 3,
  maxWaitMs: 5_000,
};

// After SIGTERM or SIGINT the bot stops taking messages and waits this long for
// the answers in progress before it exits anyway. Under the ten seconds a
// container runtime usually allows before it kills the process.
const DEFAULT_SHUTDOWN = {
  graceMs: 8_000,
};

// What BotFather hands out: the bot's numeric id, a colon, then a secret made of
// letters, digits, "_" and "-".
const BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]+$/;

/** A setting is missing or wrong. The message says which one and never repeats its value. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

function getRequiredEnv(source: Record<string, string | undefined>, name: string): string {
  const value = source[name]?.trim();

  if (!value) {
    throw new ConfigError(`${name} is not set. Put the token from @BotFather in .env, see .env.example.`);
  }

  return value;
}

export function loadEnv(source: Record<string, string | undefined>) {
  const botToken = getRequiredEnv(source, "BOT_TOKEN");

  if (!BOT_TOKEN_PATTERN.test(botToken)) {
    throw new ConfigError(
      "BOT_TOKEN does not look like a Telegram bot token. " +
        "It is digits, a colon, then letters and digits, as BotFather sent it.",
    );
  }

  return {
    botToken,
    sandbox: {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      memoryLimitBytes: DEFAULT_MEMORY_LIMIT_BYTES,
      maxStackSizeBytes: DEFAULT_MAX_STACK_SIZE_BYTES,
    },
    limits: {
      maxCodeLength: DEFAULT_MAX_CODE_LENGTH,
      inlineMinLength: DEFAULT_INLINE_MIN_LENGTH,
      privateRateLimit: DEFAULT_PRIVATE_RATE_LIMIT,
      inlineRateLimit: DEFAULT_INLINE_RATE_LIMIT,
      sandboxTimeBudget: DEFAULT_SANDBOX_TIME_BUDGET,
      concurrency: DEFAULT_CONCURRENCY,
    },
    telegramApi: DEFAULT_TELEGRAM_API,
    shutdown: DEFAULT_SHUTDOWN,
  } as const;
}

export type AppEnv = ReturnType<typeof loadEnv>;
