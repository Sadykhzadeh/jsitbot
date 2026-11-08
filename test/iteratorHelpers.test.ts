import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

describe("iterator helpers stopped early", () => {
  test("some, find and the like finish when they found what they look for", async () => {
    expect(await value(`return [1, 2, 3].values().map((x) => x).some((x) => x === 2)`)).toBe("true");
    expect(await value(`return [1, 2, 3].values().filter(() => true).find((x) => x === 2)`)).toBe("2");
    expect(await value(`return [1, 2, 3].values().drop(1).every((x) => x > 5)`)).toBe("false");
    expect(await value(`return new Set([1, 2, 3]).values().map((x) => x * 2).some((x) => x === 4)`)).toBe("true");
    expect(await value(`return "abc"[Symbol.iterator]().filter(() => true).find((c) => c === "b")`)).toBe("b");
  });

  test("a loop over one can be left with break or a destructuring", async () => {
    expect(await value(`let n = 0; for (const x of [1, 2, 3].values().map((x) => x * 2)) { n = x; break } return n`)).toBe("2");
    expect(await value(`const [a] = new Map([[1, 2]]).entries().map(([k, v]) => k + v); return a`)).toBe("3");
  });

  test("the iterator under it is still told to close when it can be", async () => {
    expect(
      await value(`
        function* g() { try { yield 1; yield 2 } finally { globalThis.closed = true } }
        for (const x of g().map((x) => x)) break;
        return globalThis.closed`),
    ).toBe("true");
  });

  test("an error from the iterator under it still comes out", async () => {
    expect(
      await value(`
        const it = [1, 2].values();
        it.return = () => { throw new RangeError("boom") };
        try { it.map((x) => x).some(() => true) } catch (e) { return e.name }`),
    ).toBe("RangeError");
  });
});
