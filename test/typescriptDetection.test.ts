import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function answer(code: string): Promise<string> {
  const execution = await sandbox.execute(code);

  return execution.ok ? execution.result : `error: ${execution.error}`;
}

// Snippets that look like TypeScript and are JavaScript. Each answer is the one
// Node 26.13 prints for the same program.
const JAVASCRIPT_THAT_LOOKS_LIKE_TYPESCRIPT: Array<[string, string, string]> = [
  ["a less-than and a greater-than in a row", "const a = 1, b = 2, c = 0;\na < b > c", "true"],
  ["the word as inside a string", "const s = 'x as number';\ns", "x as number"],
  ["a label named type", "type: for (let i = 0; ; i++) { if (i > 2) break type; }\n'ok'", "ok"],
  ["object keys named type and as", "const o = { type: 1, as: 2 };\no.type + o.as", "3"],
  ["a regex with a colon", "/a:b/.test('a:b')", "true"],
  ["a regex with a colon and a group", "const re = /x: (\\d+)/;\nre.exec('x: 42')[1]", "42"],
  ["a string that looks like JSX", "'<div>hi</div>'", "<div>hi</div>"],
  ["arrows with parenthesised parameters", "((a, b) => a + b)(1, 2)", "3"],
  ["a variable named as", "const as = 5;\nas + 1", "6"],
  ["a variable named satisfies", "const satisfies = 1;\nsatisfies", "1"],
  ["a variable named type", "let type = 2;\ntype", "2"],
  ["a comparison passed to a generic-looking call", "const g = (a) => a;\ng(1 < 2, 3 > 4)", "true"],
  ["a comment that looks like a type alias", "// type X = number\nconst k = 4;\nk", "4"],
  ["an expression that starts a line with a type name", "const type2 = 1;\ntype2 +\n 1", "2"],
];

// Snippets where TypeScript is the only reading that parses.
const TYPESCRIPT_ONLY: Array<[string, string, string]> = [
  ["a cast with as on a value", "const n = 5 as number;\nn", "5"],
  ["a single annotation on line 30", `${Array.from({ length: 29 }, (_, i) => `const v${i} = ${i};`).join("\n")}\nconst z: number = 3;\nz`, "3"],
  ["an await with an annotation", "const q: number = await Promise.resolve(9);\nq", "9"],
];

describe("JavaScript that looks like TypeScript runs as JavaScript", () => {
  for (const [name, code, expected] of JAVASCRIPT_THAT_LOOKS_LIKE_TYPESCRIPT) {
    test(name, async () => {
      expect(await answer(code)).toBe(expected);
    });
  }
});

describe("TypeScript is read when it is the only reading that parses", () => {
  for (const [name, code, expected] of TYPESCRIPT_ONLY) {
    test(name, async () => {
      expect(await answer(code)).toBe(expected);
    });
  }

  test("bare JSX is refused with one line, as Node refuses it", async () => {
    expect(await answer("<div>hi</div>")).toBe("error: SyntaxError: JSX is not supported");
  });
});
