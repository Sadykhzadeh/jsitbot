const DEFAULT_TIMEOUT_MS = 700;
const DEFAULT_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_STACK_SIZE_BYTES = 512 * 1024;
const DEFAULT_MAX_CODE_LENGTH = 2000;
const DEFAULT_INLINE_MIN_LENGTH = 3;
const DEFAULT_PRIVATE_RATE_LIMIT = {
  windowMs: 10_000,
  maxRequests: 5,
};
const DEFAULT_INLINE_RATE_LIMIT = {
  windowMs: 10_000,
  maxRequests: 12,
};

function getRequiredEnv(name: string): string {
  const value = Bun.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export const env = {
  botToken: getRequiredEnv("BOT_TOKEN"),
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
  },
} as const;

export type AppEnv = typeof env;
