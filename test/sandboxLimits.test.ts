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
    "one huge typed array": `new Uint8Array(2 ** 30).length`,
    "array buffers in a loop": `
      const kept = [];
      while (true) kept.push(new ArrayBuffer(1 << 20));
    `,
    "map that never stops growing": `
      const kept = new Map();
      for (let i = 0; ; i++) kept.set(i, "x".repeat(1000));
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
      expect(wallMs).toBeLessThan(3_000);

      await expectStillHealthy();
    });
  }

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
