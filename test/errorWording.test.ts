import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function failure(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? `ok: ${result.result}` : result.error;
}

async function logged(code: string): Promise<string[]> {
  const result = await sandbox.execute(code);

  return result.logs;
}

describe("errors the engine throws are worded the way Node words them", () => {
  const cases: Array<[string, string, string]> = [
    ["reading a property of undefined", `const user = undefined; user.name`, "TypeError: Cannot read properties of undefined (reading 'name')"],
    ["reading a property of null", `null.length`, "TypeError: Cannot read properties of null (reading 'length')"],
    ["reading a property that is not there of a property that is", `const o = {}; o.a.b.c`, "TypeError: Cannot read properties of undefined (reading 'b')"],
    ["writing a property of undefined", `let o; o.x = 1`, "TypeError: Cannot set properties of undefined (setting 'x')"],
    ["writing a property of null", `null.x = 1`, "TypeError: Cannot set properties of null (setting 'x')"],
    ["a name that is not defined", `total + 1`, "ReferenceError: total is not defined"],
    ["a name used before its let", `x; let x = 1`, "ReferenceError: Cannot access 'x' before initialization"],
    ["a symbol in a template", `const s = Symbol("s"); \`\${s}\``, "TypeError: Cannot convert a Symbol value to a string"],
    ["a symbol added to a string", `Symbol("s") + ""`, "TypeError: Cannot convert a Symbol value to a string"],
    ["a symbol turned into a number", `+Symbol("s")`, "TypeError: Cannot convert a Symbol value to a number"],
    ["reduce of an empty array", `[].reduce((a, b) => a + b)`, "TypeError: Reduce of empty array with no initial value"],
    ["reduceRight of an empty array", `[].reduceRight((a, b) => a + b)`, "TypeError: Reduce of empty array with no initial value"],
    ["an array of a length that cannot be", `new Array(-1)`, "RangeError: Invalid array length"],
    ["this used before super", `class A {} class B extends A { constructor() { this.x = 1 } } new B()`, "ReferenceError: Must call super constructor in derived class before accessing 'this' or returning from derived constructor"],
  ];

  for (const [name, code, expected] of cases) {
    test(name, async () => {
      expect(await failure(code)).toBe(expected);
    });
  }

  test("when it is printed, not only when it ends the run", async () => {
    expect(await logged(`try { null.x } catch (e) { console.log(e); console.log([e]) }`)).toEqual([
      "TypeError: Cannot read properties of null (reading 'x')",
      "[ [TypeError: Cannot read properties of null (reading 'x')] ]",
    ]);
    expect(await logged(`queueMicrotask(() => nope); console.log("after")`)).toEqual(["after", "Uncaught ReferenceError: nope is not defined"]);
  });

  test("leaves other errors alone", async () => {
    expect(await failure(`throw new Error("x is not defined")`)).toBe("Error: x is not defined");
    expect(await failure(`throw new TypeError("cannot read property of the moon")`)).toBe("TypeError: cannot read property of the moon");
  });

  test("leaves the messages it cannot improve as they are", async () => {
    expect(await failure(`const c = 1; c = 2`)).toBe("TypeError: 'c' is read-only");
    expect(await failure(`throw new RangeError("out of range")`)).toBe("RangeError: out of range");
  });
});
