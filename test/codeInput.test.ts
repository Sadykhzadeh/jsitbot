import { describe, expect, test } from "bun:test";

import { codeInMessage, stripCodeFence } from "../src/bot/codeInput";

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

  test("removes the language name of a fence written on one line", () => {
    expect(stripCodeFence("```js console.log(1)```")).toBe("console.log(1)");
    expect(stripCodeFence("```typescript const a: number = 1; a```")).toBe("const a: number = 1; a");
  });

  test("keeps a word that starts a one-line fence when it is part of the code", () => {
    expect(stripCodeFence("```typeof x```")).toBe("typeof x");
    expect(stripCodeFence("```js```")).toBe("js");
    expect(stripCodeFence("```js + 1```")).toBe("js + 1");
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

describe("codeInMessage", () => {
  test("runs the block Telegram marked, and leaves out the text around it", () => {
    const text = "what is this?\n```js\n6 * 7\n```";

    expect(codeInMessage(text, [{ type: "pre", offset: text.indexOf("6"), length: 5, language: "js" }])).toBe("6 * 7");
  });

  test("takes the fence off a message without entities, as stripCodeFence does", () => {
    expect(codeInMessage("```js\n1 + 1\n```", undefined)).toBe("1 + 1");
    expect(codeInMessage("```js\n1 + 1\n```", [{ type: "bold", offset: 0, length: 3 }])).toBe("1 + 1");
  });
});
