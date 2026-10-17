import { describe, expect, test } from "bun:test";

import {
  SandboxTimeBudget,
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

describe("SlidingWindowRateLimiter charges", () => {
  test("count against the window without being checked", () => {
    const limiter = new SlidingWindowRateLimiter();
    const policy = { windowMs: 1_000, maxRequests: 3 };

    expect(limiter.consume("user", policy, 0).allowed).toBe(true);
    limiter.charge("user", policy, 2, 100);

    expect(limiter.consume("user", policy, 200).allowed).toBe(false);
  });

  test("expire with the window like any other request", () => {
    const limiter = new SlidingWindowRateLimiter();
    const policy = { windowMs: 1_000, maxRequests: 3 };

    limiter.charge("user", policy, 3, 0);

    expect(limiter.consume("user", policy, 999).allowed).toBe(false);
    expect(limiter.consume("user", policy, 1_001).allowed).toBe(true);
  });

  test("can push a key over its limit, which blocks the next request", () => {
    const limiter = new SlidingWindowRateLimiter();
    const policy = { windowMs: 1_000, maxRequests: 2 };

    limiter.charge("user", policy, 5, 0);

    expect(limiter.consume("user", policy, 10).allowed).toBe(false);
  });
});

describe("SandboxTimeBudget", () => {
  const policy = { windowMs: 10_000, maxMs: 1_000 };

  test("lets a user run until the time they used adds up to the budget", () => {
    const budget = new SandboxTimeBudget();

    expect(budget.check("a", policy, 0).allowed).toBe(true);
    budget.record("a", 700, policy, 0);
    expect(budget.check("a", policy, 1_000).allowed).toBe(true);
    budget.record("a", 700, policy, 1_000);
    expect(budget.check("a", policy, 2_000).allowed).toBe(false);
  });

  test("says when enough of the old time has aged out", () => {
    const budget = new SandboxTimeBudget();
    budget.record("a", 700, policy, 1_000);
    budget.record("a", 700, policy, 3_000);

    // The first 700 ms leave the window at 11 000, which brings the total under 1 000.
    expect(budget.check("a", policy, 5_000)).toEqual({ allowed: false, retryAfterMs: 6_000 });
    expect(budget.check("a", policy, 11_001).allowed).toBe(true);
  });

  test("keeps users apart, and many quick runs do not add up to much", () => {
    const budget = new SandboxTimeBudget();
    for (let run = 0; run < 100; run++) {
      budget.record("quick", 2, policy, run * 10);
    }
    budget.record("slow", 900, policy, 0);

    expect(budget.check("quick", policy, 1_000).allowed).toBe(true);
    budget.record("slow", 900, policy, 0);
    expect(budget.check("slow", policy, 1_000).allowed).toBe(false);
    expect(budget.check("other", policy, 1_000).allowed).toBe(true);
  });

  test("a run too quick to measure still counts", () => {
    const budget = new SandboxTimeBudget();
    for (let run = 0; run < 1_000; run++) {
      budget.record("a", 0, policy, 0);
    }

    expect(budget.check("a", policy, 1).allowed).toBe(false);
  });

  test("forgets users who stopped coming", () => {
    const budget = new SandboxTimeBudget();
    for (let user = 0; user < 100; user++) {
      budget.record(`user${user}`, 5, policy, 0);
    }

    for (let call = 0; call < 600; call++) {
      budget.check("active", policy, 60_000);
    }

    expect(budget.size).toBe(0);
  });
});
