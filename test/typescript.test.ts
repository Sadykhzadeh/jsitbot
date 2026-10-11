import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";
import { stripTypes } from "../src/services/sandbox/typescript";

const sandbox = new QuickJsSandboxService();

async function show(code: string): Promise<string> {
  const execution = await sandbox.execute(code);

  return execution.ok ? execution.result : `error: ${execution.error}`;
}

describe("TypeScript syntax", () => {
  const cases: Array<[string, string, string]> = [
    ["variable annotations", `const x: number = 5; x * 2`, "10"],
    ["function signatures", `const add = (a: number, b: number): number => a + b; add(2, 3)`, "5"],
    ["interfaces and generics", `interface Box<T> { value: T }\nfunction box<T>(value: T): Box<T> { return { value } }\nbox<number>(7)`, "{ value: 7 }"],
    ["type aliases and assertions", `type Id = number;\nconst id = (5 as unknown) as Id;\nid`, "5"],
    ["satisfies", `const point = { x: 1, y: 2 } satisfies Record<string, number>;\npoint`, "{ x: 1, y: 2 }"],
    ["enums", `enum Color { Red, Green, Blue }\nColor.Blue`, "2"],
    ["parameter properties", `class Point { constructor(public x: number, private y: number) {} }\nnew Point(3, 4)`, "Point { x: 3, y: 4 }"],
    ["optional and non-null syntax", `function len(s?: string): number { return s!.length }\nlen("four")`, "4"],
    ["await next to a return", `const n: number = await Promise.resolve(2);\nreturn n * 2;`, "4"],
    ["types only", `interface Unused { a: number }`, "undefined"],
  ];

  for (const [name, code, expected] of cases) {
    test(name, async () => {
      expect(await show(code)).toBe(expected);
    });
  }

  test("keeps the last expression of a typed script", async () => {
    expect(await show(`const label: string = "kept";\nlabel`)).toBe("kept");
  });
});

describe("JavaScript comes first", () => {
  test("code that already parses is never rewritten", async () => {
    // As JavaScript this is `f < number > 1`, a comparison. As TypeScript it
    // would be a call with a type argument. Valid JavaScript keeps its meaning.
    expect(await show(`const f = (n) => n; f<number>(1)`)).toBe("error: ReferenceError: 'number' is not defined");
  });

  test("a genuine syntax error is still reported as one, with its line", async () => {
    const execution = await sandbox.execute("const a: number = 1;\nlet b = ;\nconst c = 3;");

    expect(execution.ok).toBe(false);
    if (!execution.ok) {
      expect(execution.error.startsWith("SyntaxError")).toBe(true);
      expect(execution.line).toBe(2);
    }
  });

  test("a runtime error in typed code has no line, since the layout changed", async () => {
    const execution = await sandbox.execute("const a: number = 1;\ninterface Noise { n: number }\nnull.name");

    expect(execution.ok).toBe(false);
    if (!execution.ok) {
      expect(execution.error.startsWith("TypeError")).toBe(true);
      expect(execution.line).toBeUndefined();
    }
  });

  test("hostile nesting is a syntax error, not a crash", async () => {
    const execution = await sandbox.execute(`${"[".repeat(1_900)}1${"]".repeat(1_900)} +`);

    expect(execution.ok).toBe(false);
    expect(await show("1 + 1")).toBe("2");
  });
});


describe("stripTypes", () => {
  test("removes annotations and keeps the code", () => {
    expect(stripTypes("const x: number = 1; x")).toEqual({ code: "const x = 1;\nx;\n" });
  });

  test("turns a snippet that awaits and returns into a function call", () => {
    const stripped = stripTypes("const n: number = await Promise.resolve(2);\nreturn n;");

    expect(stripped && "code" in stripped ? stripped.code : "").toContain("async");
  });

  test("says where it gave up on code it cannot parse", () => {
    expect(stripTypes("const a: number = 1;\nlet b = ;")).toEqual({
      error: { message: "Unexpected ;", line: 2 },
    });
  });

  test("has nothing to say when nothing changed", () => {
    expect(stripTypes("let a = 1;\n")).toBeUndefined();
  });
});
