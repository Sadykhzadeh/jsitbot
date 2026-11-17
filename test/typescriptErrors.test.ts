import { describe, expect, test } from "bun:test";

import { formatExecutionMessage } from "../src/bot/formatters/telegramExecutionMessage";
import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";
import { sourceLine } from "../src/services/sandbox/typescript";

const sandbox = new QuickJsSandboxService();

// Code points before a position, plus one: the column the sandbox reports.
const columnAfter = (text: string) => Array.from(text).length + 1;

describe("a runtime error reports its line in the code the user wrote", () => {
  const cases: Array<[string, string, number]> = [
    ["after an interface above it", "const a: number = 1;\ninterface N { n: number }\ntype T = string;\nnull.name", 4],
    ["after a multi-line interface", "interface Big {\n  a: number;\n  b: string;\n}\n\nconst v: Big = { a: 1, b: 'x' };\nv.missing.deep", 7],
    ["inside a typed function", "function f(a: number): number {\n  const q: number = a;\n  return q.x.y;\n}\n\nf(1)", 3],
    ["inside a function whose body the transpiler reflows", "function g(x: number): number {\n  if (x > 0) return x;\n  const y: number = 1;\n  return null.q;\n}\ng(0)", 4],
    ["after tabs", "const a: number = 1;\n\tconst b: number = a;\n\n\tnull.name", 4],
    ["with CRLF line ends", "const a: number = 1;\r\ninterface N {}\r\nnull.name", 3],
    ["after an enum, which the transpiler expands", "enum E { A }\nconst v: number = 2;\nnull.name", 3],
    ["after a surrogate pair", "const s: string = '\u{1F600}';\ninterface X {}\nnull.name", 3],
    ["after a combining mark", "const s: string = 'é';\ninterface X {}\nnull.name", 3],
  ];

  for (const [name, code, line] of cases) {
    test(name, async () => {
      const execution = await sandbox.execute(code);

      expect(execution.ok).toBe(false);
      if (!execution.ok) {
        expect(execution.line).toBe(line);
      }
    });
  }
});

describe("a syntax error in typed code points at its column", () => {
  const cases: Array<[string, string, number]> = [
    ["plain", "const a: number = 1;\nlet b: number = ;", 2],
    ["after a tab", "const a: number = 1;\n\tlet b: number = ;", 2],
    ["after a surrogate pair on its line", "const a = 1;\nconst s: string = '\u{1F600}'; let c: number = ;", 2],
    ["after a combining mark on its line", "const a = 1;\nconst s: string = 'é'; let c: number = ;", 2],
  ];

  for (const [name, code, line] of cases) {
    test(name, async () => {
      const execution = await sandbox.execute(code);
      const text = code.split("\n")[line - 1];
      const before = text.slice(0, text.lastIndexOf(";"));

      expect(execution.ok).toBe(false);
      if (!execution.ok) {
        expect(execution.line).toBe(line);
        expect(execution.column).toBe(columnAfter(before));
      }
    });
  }

  test("the caret is drawn under the same character as the column", async () => {
    const code = "const a = 1;\nconst s: string = '\u{1F600}'; let c: number = ;";
    const lines = formatExecutionMessage(await sandbox.execute(code), code).text.split("\n");
    const source = lines.map((line, index) => [line, index] as const).filter(([line]) => line.includes("let c: number = ;")).pop();
    const [sourceText, index] = source!;
    const caret = lines[index + 1];

    expect(caret.trimEnd().endsWith("^")).toBe(true);
    expect(caret.length - 1).toBe(Array.from(sourceText.slice(0, sourceText.lastIndexOf(";"))).length + 1);
  });

  test("a CRLF line shows no carriage return in its error", async () => {
    const code = "const a = 1;\r\nlet b: number = ;\r\nconst c = 3;";
    const lines = formatExecutionMessage(await sandbox.execute(code), code).text.split("\n");
    const errorSource = lines.filter((line) => line.includes("let b: number = ;")).pop();

    expect(errorSource!.endsWith("\r")).toBe(false);
  });
});

describe("a syntax error in plain JavaScript counts its column the same way", () => {
  test("after a surrogate pair on its line", async () => {
    const code = "const a = 1;\nconst s = '\u{1F600}'; let c = ;";
    const execution = await sandbox.execute(code);
    const text = code.split("\n")[1];

    expect(execution.ok).toBe(false);
    if (!execution.ok) {
      expect(execution.line).toBe(2);
      expect(execution.column).toBe(columnAfter(text.slice(0, text.lastIndexOf(";"))));
    }
  });
});

describe("the line map of the transpiler", () => {
  test("maps every line of the output to its statement", () => {
    expect(sourceLine("const a: number = 1;\n\ninterface N {}\n\nnull.name", 2)).toBe(5);
  });

  test("maps the lines of a statement the transpiler expanded to the statement's line", () => {
    expect(sourceLine("enum E { A }\nE.A", 4)).toBe(1);
    expect(sourceLine("enum E { A }\nE.A", 5)).toBe(2);
  });

  test("finds the line of a statement inside a function body that the transpiler reflowed", () => {
    const code = "function g(x: number): number {\n  if (x > 0) return x;\n  const y: number = 1;\n  return null.q;\n}\ng(0)";

    expect(sourceLine(code, 5)).toBe(4);
  });

  test("a call the transpiler prints on one line gives the line its statement starts on", () => {
    expect(sourceLine("const f = (a: number) => a;\nconst r = f(\n  1,\n  null.z,\n);", 2)).toBe(2);
  });

  test("has no line past the end of the output", () => {
    expect(sourceLine("const a = 1;", 9)).toBeUndefined();
  });
});
