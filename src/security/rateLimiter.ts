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
  windowMs: number;
}

// How many calls pass between sweeps for buckets nobody has touched since.
const SWEEP_EVERY = 500;

/**
 * Extra requests charged to someone whose code ran into the time limit. A run
 * that spins until it is cut off occupies the sandbox for the whole timeout,
 * far longer than the 1 ms an ordinary one takes, so it costs more.
 */
export const TIMEOUT_PENALTY_REQUESTS = 2;

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, Entry>();
  private calls = 0;

  /** Number of keys currently remembered. */
  get size(): number {
    return this.buckets.size;
  }

  consume(key: string, policy: RateLimitPolicy, now = Date.now()): RateLimitResult {
    this.sweepOccasionally(now);

    const existing = this.buckets.get(key) ?? { timestamps: [], windowMs: policy.windowMs };
    const threshold = now - policy.windowMs;
    existing.timestamps = existing.timestamps.filter((timestamp) => timestamp > threshold);
    existing.windowMs = policy.windowMs;

    if (existing.timestamps.length >= policy.maxRequests) {
      const retryAfterMs = Math.max(0, policy.windowMs - (now - existing.timestamps[0]));
      this.buckets.set(key, existing);
      return { allowed: false, retryAfterMs };
    }

    existing.timestamps.push(now);
    this.buckets.set(key, existing);
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Counts `count` more requests against a key without asking whether they are allowed. */
  charge(key: string, policy: RateLimitPolicy, count: number, now = Date.now()): void {
    const existing = this.buckets.get(key) ?? { timestamps: [], windowMs: policy.windowMs };

    for (let charged = 0; charged < count; charged++) {
      existing.timestamps.push(now);
    }
    existing.windowMs = policy.windowMs;
    this.buckets.set(key, existing);
  }

  private sweepOccasionally(now: number): void {
    this.calls++;
    if (this.calls % SWEEP_EVERY !== 0) {
      return;
    }

    for (const [key, entry] of this.buckets) {
      const newest = entry.timestamps[entry.timestamps.length - 1];
      if (newest === undefined || newest <= now - entry.windowMs) {
        this.buckets.delete(key);
      }
    }
  }
}

export function isCodeLengthAllowed(code: string, maxLength: number): boolean {
  return code.length <= maxLength;
}

export function isInlineQueryLongEnough(code: string, minLength: number): boolean {
  return code.trim().length >= minLength;
}
