import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

describe("global", () => {
  test("is the global object, as it is in Node", async () => {
    expect(await value(`global.answer = 42; return [global === globalThis, answer].join()`)).toBe("true,42");
  });

  test("is not listed among the properties of the global object, and can be replaced", async () => {
    expect(await value(`return Object.keys(globalThis).includes("global")`)).toBe("false");
    expect(await value(`global = 5; return global`)).toBe("5");
  });
});

describe("Symbol.dispose and Symbol.asyncDispose", () => {
  test("are symbols with the names Node gives them, so a class can define its disposal", async () => {
    expect(
      await value(`
        class Handle { [Symbol.dispose]() { return "closed" } async [Symbol.asyncDispose]() {} }
        const h = new Handle();
        return [typeof Symbol.dispose, String(Symbol.dispose), String(Symbol.asyncDispose), h[Symbol.dispose](), Object.getOwnPropertyNames(Handle.prototype).join()].join();
      `),
    ).toBe("symbol,Symbol(Symbol.dispose),Symbol(Symbol.asyncDispose),closed,constructor");
  });

  test("cannot be changed, as the well-known symbols cannot", async () => {
    expect(await value(`"use strict"; Symbol.dispose = 1`)).toContain("TypeError");
  });
});
