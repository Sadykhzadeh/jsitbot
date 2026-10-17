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

describe("setInterval", () => {
  test("repeats until it is cleared, on the virtual clock", async () => {
    const startedAt = performance.now();
    const result = await sandbox.execute(`
      let runs = 0;
      const id = setInterval(() => {
        console.log("tick", ++runs);
        if (runs === 3) clearInterval(id);
      }, 1000);
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      return runs;
    `);

    expect(result.ok && result.result).toBe("3");
    expect(result.logs).toEqual(["tick 1", "tick 2", "tick 3"]);
    expect(performance.now() - startedAt).toBeLessThan(500);
  });

  test("interleaves with timeouts by time", async () => {
    const result = await sandbox.execute(`
      const seen = [];
      const id = setInterval(() => seen.push("i"), 10);
      setTimeout(() => seen.push("t"), 25);
      setTimeout(() => clearInterval(id), 35);
      await new Promise((resolve) => setTimeout(resolve, 50));
      return seen.join("");
    `);

    expect(result.ok && result.result).toBe("iiti");
  });

  test("passes extra arguments and ignores ids it does not know", async () => {
    const result = await sandbox.execute(`
      const id = setInterval((a, b) => {
        console.log(a + b);
        clearInterval(id);
      }, 5, 2, 3);
      clearInterval(12345);
      clearInterval(undefined);
    `);

    expect(result.logs).toEqual(["5"]);
  });

  test("one that is never cleared runs into the time limit, with what it printed kept", async () => {
    const result = await quickSandbox.execute(`setInterval(() => console.log("again"), 10); 1`);

    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.logs.length).toBeGreaterThan(0);
  });

  test("an error in the callback ends the run with that error", async () => {
    expect(await value(`setInterval(() => { throw new RangeError("stop") }, 5)`)).toBe("error: RangeError: stop");
  });

  test("rejects a callback that is not a function", async () => {
    expect(await value(`setInterval("code", 5)`)).toBe("error: TypeError: The callback must be a function");
  });
});

describe("queueMicrotask", () => {
  test("runs after the current code and before the next timer", async () => {
    const result = await sandbox.execute(`
      setTimeout(() => console.log("timer"), 0);
      queueMicrotask(() => console.log("microtask"));
      console.log("sync");
    `);

    expect(result.logs).toEqual(["sync", "microtask", "timer"]);
  });

  test("logs an error from the callback instead of dropping it", async () => {
    const result = await sandbox.execute(`
      queueMicrotask(() => { throw new TypeError("bad") });
      await null;
      return "done";
    `);

    expect(result.ok && result.result).toBe("done");
    expect(result.logs).toEqual(["Uncaught TypeError: bad"]);
  });

  test("rejects a callback that is not a function", async () => {
    expect(await value(`queueMicrotask(1)`)).toBe("error: TypeError: The callback must be a function");
  });
});

describe("performance.now", () => {
  test("includes the time a sleep skipped", async () => {
    const elapsed = Number(await value(`
      const before = performance.now();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return Math.round(performance.now() - before);
    `));

    expect(elapsed).toBeGreaterThanOrEqual(500);
    expect(elapsed).toBeLessThan(600);
  });

  test("moves with real time while code is running, and never goes back", async () => {
    expect(await value(`
      const first = performance.now();
      let last = first;
      for (let i = 0; i < 100000; i++) {
        const now = performance.now();
        if (now < last) return "went back";
        last = now;
      }
      return first >= 0 && typeof performance.timeOrigin === "number";
    `)).toBe("true");
  });
});
