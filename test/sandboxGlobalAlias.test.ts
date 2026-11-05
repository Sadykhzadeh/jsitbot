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
