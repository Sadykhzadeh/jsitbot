import { describe, expect, spyOn, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";
import type { SandboxExecution } from "../src/services/sandbox/types";

// A generous clock: the memory cases must end because the memory ran out, not
// because a slow machine ran out of time first.
const sandbox = new QuickJsSandboxService({
  timeoutMs: 4_000,
  memoryLimitBytes: 64 * 1024 * 1024,
  maxStackSizeBytes: 512 * 1024,
  maxLogs: 50,
  maxLogLength: 2_000,
  maxResultLength: 4_000,
});

// Same limits apart from a short clock, so the time-limit cases stay quick.
const quickSandbox = new QuickJsSandboxService({
  timeoutMs: 250,
  memoryLimitBytes: 64 * 1024 * 1024,
  maxStackSizeBytes: 512 * 1024,
  maxLogs: 50,
  maxLogLength: 2_000,
  maxResultLength: 4_000,
});

async function timed(
  code: string,
  service: QuickJsSandboxService = sandbox,
): Promise<{ result: SandboxExecution; wallMs: number }> {
  const startedAt = performance.now();
  const result = await service.execute(code);
  return { result, wallMs: performance.now() - startedAt };
}

async function expectStillHealthy(): Promise<void> {
  const result = await sandbox.execute("6 * 7");

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.result).toBe("42");
  }
}

describe("memory limits", () => {
  const bombs: Record<string, string> = {
    "megabyte strings in a loop": `
      const kept = [];
      while (true) kept.push("x".repeat(1024 * 1024));
    `,
    "arrays in a loop": `
      const kept = [];
      while (true) kept.push(new Array(100000).fill(1));
    `,
    "one huge string": `"x".repeat(2 ** 29).length`,
    "a string doubled until it cannot grow": `
      let s = "x";
      while (true) s += s;
    `,
    "one huge typed array": `new Uint8Array(2 ** 30).length`,
    "array buffers in a loop": `
      const kept = [];
      while (true) kept.push(new ArrayBuffer(1 << 20));
    `,
    "map that never stops growing": `
      const kept = new Map();
      for (let i = 0; ; i++) kept.set(i, "x".repeat(1000));
    `,
    "a promise chain that keeps every link alive": `
      function again() { return Promise.resolve().then(again); }
      again();
      await new Promise(() => {});
    `,
    "many small objects": `
      const kept = [];
      while (true) kept.push({ a: 1, b: [1, 2, 3] });
    `,
  };

  for (const [name, code] of Object.entries(bombs)) {
    test(`stops ${name} and keeps serving`, async () => {
      const { result, wallMs } = await timed(code);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("Sandbox exceeded its memory limit.");
      }
      expect(wallMs).toBeLessThan(3_500);

      await expectStillHealthy();
    });
  }

  test("reports a result too big to flatten as the memory limit, not as an unreadable result", async () => {
    // A doubled string costs almost nothing to build, and holding it as text needs the memory it does not have.
    const { result } = await timed(`let s = "x"; for (let i = 0; i < 28; i++) s += s; s`);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Sandbox exceeded its memory limit.");
    }
    await expectStillHealthy();
  });

  test("honours a lower configured limit", async () => {
    const small = new QuickJsSandboxService({ memoryLimitBytes: 4 * 1024 * 1024 });
    const startedAt = performance.now();
    const result = await small.execute(`
      const kept = [];
      while (true) kept.push("x".repeat(1024 * 1024));
    `);

    expect(result.ok).toBe(false);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  test("lets a reasonable allocation through", async () => {
    const result = await sandbox.execute(`
      const rows = Array.from({ length: 50000 }, (_, i) => i * 2);
      return rows.length;
    `);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe("50000");
    }
  });
});

describe("giving memory back", () => {
  // A dropped instance is only freed when the collector runs, and the collector
  // counts each one as 16 MB however much of it was used. Without a nudge, a
  // run of runs that each fill the cap piles up several hundred megabytes.
  async function collections(code: string): Promise<number> {
    const collect = spyOn(Bun, "gc");
    try {
      await sandbox.execute(code);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return collect.mock.calls.length;
    } finally {
      collect.mockRestore();
    }
  }

  test("collects garbage after a run that filled much of the memory", async () => {
    expect(await collections(`"x".repeat(40e6).length`)).toBeGreaterThan(0);
    expect(await collections(`const kept = []; while (true) kept.push("x".repeat(1024 * 1024))`)).toBeGreaterThan(0);
  });

  test("leaves an ordinary run alone", async () => {
    expect(await collections(`[1, 2, 3].map((n) => n * 2)`)).toBe(0);
    expect(await collections(`const text = "x".repeat(1000); text.length`)).toBe(0);
  });
});

describe("time limits", () => {
  const spinners: Record<string, string> = {
    "an empty loop": `while (true) {}`,
    "a loop that swallows errors": `
      while (true) {
        try { for (;;) {} } catch (error) {}
      }
    `,
    "a loop inside a finally block": `
      try { throw 1 } finally { while (true) {} }
    `,
    "recursion that allocates": `
      const sink = [];
      function spin() { sink.push([]); spin(); sink.length = 0; spin(); }
      try { spin() } catch (error) {}
      while (true) {}
    `,
    "a promise chain that never ends": `
      function again() { Promise.resolve().then(again); }
      again();
      await new Promise(() => {});
    `,
    "a spin inside an async function": `
      await Promise.resolve();
      while (true) {}
    `,
    "a runaway regular expression": `/^(a+)+$/.test("a".repeat(40) + "b")`,
    "a getter that never returns": `
      const trap = { get value() { while (true) {} } };
      return trap.value;
    `,
    "a proxy trap that never returns": `
      const trap = new Proxy({}, { ownKeys() { while (true) {} } });
      return Object.keys(trap);
    `,
  };

  for (const [name, code] of Object.entries(spinners)) {
    test(`stops ${name} and keeps serving`, async () => {
      const { result, wallMs } = await timed(code, quickSandbox);

      expect(result.ok).toBe(false);
      expect(result.timedOut).toBe(true);
      if (!result.ok) {
        expect(result.error).toBe("Sandbox execution timed out.");
      }
      expect(wallMs).toBeLessThan(1_000);

      await expectStillHealthy();
    });
  }

  test("does not charge the guest for time spent waiting to start", async () => {
    const pending = quickSandbox.execute("1 + 1");
    const blockedUntil = performance.now() + 600;
    while (performance.now() < blockedUntil) {
      // Stand-in for a queue: the guest has not started, but the clock at the
      // call site is already well past the timeout.
    }
    const result = await pending;

    expect(result.ok).toBe(true);
  });
});
