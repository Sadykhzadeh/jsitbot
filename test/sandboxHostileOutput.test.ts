import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";
import type { SandboxExecution } from "../src/services/sandbox/types";

// Values built to go wrong when the sandbox turns them into text: traps that
// throw or never return, coercions that run user code, structures of absurd
// size. The text is made inside the guest and under its deadline, so the worst
// outcome has to be the run's own failure, never a hung or broken sandbox.
const sandbox = new QuickJsSandboxService({ timeoutMs: 300 });

async function run(code: string): Promise<{ result: SandboxExecution; wallMs: number }> {
  const startedAt = performance.now();
  const result = await sandbox.execute(code);

  return { result, wallMs: performance.now() - startedAt };
}

function text(result: SandboxExecution): string {
  return result.ok ? result.result : result.error;
}

describe("values the formatter must not trust", () => {
  test("coercion hooks are never called to print a value", async () => {
    const { result, wallMs } = await run(`
      const trap = () => { while (true) {} };
      console.log({ [Symbol.toPrimitive]: trap, toString: trap, valueOf: trap, toJSON: trap }, [{ toString: trap }]);
      return { [Symbol.toPrimitive]: trap, toString: trap, valueOf: trap, toJSON: trap };
    `);

    expect(result.ok).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]).toContain("toString: [Function: trap]");
    expect(wallMs).toBeLessThan(1_000);
  });

  test("a proxy whose traps throw prints as unformattable", async () => {
    const { result } = await run(`
      const hostile = new Proxy({}, { ownKeys() { throw new Error("keys") }, get() { throw 1 }, getPrototypeOf() { throw 2 } });
      console.log(hostile, { inside: hostile });
      return 1;
    `);

    expect(result.ok).toBe(true);
    expect(result.logs).toEqual(["[Unformattable object] { inside: [Unformattable object] }"]);
  });

  test("a proxy that claims a billion items prints a bounded list quickly", async () => {
    const { result, wallMs } = await run(`new Proxy([], { get(target, key) { return key === "length" ? 1e9 : 1 } })`);

    expect(result.ok).toBe(true);
    expect(text(result).length).toBeLessThan(4_000);
    expect(result.truncated).toBe(true);
    expect(wallMs).toBeLessThan(1_000);
  });

  test("getters are named, not run", async () => {
    const { result } = await run(`console.log({ get a() { while (true) {} } }); ({ get b() { while (true) {} }, set c(v) {} })`);

    expect(result.timedOut).toBe(false);
    expect(result.logs).toEqual(["{ a: [Getter] }"]);
    expect(text(result)).toBe("{ b: [Getter], c: [Setter] }");
  });

  test("a revoked proxy is an error of the run, not of the sandbox", async () => {
    const { result } = await run(`const r = Proxy.revocable({}, {}); r.revoke(); r.proxy`);

    expect(result.ok).toBe(false);
    expect((await run("1 + 1")).result.ok).toBe(true);
  });

  for (const [name, code] of Object.entries({
    "an error whose message is a getter that never returns": `
      const e = new Error("x");
      Object.defineProperty(e, "message", { get() { while (true) {} } });
      throw e;
    `,
    "an error whose stack is a getter that never returns": `
      const e = new Error("x");
      Object.defineProperty(e, "stack", { get() { while (true) {} } });
      throw e;
    `,
    "a thrown object whose message never returns": `throw { get message() { while (true) {} } }`,
    "a thenable that never returns": `({ then() { while (true) {} } })`,
  })) {
    test(`${name} ends at the time limit and the sandbox keeps serving`, async () => {
      const { result, wallMs } = await run(code);

      expect(result.ok).toBe(false);
      expect(result.timedOut).toBe(true);
      expect(wallMs).toBeLessThan(900);
      expect(text((await run("2 + 2")).result)).toBe("4");
    });
  }

  test("an error whose name throws still gets reported", async () => {
    const { result } = await run(`
      const e = new Error("x");
      Object.defineProperty(e, "name", { get() { throw 1 } });
      throw e;
    `);

    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(false);
  });

  test("things that are thrown that are not errors are named", async () => {
    expect(text((await run(`throw null`)).result)).toBe("Uncaught null");
    expect(text((await run(`throw Symbol("s")`)).result)).toBe("Uncaught Symbol(s)");
    expect(text((await run(`throw 10n`)).result)).toBe("Uncaught 10n");
    expect(text((await run(`throw { toString() { while (true) {} } }`)).result)).toContain("Uncaught");
  });
});

describe("structures of absurd size", () => {
  const shapes: Record<string, string> = {
    "an array nested a hundred thousand deep": `let a = []; for (let i = 0; i < 100000; i++) a = [a]; a`,
    "an object nested a hundred thousand deep": `let a = {}; for (let i = 0; i < 100000; i++) a = { a }; a`,
    "a map with a hundred thousand entries": `new Map(Array.from({ length: 100000 }, (_, i) => [i, { i }]))`,
    "a set with a hundred thousand entries": `new Set(Array.from({ length: 100000 }, (_, i) => "item" + i))`,
    "an object with a hundred thousand keys": `Object.fromEntries(Array.from({ length: 100000 }, (_, i) => ["k" + i, i]))`,
    "a sparse array with four billion slots": `const a = []; a[2 ** 32 - 2] = 1; a`,
    "a typed array of a million items": `new Uint8Array(1e6)`,
    "keys and symbols of five thousand characters": `({ [Symbol("a".repeat(5000))]: 1, ["b".repeat(5000)]: 2 })`,
  };

  for (const [name, code] of Object.entries(shapes)) {
    test(`prints ${name} as a bounded text`, async () => {
      const { result, wallMs } = await run(code);

      expect(result.ok).toBe(true);
      expect(text(result).length).toBeLessThanOrEqual(4_000);
      expect(wallMs).toBeLessThan(600);
    });
  }

  test("eighty large logs keep to fifty bounded lines", async () => {
    const { result } = await run(`
      for (let i = 0; i < 80; i++) console.log(Array.from({ length: 500 }, (_, j) => ({ j, i })));
      return 1;
    `);

    expect(result.ok).toBe(true);
    expect(result.logs).toHaveLength(50);
    expect(Math.max(...result.logs.map((line) => line.length))).toBeLessThanOrEqual(2_000);
    expect(result.truncated).toBe(true);
  });

  test("cycles are named", async () => {
    const { result } = await run(`const a = { name: "a" }; a.self = a; a.list = [a, { a }]; a`);

    expect(text(result)).toContain("self: [Circular]");
  });
});

describe("what the guest cannot do to block the process", () => {
  test("Atomics is not there to wait on", async () => {
    const { result } = await run(`Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100000)`);

    expect(result.ok).toBe(false);
    expect(text(result)).toContain("Atomics");
  });

  test("a flood of promise jobs and of timers ends at the time limit", async () => {
    const jobs = await run(`async function f() { while (true) await null } f(); await new Promise(() => {})`);
    const timers = await run(`const f = () => setTimeout(f, 0); f(); await new Promise(() => {})`);

    expect(jobs.result.timedOut).toBe(true);
    expect(timers.result.timedOut).toBe(true);
    expect(text((await run("3 + 3")).result)).toBe("6");
  });
});
