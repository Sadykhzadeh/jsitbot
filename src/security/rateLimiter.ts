export interface RateLimitPolicy {
  windowMs: number;
  maxRequests: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

interface Entry {
  timestamps: number[];
}

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, Entry>();

  consume(key: string, policy: RateLimitPolicy, now = Date.now()): RateLimitResult {
    const existing = this.buckets.get(key) ?? { timestamps: [] };
    const threshold = now - policy.windowMs;
    existing.timestamps = existing.timestamps.filter((timestamp) => timestamp > threshold);

    if (existing.timestamps.length >= policy.maxRequests) {
      const retryAfterMs = Math.max(0, policy.windowMs - (now - existing.timestamps[0]));
      this.buckets.set(key, existing);
      return { allowed: false, retryAfterMs };
    }

    existing.timestamps.push(now);
    this.buckets.set(key, existing);
    return { allowed: true, retryAfterMs: 0 };
  }
}

export function isCodeLengthAllowed(code: string, maxLength: number): boolean {
  return code.length <= maxLength;
}

export function isInlineQueryLongEnough(code: string, minLength: number): boolean {
  return code.trim().length >= minLength;
}
