import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

describe("Array.fromAsync", () => {
  test("collects an async generator", async () => {
    expect(
      await value(`
        async function* numbers() { yield 1; yield 2; yield 3 }
        const list = await Array.fromAsync(numbers());
        return [Array.isArray(list), list.join()].join();
      `),
    ).toBe("true,1,2,3");
  });

  test("waits for the values of a plain iterable that are promises", async () => {
    expect(
      await value(`
        const list = await Array.fromAsync(new Set([Promise.resolve("a"), "b", new Promise((r) => setTimeout(r, 5, "c"))]));
        return list.join();
      `),
    ).toBe("a,b,c");
  });

  test("reads an array-like and waits for its elements", async () => {
    expect(
      await value(`
        const list = await Array.fromAsync({ length: 2, 0: Promise.resolve("x"), 1: "y" });
        return list.join();
      `),
    ).toBe("x,y");
  });

  test("maps with the index, awaiting the result, and passes thisArg", async () => {
    expect(
      await value(`
        const list = await Array.fromAsync([10, 20], async function (item, index) { return item + index + this.add }, { add: 1 });
        return list.join();
      `),
    ).toBe("11,22");
  });

  test("returns a promise that rejects with what the source throws", async () => {
    expect(
      await value(`
        async function* broken() { yield 1; throw new RangeError("bad") }
        const promise = Array.fromAsync(broken());
        try { await promise } catch (e) { return [promise instanceof Promise, e.name].join() }
      `),
    ).toBe("true,RangeError");
  });

  test("rejects for a missing source or a mapper that is not a function", async () => {
    expect(await value(`try { await Array.fromAsync() } catch (e) { return e.name }`)).toBe("TypeError");
    expect(await value(`try { await Array.fromAsync([1], 5) } catch (e) { return e.name }`)).toBe("TypeError");
  });

  test("an empty source gives an empty array, and the function looks like the built-ins", async () => {
    expect(
      await value(`
        return [(await Array.fromAsync([])).length, Array.fromAsync.name, Array.fromAsync.length,
          Object.keys(Array).includes("fromAsync")].join();
      `),
    ).toBe("0,fromAsync,1,false");
  });
});
