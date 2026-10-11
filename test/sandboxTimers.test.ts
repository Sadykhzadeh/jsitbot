import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();
const quickSandbox = new QuickJsSandboxService({ timeoutMs: 250 });

async function value(code: string, service = sandbox): Promise<string> {
  const result = await service.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

describe("setTimeout", () => {
  test("a sleep finishes at once, however long it asks for", async () => {
    const startedAt = performance.now();
    const result = await value(`await new Promise((resolve) => setTimeout(resolve, 60_000)); return "woke"`);

    expect(result).toBe("woke");
    expect(performance.now() - startedAt).toBeLessThan(500);
  });

  test("fires timers by delay, then in the order they were set", async () => {
    const order = await value(`
      const seen = [];
      setTimeout(() => seen.push("c"), 20);
      setTimeout(() => seen.push("a"), 10);
      setTimeout(() => seen.push("d"), 20);
      setTimeout(() => seen.push("b"), 10);
      await new Promise((resolve) => setTimeout(resolve, 30));
      return seen.join("");
    `);

    expect(order).toBe("abcd");
  });

  test("a timer set inside a timer counts from when its parent fired", async () => {
    const order = await value(`
      const seen = [];
      setTimeout(() => {
        seen.push("outer");
        setTimeout(() => seen.push("inner"), 5);
      }, 10);
      setTimeout(() => seen.push("between"), 12);
      await new Promise((resolve) => setTimeout(resolve, 30));
      return seen.join(" ");
    `);

    expect(order).toBe("outer between inner");
  });

  test("passes extra arguments to the callback", async () => {
    const result = await sandbox.execute(`setTimeout((a, b) => console.log(a + b), 1, 2, 3)`);

    expect(result.ok && result.logs).toEqual(["5"]);
  });

  test("timers left over when the code finishes still run", async () => {
    const result = await sandbox.execute(`setTimeout(() => console.log("later"), 10); "now"`);

    expect(result.ok && result.result).toBe("now");
    expect(result.logs).toEqual(["later"]);
  });

  test("clearTimeout stops a timer and ignores ids it does not know", async () => {
    const result = await sandbox.execute(`
      const id = setTimeout(() => console.log("never"), 1);
      clearTimeout(id);
      clearTimeout(12345);
      clearTimeout(undefined);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return "done";
    `);

    expect(result.ok && result.result).toBe("done");
    expect(result.logs).toEqual([]);
  });

  test("a missing or odd delay counts as 1 ms", async () => {
    const order = await value(`
      const seen = [];
      setTimeout(() => seen.push("late"), 2);
      setTimeout(() => seen.push("none"));
      setTimeout(() => seen.push("nan"), NaN);
      setTimeout(() => seen.push("negative"), -50);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return seen.join(" ");
    `);

    expect(order).toBe("none nan negative late");
  });

  test("rejects a callback that is not a function", async () => {
    expect(await value(`setTimeout("1 + 1", 1)`)).toContain("TypeError");
  });

  test("an error thrown in a timer ends the run with that error", async () => {
    const result = await sandbox.execute(`
      setTimeout(() => { throw new Error("from a timer"); }, 1);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return "unreachable";
    `);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("from a timer");
  });

  test("still reports a promise that nothing will settle", async () => {
    const result = await sandbox.execute(`await new Promise(() => {}); return 1`);

    expect(!result.ok && result.error).toContain("can never settle");
  });

  test("a timer that keeps rescheduling itself hits the time limit", async () => {
    const startedAt = performance.now();
    const result = await quickSandbox.execute(`(function again() { setTimeout(again, 1); })()`);

    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(performance.now() - startedAt).toBeLessThan(1_500);
  });

  test("a thousand timers are fine", async () => {
    const result = await value(`
      let fired = 0;
      for (let i = 0; i < 1000; i++) setTimeout(() => fired++, i % 50);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return fired;
    `);

    expect(result).toBe("1000");
  });

  test("nothing survives into the next run", async () => {
    await sandbox.execute(`setTimeout(() => console.log("leak"), 1000); 1`);
    const next = await sandbox.execute(`await new Promise((resolve) => setTimeout(resolve, 2000)); return typeof globalThis.leak`);

    expect(next.logs).toEqual([]);
    expect(next.ok && next.result).toBe("undefined");
  });

  test("replacing Array.prototype.splice does not break timers", async () => {
    const result = await sandbox.execute(`
      Array.prototype.splice = () => { throw new Error("hijacked"); };
      setTimeout(() => console.log("ran"), 1);
      1
    `);

    expect(result.ok).toBe(true);
    expect(result.logs).toEqual(["ran"]);
  });
});
