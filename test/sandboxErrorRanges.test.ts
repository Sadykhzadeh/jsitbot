import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

// Each row is a program that throws, and the line Node 26.13.0 printed for it: the error's
// name and message. Rows that the sandbox words differently are not here.
const CASES: Array<[string, string]> = [
  ["new Array(-1)", "RangeError: Invalid array length"],
  ["\"a\".repeat(-1)", "RangeError: Invalid count value: -1"],
  ["\"a\".repeat(Infinity)", "RangeError: Invalid count value: Infinity"],
  ["\"ab\".repeat(2 ** 30)", "RangeError: Invalid string length"],
  ["(1).toFixed(101)", "RangeError: toFixed() digits argument must be between 0 and 100"],
  ["(1).toPrecision(0)", "RangeError: toPrecision() argument must be between 1 and 100"],
  ["new Date(NaN).toISOString()", "RangeError: Invalid time value"],
  ["(1).toString(1)", "RangeError: toString() radix argument must be between 2 and 36"],
  ["(1).toString(37)", "RangeError: toString() radix argument must be between 2 and 36"],
  ["BigInt(1.5)", "RangeError: The number 1.5 cannot be converted to a BigInt because it is not an integer"],
  ["BigInt(\"x\")", "SyntaxError: Cannot convert x to a BigInt"],
  ["JSON.stringify(1n)", "TypeError: Do not know how to serialize a BigInt"],
  ["[].length = -1", "RangeError: Invalid array length"],
];

describe("range and conversion errors", () => {
  test("prints the error the way Node does", async () => {
    for (const [code, expected] of CASES) {
      const result = await sandbox.execute(code);
      expect(result.ok ? "OK" : result.error, code).toBe(expected);
    }
  });
});
