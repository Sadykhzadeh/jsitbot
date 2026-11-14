import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function run(code: string) {
  return sandbox.execute(code);
}

async function show(code: string): Promise<string> {
  const execution = await run(code);

  return execution.ok ? execution.result : `error: ${execution.error}`;
}

describe("the value of the last statement is the result", () => {
  const cases: Array<[string, string, string]> = [
    ["after declarations", `const a = 1; a + 41`, "42"],
    ["after several lines", `const xs = [1, 2, 3];\nconst doubled = xs.map((x) => x * 2);\ndoubled`, "[ 2, 4, 6 ]"],
    ["after a function declaration", `function square(n) { return n * n }\nsquare(7)`, "49"],
    ["after a class", `class Point { constructor(x) { this.x = x } }\nnew Point(3)`, "Point { x: 3 }"],
    ["of a block", `{ let a = 1; a + 1 }`, "2"],
    ["of an if statement", `var x = 5; if (x > 3) { "big" } else { "small" }`, "big"],
    ["of a loop", `let total = 0; for (let i = 1; i <= 4; i++) { total += i } total`, "10"],
    ["with a trailing semicolon", `1 + 1;`, "2"],
    ["with a trailing line comment", `1 + 1 // two`, "2"],
    ["of a promise that is still pending", `const p = Promise.resolve(7); p`, "7"],
    ["when the last statement has no value", `const a = 1;`, "undefined"],
  ];

  for (const [name, code, expected] of cases) {
    test(name, async () => {
      expect(await show(code)).toBe(expected);
    });
  }

  test("logs and result come from the same run", async () => {
    const execution = await run(`console.log("x"); 2 + 2`);

    expect(execution.ok).toBe(true);
    if (execution.ok) {
      expect(execution.result).toBe("4");
    }
    expect(execution.logs).toEqual(["x"]);
  });
});

describe("a declaration at the start does not take the next line as part of itself", () => {
  const cases: Array<[string, string, string[], string]> = [
    ["a function and a parenthesised call", `function f() { return 1 }\n(function () { console.log("iife") })()`, ["iife"], "undefined"],
    ["an async function and an async call", `async function main() { console.log("main") }\n(async () => { await main() })()`, ["main"], "undefined"],
    ["a function and an array", `function shout(s) { return s + "!" }\n[1, 2].forEach((n) => console.log(shout(n)))`, ["1!", "2!"], "undefined"],
    ["a generator and a template", `function* g() {}\n\`tpl\`.length`, [], "3"],
    ["a class and an array", `class A {}\n[1].forEach(() => console.log("hi"))`, ["hi"], "undefined"],
    ["a comment first", `// setup\nfunction f() {}\n(function () { console.log("c") })()`, ["c"], "undefined"],
    ["a function and a parenthesised value", `function f() { return 1 }\n(2)`, [], "2"],
  ];

  for (const [name, code, logs, expected] of cases) {
    test(name, async () => {
      const execution = await run(code);

      expect(execution.logs).toEqual(logs);
      expect(execution.ok ? execution.result : `error: ${execution.error}`).toBe(expected);
    });
  }

  test("a function or a class on its own is still the result", async () => {
    expect(await show(`function f() {}`)).toBe("[Function: f]");
    expect(await show(`class A {}`)).toBe("[class A]");
    expect(await show(`async function* g() {}`)).toBe("[AsyncGeneratorFunction: g]");
    expect(await show(`function f() {}\nfunction g() {}`)).toBe("undefined");
  });
});

describe("the other readings still work", () => {
  test("a single expression", async () => {
    expect(await show(`[1, 2, 3].length`)).toBe("3");
  });

  test("an object literal is an object, not a block", async () => {
    expect(await show(`{ a: 1 }`)).toBe("{ a: 1 }");
  });

  test("an explicit return", async () => {
    expect(await show(`const a = 2; return a * 3;`)).toBe("6");
  });

  test("top-level await next to statements", async () => {
    const execution = await run(`const v = await Promise.resolve(3); console.log(v); return v + 1;`);

    expect(execution.ok).toBe(true);
    if (execution.ok) {
      expect(execution.result).toBe("4");
    }
    expect(execution.logs).toEqual(["3"]);
  });

  test("top-level await without a return gives undefined", async () => {
    expect(await show(`const v = await Promise.resolve(3); console.log(v);`)).toBe("undefined");
  });
});

describe("errors", () => {
  test("a syntax error is reported as one", async () => {
    expect((await show(`let a = ;`)).startsWith("error: SyntaxError")).toBe(true);
    expect((await show(`const x = (1 + ;\nx`)).startsWith("error: SyntaxError")).toBe(true);
  });

  test("a SyntaxError thrown by the code does not run it a second time", async () => {
    for (const thrower of [`JSON.parse("{")`, `new RegExp("(")`, `eval("let = ;")`]) {
      const execution = await run(`console.log("once"); ${thrower}`);

      expect(execution.ok).toBe(false);
      expect(execution.logs).toEqual(["once"]);
      if (!execution.ok) {
        expect(execution.error.startsWith("SyntaxError")).toBe(true);
      }
    }
  });

  test("a runtime error in a script is reported with its own name", async () => {
    expect(await show(`const user = null;\nuser.name`)).toMatch(/^error: TypeError/);
  });

  test("an error thrown after a log keeps the log", async () => {
    const execution = await run(`console.log("before"); undefinedFunction();`);

    expect(execution.ok).toBe(false);
    expect(execution.logs).toEqual(["before"]);
    if (!execution.ok) {
      expect(execution.error).toBe("ReferenceError: undefinedFunction is not defined");
    }
  });
});
