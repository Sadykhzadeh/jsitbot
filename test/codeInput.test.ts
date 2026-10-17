import { describe, expect, test } from "bun:test";

import { stripCodeFence } from "../src/bot/codeInput";

describe("stripCodeFence", () => {
  test("removes a fence with a language name", () => {
    expect(stripCodeFence("```js\n1 + 1\n```")).toBe("1 + 1");
    expect(stripCodeFence("```typescript\nconst a: number = 1;\na\n```")).toBe("const a: number = 1;\na");
  });

  test("removes a fence without a language and with Windows line endings", () => {
    expect(stripCodeFence("```\n1 + 1\n```")).toBe("1 + 1");
    expect(stripCodeFence("```js\r\n1 + 1\r\n```")).toBe("1 + 1");
  });

  test("ignores whitespace around the fence", () => {
    expect(stripCodeFence("\n  ```js\nfoo()\n```  \n")).toBe("foo()");
  });

  test("removes a fence written on one line", () => {
    expect(stripCodeFence("```1 + 1```")).toBe("1 + 1");
  });

  test("keeps blank lines inside the code", () => {
    expect(stripCodeFence("```js\na();\n\nb();\n```")).toBe("a();\n\nb();");
  });

  test("leaves code that is not wrapped in a fence alone", () => {
    for (const code of ["1 + 1", "`a${1}`", "console.log(`x`)", "```js\n1 + 1", "x = ```", "// ```\n1"]) {
      expect(stripCodeFence(code)).toBe(code);
    }
  });
});
