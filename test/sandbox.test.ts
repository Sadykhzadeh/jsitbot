import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService({
  timeoutMs: 700,
  memoryLimitBytes: 64 * 1024 * 1024,
  maxStackSizeBytes: 512 * 1024,
  maxLogs: 50,
  maxLogLength: 2_000,
  maxResultLength: 4_000,
});

describe("QuickJsSandboxService", () => {
  test("evaluates an expression", async () => {
    const result = await sandbox.execute("1 + 1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe("2");
      expect(result.logs).toEqual([]);
    }
  });

  test("captures console.log output in order", async () => {
    const result = await sandbox.execute(`
      console.log("first");
      console.log({ second: true });
      return 42;
    `);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.logs).toEqual(["first", "{\"second\":true}"]);
      expect(result.result).toBe("42");
    }
  });

  test("supports async await inside the VM", async () => {
    const result = await sandbox.execute("await Promise.resolve(5 * 5)");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe("25");
    }
  });

  test("returns undefined when no explicit value is returned", async () => {
    const result = await sandbox.execute(`
      const value = 123;
      void value;
    `);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe("undefined");
    }
  });

  test("rejects access to host globals", async () => {
    const result = await sandbox.execute(`
      return JSON.stringify({
        process: typeof process,
        Bun: typeof Bun,
        fetch: typeof fetch,
        require: typeof require,
        setTimeout: typeof setTimeout,
      });
    `);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe(
        "{\"process\":\"undefined\",\"Bun\":\"undefined\",\"fetch\":\"undefined\",\"require\":\"undefined\",\"setTimeout\":\"undefined\"}",
      );
    }
  });

  test("surfaces runtime errors", async () => {
    const result = await sandbox.execute(`throw new Error("boom")`);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("boom");
    }
  });

  test("times out infinite loops", async () => {
    const result = await sandbox.execute("while (true) {}");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.timedOut).toBe(true);
    }
  });

  test("fails deep recursion via limits", async () => {
    const result = await sandbox.execute(`
      function recurse() {
        return recurse();
      }

      return recurse();
    `);

    expect(result.ok).toBe(false);
  });

  test("fails large allocations via memory limits", async () => {
    const lowMemorySandbox = new QuickJsSandboxService({
      timeoutMs: 700,
      memoryLimitBytes: 4 * 1024 * 1024,
      maxStackSizeBytes: 512 * 1024,
      maxLogs: 50,
      maxLogLength: 2_000,
      maxResultLength: 4_000,
    });

    const result = await lowMemorySandbox.execute(`
      const values = [];
      while (true) {
        values.push("x".repeat(1024 * 1024));
      }
    `);

    expect(result.ok).toBe(false);
  });
});
