import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

// Each row is a program that throws, and the line Node 26.13.0 printed for it: the error's
// name and message. Rows that the sandbox words differently are not here.
const CASES: Array<[string, string]> = [
  ["[...undefined]", "TypeError: undefined is not iterable"],
  ["const [a] = null;", "TypeError: null is not iterable"],
  ["const [b] = undefined;", "TypeError: undefined is not iterable"],
];

describe("errors for values that are not iterable", () => {
  test("prints the error the way Node does", async () => {
    for (const [code, expected] of CASES) {
      const result = await sandbox.execute(code);
      expect(result.ok ? "OK" : result.error, code).toBe(expected);
    }
  });
});
