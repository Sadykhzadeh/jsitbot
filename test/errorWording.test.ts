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
    ["a method that is not there", `const o = {}; o.method()`, "TypeError: o.method is not a function"],
    ["a name that is not a function", `let n = 5; n()`, "TypeError: n is not a function"],
    ["a chain of names that is not a function", `const obj = { inner: {} }; obj.inner.run(1, 2)`, "TypeError: obj.inner.run is not a function"],
    ["a new of a chain that is not a constructor", `const o = {}; new o.K()`, "TypeError: o.K is not a constructor"],
    ["a new of an expression that is not a constructor", `new (() => 1)()`, "TypeError: (intermediate value) is not a constructor"],
    ["a method of this", `class K { m() { this.zz() } } new K().m()`, "TypeError: this.zz is not a function"],
    ["a method awaited at the top", `const q = {}; await q.later()`, "TypeError: q.later is not a function"],
    ["a method on a later line", `const ok = 1;\nconst o = {};\n  o.run()`, "TypeError: o.run is not a function"],
    ["an assignment to a const", `const c = 1; c = 2`, "TypeError: Assignment to constant variable."],
    ["an update of a const", `const n = 1; n++`, "TypeError: Assignment to constant variable."],
    ["a compound assignment to a const on a later line", `const total = 0;\nfor (const v of [1]) total += v`, "TypeError: Assignment to constant variable."],
    ["a method in a type-annotated snippet", `const o: any = {}; o.method(1 as number)`, "TypeError: o.method is not a function"],
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

  test("names a call that is not a function where the call is, and keeps the engine's message", async () => {
    expect(await logged(`try { const o = {}; o.go() } catch (e) { console.log(e, "|", e.message) }`)).toEqual([
      "TypeError: o.go is not a function | not a function",
    ]);
    expect(await logged(`queueMicrotask(() => { const q = {}; q.run() }); console.log("after")`)).toEqual([
      "after",
      "Uncaught TypeError: q.run is not a function",
    ]);
  });

  test("does not name a call of a call result, which has no name to read", async () => {
    expect(await failure(`const f = () => 1; f()()`)).toBe("TypeError: not a function");
  });

  test("leaves other errors alone", async () => {
    expect(await failure(`throw new Error("x is not defined")`)).toBe("Error: x is not defined");
    expect(await failure(`throw new TypeError("cannot read property of the moon")`)).toBe("TypeError: cannot read property of the moon");
  });

  test("leaves the messages it cannot improve as they are", async () => {
    expect(await failure(`throw new RangeError("out of range")`)).toBe("RangeError: out of range");
  });
});

describe("code that stops before its end", () => {
  test("is reported as the end of the input, not as a bracket the user did not write", async () => {
    for (const code of ["1 +", "[1, 2, 3].map(x => {", "function f() {\n  return 1 +", "const a = 1;\nlet b = 2 +", "x => "]) {
      expect(await failure(code)).toBe("SyntaxError: unexpected end of input");
    }
  });

  test("keeps the wording of a token the user did write", async () => {
    expect(await failure("let b = ;")).toBe("SyntaxError: unexpected token in expression: ';'");
    expect(await failure("'abc")).toBe("SyntaxError: unexpected end of string");
  });
});
