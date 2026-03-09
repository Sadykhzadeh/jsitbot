import { describe, expect, test } from "bun:test";

import {
  SlidingWindowRateLimiter,
  isCodeLengthAllowed,
  isInlineQueryLongEnough,
} from "../src/security/rateLimiter";

describe("SlidingWindowRateLimiter", () => {
  test("allows requests within the configured window", () => {
    const limiter = new SlidingWindowRateLimiter();
    const policy = { windowMs: 1_000, maxRequests: 2 };

    expect(limiter.consume("user", policy, 0).allowed).toBe(true);
    expect(limiter.consume("user", policy, 500).allowed).toBe(true);
    expect(limiter.consume("user", policy, 600).allowed).toBe(false);
  });

  test("expires old timestamps", () => {
    const limiter = new SlidingWindowRateLimiter();
    const policy = { windowMs: 1_000, maxRequests: 1 };

    expect(limiter.consume("user", policy, 0).allowed).toBe(true);
    expect(limiter.consume("user", policy, 999).allowed).toBe(false);
    expect(limiter.consume("user", policy, 1_001).allowed).toBe(true);
  });

  test("validates shared code-length guards", () => {
    expect(isCodeLengthAllowed("12345", 5)).toBe(true);
    expect(isCodeLengthAllowed("123456", 5)).toBe(false);
    expect(isInlineQueryLongEnough(" 12 ", 3)).toBe(false);
    expect(isInlineQueryLongEnough(" 123 ", 3)).toBe(true);
  });
});
