import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService({ timeoutMs: 300 });

async function lineOf(code: string): Promise<number | undefined> {
  const execution = await sandbox.execute(code);

  expect(execution.ok).toBe(false);
  return execution.ok ? undefined : execution.line;
}

describe("error line numbers", () => {
  test("a runtime error in a script points at its line", async () => {
    expect(await lineOf("const a = 1;\nconst b = 2;\nundefinedFunction();")).toBe(3);
  });

  test("a single line is line 1", async () => {
    expect(await lineOf("null.name")).toBe(1);
  });

  test("a blank line at the start counts", async () => {
    expect(await lineOf("\n\n\nnull.name")).toBe(4);
  });

  test("an error inside a function points at the throwing line, not the call", async () => {
    const code = [
      "function validate(input) {",
      "  if (!input) throw new Error('empty');",
      "}",
      "",
      "validate('');",
    ].join("\n");

    expect(await lineOf(code)).toBe(2);
  });

  test("an error in the body of a function-style program", async () => {
    expect(await lineOf("const items = [1, 2];\nreturn items.missing.length;")).toBe(2);
  });

  test("an error after an await", async () => {
    expect(await lineOf("await Promise.resolve();\nnull.name")).toBe(2);
  });

  test("a rejected promise from a later line", async () => {
    expect(await lineOf("const wait = async () => {\n  throw new TypeError('late');\n};\nawait wait();")).toBe(2);
  });

  test("a syntax error points at the offending line", async () => {
    expect(await lineOf("const a = 1;\nlet b = ;\nconst c = 3;")).toBe(2);
  });

  test("an error raised by a built-in points at the calling line", async () => {
    expect(await lineOf("const rows = [1, 2];\nrows.map(null);")).toBe(2);
  });

  test("a trailing comment does not shift lines", async () => {
    expect(await lineOf("const a = 1; // first\nnull.name // second")).toBe(2);
  });

  test("a thrown value that is not an error has no line", async () => {
    expect(await lineOf("throw 'plain string'")).toBeUndefined();
    expect(await lineOf("throw { code: 1 }")).toBeUndefined();
  });

  test("limits are not blamed on a line", async () => {
    const timeout = await sandbox.execute("const a = 1;\nwhile (true) {}");
    expect(timeout.ok).toBe(false);
    expect(timeout.timedOut).toBe(true);
    expect(timeout.ok ? undefined : timeout.line).toBeUndefined();

    const bomb = await sandbox.execute("const kept = [];\nwhile (true) kept.push('x'.repeat(1 << 20));");
    expect(bomb.ok).toBe(false);
    expect(bomb.ok ? undefined : bomb.line).toBeUndefined();
  });

  test("a successful run has no line", async () => {
    const execution = await sandbox.execute("1 + 1");

    expect(execution.ok).toBe(true);
    expect("line" in execution).toBe(false);
  });
});

describe("syntax error columns", () => {
  async function positionOf(code: string): Promise<{ line?: number; column?: number }> {
    const execution = await sandbox.execute(code);

    expect(execution.ok).toBe(false);
    return execution.ok ? {} : { line: execution.line, column: execution.column };
  }

  test("a syntax error gives its line and the column it starts at", async () => {
    expect(await positionOf("const a = 1;\nlet b = ;\nconst c = 3;")).toEqual({ line: 2, column: 9 });
  });

  test("a tab before the error counts as one column", async () => {
    expect(await positionOf("const a = 1;\n\tlet b = ;")).toEqual({ line: 2, column: 10 });
  });

  test("an error at the end of code without a line break is still placed", async () => {
    expect(await positionOf("const a = 1;\nlet b = 2 +")).toEqual({ line: 2, column: 12 });
  });

  test("non-ASCII before the error is counted in code points", async () => {
    expect(await positionOf('const s = "é😀"; let z = ;')).toEqual({ line: 1, column: 25 });
  });

  test("a runtime error has a line but no column", async () => {
    const execution = await sandbox.execute("const a = 1;\nnull.name");

    expect(execution.ok).toBe(false);
    expect(execution.ok ? undefined : execution.column).toBeUndefined();
  });
});
