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

describe("SlidingWindowRateLimiter memory", () => {
  test("forgets users who stopped coming", () => {
    const limiter = new SlidingWindowRateLimiter();
    const policy = { windowMs: 1_000, maxRequests: 5 };

    for (let user = 0; user < 600; user++) {
      limiter.consume(`user-${user}`, policy, 0);
    }
    expect(limiter.size).toBe(600);

    // Long after every window has closed, one more request triggers a sweep.
    for (let call = 0; call < 500; call++) {
      limiter.consume("active", policy, 60_000 + call);
    }

    expect(limiter.size).toBe(1);
  });

  test("keeps users whose window is still open", () => {
    const limiter = new SlidingWindowRateLimiter();
    const policy = { windowMs: 10_000, maxRequests: 1 };

    limiter.consume("recent", policy, 0);
    for (let call = 0; call < 500; call++) {
      limiter.consume("other", { windowMs: 1, maxRequests: 1_000 }, 5_000 + call);
    }

    // Still inside its ten-second window, so still limited.
    expect(limiter.consume("recent", policy, 6_000).allowed).toBe(false);
  });
});
