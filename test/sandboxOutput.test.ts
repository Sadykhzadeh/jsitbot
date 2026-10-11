import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";
import type { SandboxExecution } from "../src/services/sandbox/types";

const sandbox = new QuickJsSandboxService({
  timeoutMs: 700,
  memoryLimitBytes: 64 * 1024 * 1024,
  maxStackSizeBytes: 512 * 1024,
  maxLogs: 50,
  maxLogLength: 2_000,
  maxResultLength: 4_000,
});

async function timed(code: string): Promise<{ result: SandboxExecution; wallMs: number }> {
  const startedAt = performance.now();
  const result = await sandbox.execute(code);
  return { result, wallMs: performance.now() - startedAt };
}

describe("output limits", () => {
  test("keeps only the first logs of a flood", async () => {
    const { result, wallMs } = await timed(`
      for (let i = 0; i < 100000; i++) console.log("line " + i);
      return "done";
    `);

    expect(result.ok).toBe(true);
    expect(result.logs).toHaveLength(50);
    expect(result.logs[0]).toBe("line 0");
    expect(result.logs[49]).toBe("line 49");
    expect(result.truncated).toBe(true);
    expect(wallMs).toBeLessThan(1_000);
  });

  test("cuts one enormous log line down to size", async () => {
    const { result } = await timed(`console.log("x".repeat(20 * 1024 * 1024)); return 1;`);

    expect(result.ok).toBe(true);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].length).toBeLessThanOrEqual(2_000);
    expect(result.logs[0].endsWith("...")).toBe(true);
    expect(result.truncated).toBe(true);
  });

  test("cuts a log call with thousands of arguments", async () => {
    const { result } = await timed(`console.log(...new Array(20000).fill("word")); return 1;`);

    expect(result.ok).toBe(true);
    expect(result.logs[0].length).toBeLessThanOrEqual(2_000);
    expect(result.truncated).toBe(true);
  });

  test("cuts an enormous result", async () => {
    const { result } = await timed(`"x".repeat(20 * 1024 * 1024)`);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.length).toBeLessThanOrEqual(4_000);
      expect(result.result.endsWith("...")).toBe(true);
    }
    expect(result.truncated).toBe(true);
  });

  test("summarises a huge object graph instead of walking it", async () => {
    const { result, wallMs } = await timed(`
      return Array.from({ length: 200000 }, (_, i) => ({ id: i, payload: "x".repeat(50) }));
    `);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.length).toBeLessThanOrEqual(4_000);
      expect(result.result).toContain("more items");
    }
    expect(result.truncated).toBe(true);
    expect(wallMs).toBeLessThan(2_000);
  });

  test("summarises an object with a very large number of keys", async () => {
    const { result, wallMs } = await timed(`
      const bag = {};
      for (let i = 0; i < 100000; i++) bag["key" + i] = i;
      return bag;
    `);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.length).toBeLessThanOrEqual(4_000);
      expect(result.result).toContain("more properties");
    }
    expect(wallMs).toBeLessThan(2_000);
  });

  test("summarises a map with a very large number of entries", async () => {
    const { result } = await timed(`
      const big = new Map();
      for (let i = 0; i < 200000; i++) big.set(i, i);
      return big;
    `);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.startsWith("Map(200000) {")).toBe(true);
      expect(result.result.length).toBeLessThanOrEqual(4_000);
    }
  });

  test("does not walk a structure nested a hundred thousand levels deep", async () => {
    const { result, wallMs } = await timed(`
      let nested = [];
      for (let i = 0; i < 100000; i++) nested = [nested];
      return nested;
    `);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe("[ [ [ [ [Array] ] ] ] ]");
    }
    expect(wallMs).toBeLessThan(1_000);
  });

  test("cuts an enormous error message", async () => {
    const { result } = await timed(`throw new Error("x".repeat(20 * 1024 * 1024))`);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeLessThanOrEqual(4_000);
      expect(result.error.startsWith("Error: xxx")).toBe(true);
    }
    expect(result.truncated).toBe(true);
  });

  test("cuts an enormous thrown string", async () => {
    const { result } = await timed(`throw "x".repeat(20 * 1024 * 1024)`);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeLessThanOrEqual(4_000);
    }
  });

  test("reports a result that fits without marking it truncated", async () => {
    const { result } = await timed(`console.log("short"); return "short";`);

    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(false);
  });
});
