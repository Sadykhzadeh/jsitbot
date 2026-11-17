import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

// Each row is a program that throws, and the line Node 26.13.0 printed for it: the error's
// name and message. Rows that the sandbox words differently are not here.
const CASES: Array<[string, string]> = [
  ["[1].length = 2 ** 32", "RangeError: Invalid array length"],
  ["\"a\".padEnd(2 ** 31)", "RangeError: Invalid string length"],
  ["new Date(8.64e15 + 1).toISOString()", "RangeError: Invalid time value"],
  ["+1n", "TypeError: Cannot convert a BigInt value to a number"],
  ["[].reduce(function(a, b) { return a })", "TypeError: Reduce of empty array with no initial value"],
  ["new Array(2 ** 32)", "RangeError: Invalid array length"],
  ["Array(-5)", "RangeError: Invalid array length"],
  ["\"use strict\"; undefined_var_here = 1", "ReferenceError: undefined_var_here is not defined"],
  ["Symbol.for(Symbol())", "TypeError: Cannot convert a Symbol value to a string"],
];

describe("errors that agree with Node: more of them", () => {
  test("prints the error the way Node does", async () => {
    for (const [code, expected] of CASES) {
      const result = await sandbox.execute(code);
      expect(result.ok ? "OK" : result.error, code).toBe(expected);
    }
  });
});
