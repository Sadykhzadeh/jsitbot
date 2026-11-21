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
    expect(await show(`const f = (n) => n; f<number>(1)`)).toBe("error: ReferenceError: number is not defined");
  });

  test("a genuine syntax error is still reported as one, with its line", async () => {
    const execution = await sandbox.execute("const a: number = 1;\nlet b = ;\nconst c = 3;");

    expect(execution.ok).toBe(false);
    if (!execution.ok) {
      expect(execution.error.startsWith("SyntaxError")).toBe(true);
      expect(execution.line).toBe(2);
    }
  });

  test("a runtime error in typed code reports its line in the typed code", async () => {
    const execution = await sandbox.execute("const a: number = 1;\ninterface Noise { n: number }\nnull.name");

    expect(execution.ok).toBe(false);
    if (!execution.ok) {
      expect(execution.error.startsWith("TypeError")).toBe(true);
      expect(execution.line).toBe(3);
    }
  });

  test("hostile nesting is a syntax error, not a crash", async () => {
    const execution = await sandbox.execute(`${"[".repeat(1_900)}1${"]".repeat(1_900)} +`);

    expect(execution.ok).toBe(false);
    expect(await show("1 + 1")).toBe("2");
  });
});


describe("transpiler macros", () => {
  // A macro runs while the types are being stripped, on the host, and its return
  // value ends up in the code. `arch()` is harmless but would show it ran.
  const macro = (call: string) =>
    `import { arch } from "node:os" with { type: "macro" };
const name: string = ${call};
name`;

  test("are never run on the host", async () => {
    const execution = await sandbox.execute(macro("arch()"));

    expect(execution.ok).toBe(false);
    if (!execution.ok) {
      expect(execution.error).toContain("Macros are disabled");
    }
  });

  test("are refused by the type stripper", () => {
    expect(stripTypes(macro("arch()"))).toEqual({
      error: { message: "Macros are disabled", line: 2, column: 22 },
    });
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
      error: { message: "Unexpected ;", line: 2, column: 9 },
    });
  });

  test("has nothing to say when nothing changed", () => {
    expect(stripTypes("let a = 1;\n")).toBeUndefined();
  });
});

describe("an empty export list", () => {
  test("is left out of a snippet, so the snippet runs", async () => {
    expect(await show("export {};")).toBe("undefined");
    expect(await show("export {}\nlet q = 4\nq")).toBe("4");
    expect(await show("export {};\nconst a: number = 2;\na")).toBe("2");
  });

  test("is left out of a snippet that returns at its top level", async () => {
    expect(await show("export {};\nreturn 7;")).toBe("7");
    expect(await show("export {};\nconst n: number = await Promise.resolve(2);\nreturn n * 2;")).toBe("4");
    expect(await show("export {};\nfunction f(): number { return 3 }\nf()")).toBe("3");
  });

  test("keeps the lines of the code after it, for an error", async () => {
    const execution = await sandbox.execute("const a: number = 1;\n  export {};\nthrow new Error(`x${a}`);");

    expect(execution.ok).toBe(false);
    expect(execution.ok ? "" : execution.error).toBe("Error: x1");
    expect(execution.ok ? undefined : execution.line).toBe(3);
  });

  test("is not touched inside a template literal, a string or a comment", async () => {
    expect(await show("const s: string = `\nexport {};\n`;\ns")).toBe("\nexport {};\n");
    expect(await show("const s: string = 'export {};';\ns")).toBe("export {};");
    expect(await show("// export {};\nconst n: number = 3;\nn")).toBe("3");
  });

  test("is left alone when it is not a statement of the code", () => {
    expect(stripTypes("const a: number = 1;\nconst s = `export {};`;\na")).toEqual({
      code: "const a = 1;\nconst s = `export {};`;\na;\n",
    });
  });
});
