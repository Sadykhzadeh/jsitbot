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

// A script gets the value of its last statement, but a script cannot await, so
// code that does is read as the body of a function, which has no such value
// unless it says return. The last expression is its result all the same.
describe("the value of the last statement of code that awaits", () => {
  test("the example of the help text", async () => {
    expect(await show(`console.log("hi"); await Promise.resolve(42)`)).toBe("42");
  });

  test("an expression after an await", async () => {
    expect(await show(`const a = await Promise.resolve(1); a + 1`)).toBe("2");
  });

  test("lines, with comments and a semicolon after the last one", async () => {
    expect(await show(`await null;\nconst out = [];\n// fill it\nout.push(1);\nout; // done`)).toEqual("[ 1 ]");
  });

  test("a last statement that goes on over several lines is not cut in two", async () => {
    expect(await show(`await null;\nlet y = 1;\ny\n+ 2`)).toBe("3");
    expect(await show(`await null;\nawait Promise.all([\n  1,\n  2,\n])`)).toBe("[ 1, 2 ]");
  });

  test("a last statement that is a call with a body", async () => {
    expect(await show(`await null;\n[1, 2, 3].map((n) => {\n  const m = n * 2;\n  return m;\n})`)).toBe("[ 2, 4, 6 ]");
  });

  test("a semicolon inside a function or a string is not the start of the last statement", async () => {
    expect(await show(`await null;\nconst f = () => {\n  const a = 1;\n  return a;\n};\nf()`)).toBe("1");
    expect(await show("await null;\n`one;\ntwo`")).toBe("one;\ntwo");
  });

  test("a statement that has nothing before it", async () => {
    expect(await show(`await 1`)).toBe("1");
    expect(await show(`await 1;`)).toBe("1");
  });

  test("nothing when the last statement is not an expression", async () => {
    expect(await show(`const a = await Promise.resolve(1)`)).toBe("undefined");
    expect(await show(`await null;\nif (true) { 1 }`)).toBe("undefined");
  });

  test("an explicit return still wins", async () => {
    expect(await show(`await null; return 5`)).toBe("5");
    expect(await show(`await null; if (true) return "early"; 7`)).toBe("early");
  });

  test("an error keeps the line it came from", async () => {
    const execution = await run(`const a = await Promise.resolve(1);\nconst b = 2;\nnull.x`);

    expect(execution.ok).toBe(false);
    if (!execution.ok) {
      expect(execution.line).toBe(3);
    }
  });

  test("the code runs once", async () => {
    const execution = await run(`console.log("once"); await null; 1`);

    expect(execution.logs).toEqual(["once"]);
  });

  test("it works on TypeScript too", async () => {
    expect(await show(`const n: number = await Promise.resolve(2);\nn * 3`)).toBe("6");
  });
});
