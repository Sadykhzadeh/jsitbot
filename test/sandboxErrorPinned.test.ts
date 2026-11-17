import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

// Each row is a program that throws, and the line Node 26.13.0 printed for it: the error's
// name and message. Rows that the sandbox words differently are not here.
const CASES: Array<[string, string]> = [
  ["const u = undefined; u.x", "TypeError: Cannot read properties of undefined (reading 'x')"],
  ["let n = null; n.foo", "TypeError: Cannot read properties of null (reading 'foo')"],
  ["const o = {}; o.a.b", "TypeError: Cannot read properties of undefined (reading 'b')"],
  ["({}).a.b.c", "TypeError: Cannot read properties of undefined (reading 'b')"],
  ["const x = undefined; x.length", "TypeError: Cannot read properties of undefined (reading 'length')"],
  ["let n = null; n.x = 1", "TypeError: Cannot set properties of null (setting 'x')"],
  ["undefined.y = 2", "TypeError: Cannot set properties of undefined (setting 'y')"],
  ["const o = undefined; const k = \"z\"; o[k] = 1", "TypeError: Cannot set properties of undefined (setting 'z')"],
  ["const o = null; o[3] = 1", "TypeError: Cannot set properties of null (setting '3')"],
  ["nope", "ReferenceError: nope is not defined"],
  ["x; let x = 1;", "ReferenceError: Cannot access 'x' before initialization"],
  ["function f() { return f() } f()", "RangeError: Maximum call stack size exceeded"],
  ["new Array(-1)", "RangeError: Invalid array length"],
  ["\"ab\".repeat(2 ** 30)", "RangeError: Invalid string length"],
  ["new Date(NaN).toISOString()", "RangeError: Invalid time value"],
  ["Number(Symbol())", "TypeError: Cannot convert a Symbol value to a number"],
  ["class A {} class B extends A { constructor() { this.x = 1 } } new B()", "ReferenceError: Must call super constructor in derived class before accessing 'this' or returning from derived constructor"],
  ["[].reduce((a, b) => a)", "TypeError: Reduce of empty array with no initial value"],
  ["Symbol() + \"\"", "TypeError: Cannot convert a Symbol value to a string"],
  ["null.toString()", "TypeError: Cannot read properties of null (reading 'toString')"],
  ["(void 0).x", "TypeError: Cannot read properties of undefined (reading 'x')"],
  ["x.y.z", "ReferenceError: x is not defined"],
  ["const a = {}; a.b.c.d = 1", "TypeError: Cannot read properties of undefined (reading 'c')"],
  ["[].length = -1", "RangeError: Invalid array length"],
];

describe("errors that agree with Node: property access, references, ranges", () => {
  test("prints the error the way Node does", async () => {
    for (const [code, expected] of CASES) {
      const result = await sandbox.execute(code);
      expect(result.ok ? "OK" : result.error, code).toBe(expected);
    }
  });
});
