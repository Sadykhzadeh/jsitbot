import { describe, expect, test } from "bun:test";

import { loadEnv } from "../src/config/env";
import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function logs(code: string): Promise<string[]> {
  const execution = await sandbox.execute(code);

  expect(execution.ok).toBe(true);
  return execution.logs;
}

describe("running out of stack", () => {
  test("is a RangeError, as in Node", async () => {
    expect(
      await logs(`
        function f() { f(); }
        try { f(); } catch (e) {
          console.log(e instanceof RangeError, e instanceof Error, e.name);
        }
      `),
    ).toEqual(["true true RangeError"]);
  });

  test("reads the same when it is not caught", async () => {
    const execution = await sandbox.execute(`function f() { return f() + 1; } f();`);

    expect(execution.ok).toBe(false);
    expect(execution.ok ? "" : execution.error).toBe("RangeError: Maximum call stack size exceeded");
  });

  test("reads the same when it goes through a built-in that calls back", async () => {
    for (const code of [`function f() { [1].map(f); } f();`, `const o = { toString() { return "" + this; } }; "" + o;`]) {
      const execution = await sandbox.execute(code);

      expect(execution.ok).toBe(false);
      expect(execution.ok ? "" : execution.error).toBe("RangeError: Maximum call stack size exceeded");
    }
  });

  test("reads the same when it is printed", async () => {
    expect(
      await logs(`
        function f() { f(); }
        try { f(); } catch (e) { console.log(e); }
      `),
    ).toEqual(["RangeError: Maximum call stack size exceeded"]);
  });

  test("leaves the other errors of the engine as they are", async () => {
    const execution = await sandbox.execute(`
      let text = "x";
      for (;;) text += text;
    `);

    expect(execution.ok).toBe(false);
    expect(execution.ok ? "" : execution.error).not.toContain("RangeError");
  });
});

describe("the depth of recursion the bot allows", () => {
  const bot = new QuickJsSandboxService(loadEnv({ BOT_TOKEN: "123456789:AAH-valid_token0123456789abcdefghijk" }).sandbox);

  test("runs a recursion two thousand calls deep", async () => {
    const execution = await bot.execute(`
      function depth(n) { return n === 0 ? 0 : 1 + depth(n - 1); }
      depth(2000);
    `);

    expect(execution.ok).toBe(true);
    expect(execution.ok ? execution.result : "").toBe("2000");
  });
});
