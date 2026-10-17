import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

describe("globals that are evaluated when first used", () => {
  test("are there to be found, and look like any other global", async () => {
    expect(await value(`return typeof structuredClone`)).toBe("function");
    expect(await value(`return "structuredClone" in globalThis`)).toBe("true");
    expect(await value(`return Object.keys(globalThis).includes("structuredClone")`)).toBe("false");
  });

  test("can be replaced by the program", async () => {
    expect(await value(`structuredClone = 5; return structuredClone`)).toBe("5");
    expect(await value(`globalThis.structuredClone = () => "mine"; return structuredClone()`)).toBe("mine");
  });

  test("do not give the program a way to ask the host for anything", async () => {
    expect(await value(`return [typeof loadExtra, typeof guestExtras, typeof indirectEval].join()`)).toBe(
      "undefined,undefined,undefined",
    );
  });

  test("keep working when the program has replaced the built-ins they rely on", async () => {
    expect(
      await value(`
        const define = Object.defineProperty;
        Object.defineProperty = () => { throw new Error("tampered") };
        globalThis.eval = () => { throw new Error("tampered eval") };
        return typeof structuredClone;
      `),
    ).toBe("function");
  });

  test("are not carried into the next run", async () => {
    await sandbox.execute(`structuredClone = "gone"; structuredClone`);

    expect(await value(`return typeof structuredClone`)).toBe("function");
  });
});

describe("structuredClone", () => {
  test("copies plain data, containers and typed arrays", async () => {
    expect(
      await value(`
        const original = {
          list: [1, { nested: new Date(0) }],
          map: new Map([[1, new Set([2])]]),
          pattern: /x/gi,
          big: 10n,
          bytes: new Uint8Array([1, 2, 3]),
        };
        const copy = structuredClone(original);
        return [
          copy !== original, copy.list !== original.list, copy.list[1].nested instanceof Date,
          copy.list[1].nested.getTime() === 0, copy.map.get(1).has(2), copy.pattern.flags,
          copy.big === 10n, copy.bytes.join(""), copy.bytes.buffer !== original.bytes.buffer,
        ].join();
      `),
    ).toBe("true,true,true,true,true,gi,true,123,true");
  });

  test("keeps cycles and shared references", async () => {
    expect(
      await value(`
        const shared = { n: 1 };
        const original = { a: shared, b: shared, items: [] };
        original.self = original;
        original.items.push(original);
        const copy = structuredClone(original);
        return [copy.self === copy, copy.items[0] === copy, copy.a === copy.b, copy.a !== shared].join();
      `),
    ).toBe("true,true,true,true");
  });

  test("does not keep prototypes or functions on the way", async () => {
    expect(await value(`class P { x = 1 }; return structuredClone(new P()).constructor === Object`)).toBe("true");
    expect(await value(`return structuredClone(new Date(5)) instanceof Date`)).toBe("true");
  });

  test("copies errors with their type, message and cause", async () => {
    expect(
      await value(`
        const copy = structuredClone(new RangeError("r", { cause: { n: 1 } }));
        return [copy instanceof RangeError, copy.message, copy.cause.n].join();
      `),
    ).toBe("true,r,1");
  });

  test("refuses what cannot be copied, with the error name a browser uses", async () => {
    expect(await value(`structuredClone(() => 1)`)).toBe("error: DataCloneError: () => 1 could not be cloned.");
    expect(await value(`structuredClone({ f() {} })`)).toContain("DataCloneError");
    expect(await value(`structuredClone(Symbol("s"))`)).toBe("error: DataCloneError: Symbol(s) could not be cloned.");
    expect(await value(`structuredClone(new WeakMap())`)).toContain("DataCloneError");
    expect(await value(`structuredClone()`)).toBe("error: TypeError: The value argument is required");
  });

  test("a structure nested too deep is the run's own stack overflow", async () => {
    const result = await sandbox.execute(`
      let deep = []; for (let i = 0; i < 100000; i++) deep = [deep];
      structuredClone(deep);
    `);

    expect(result.ok).toBe(false);
    expect((await sandbox.execute("1 + 1")).ok).toBe(true);
  });
});
