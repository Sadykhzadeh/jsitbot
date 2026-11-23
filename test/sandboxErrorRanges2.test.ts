import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

// Each row is a program that throws, and the line Node 26.13.0 printed for it: the error's
// name and message. Rows that the sandbox words differently are not here.
const CASES: Array<[string, string]> = [
  ["\"x\".repeat(-1)", "RangeError: Invalid count value: -1"],
  ["[1].length = 2 ** 32", "RangeError: Invalid array length"],
  ["\"a\".padEnd(2 ** 31)", "RangeError: Invalid string length"],
  ["(1).toFixed(-1)", "RangeError: toFixed() digits argument must be between 0 and 100"],
  ["(1).toPrecision(101)", "RangeError: toPrecision() argument must be between 1 and 100"],
  ["(1).toExponential(101)", "RangeError: toExponential() argument must be between 0 and 100"],
  ["(1).toString(0)", "RangeError: toString() radix argument must be between 2 and 36"],
  ["new Date(8.64e15 + 1).toISOString()", "RangeError: Invalid time value"],
  ["BigInt(NaN)", "RangeError: The number NaN cannot be converted to a BigInt because it is not an integer"],
  ["BigInt(\"1.5\")", "SyntaxError: Cannot convert 1.5 to a BigInt"],
  ["BigInt(undefined)", "TypeError: Cannot convert undefined to a BigInt"],
  ["new Array(2 ** 32)", "RangeError: Invalid array length"],
  ["Array(-5)", "RangeError: Invalid array length"],
];

describe("range and conversion errors (more)", () => {
  test("prints the error the way Node does", async () => {
    for (const [code, expected] of CASES) {
      const result = await sandbox.execute(code);
      expect(result.ok ? "OK" : result.error, code).toBe(expected);
    }
  });
});
