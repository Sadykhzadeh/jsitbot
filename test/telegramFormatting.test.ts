import { describe, expect, test } from "bun:test";

import {
  formatExecutionDocument,
  formatExecutionMessage,
  formatInlineExecutionPreview,
} from "../src/bot/formatters/telegramExecutionMessage";
import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

describe("telegramExecutionMessage", () => {
  test("formats execution results with code and console", () => {
    const message = formatExecutionMessage(
      {
        ok: true,
        logs: ["hello_world", "`value`"],
        result: "2 + 2 = 4",
        durationMs: 12,
        timedOut: false,
        truncated: false,
      },
      "console.log('x');\n2 + 2",
    );

    expect(message.parseMode).toBe("MarkdownV2");
    expect(message.text).toContain("*Code*");
    expect(message.text).toContain("*Console*");
    expect(message.text).toContain("*Result*");
    expect(message.text).toContain("hello_world");
    expect(message.text).toContain("\\`value\\`");
  });

  test("omits empty console section", () => {
    const message = formatExecutionMessage(
      {
        ok: true,
        logs: [],
        result: "7",
        durationMs: 30,
        timedOut: false,
        truncated: false,
      },
      "3 + 4",
    );

    expect(message.text).toContain("*Code*");
    expect(message.text).toContain("*Result*");
    expect(message.text).not.toContain("*Console*");
    expect(message.text).toContain("_Duration: 30ms_");
  });

  test("marks truncated output", () => {
    const message = formatExecutionMessage(
      {
        ok: false,
        logs: [],
        error: "x".repeat(6_000),
        durationMs: 50,
        timedOut: false,
        truncated: false,
      },
      "x".repeat(4_000),
    );

    expect(message.text.length).toBeLessThan(4096);
    expect(message.text).toContain("truncated");
  });

  test("formats errors with code block", () => {
    const message = formatExecutionMessage(
      {
        ok: false,
        logs: [],
        error: "ReferenceError: x is not defined",
        durationMs: 15,
        timedOut: false,
        truncated: false,
      },
      "x + 1",
    );

    expect(message.text).toContain("*Code*");
    expect(message.text).toContain("*Error*");
  });

  test("prioritizes showing long user code when error is short", () => {
    const code = `${"a".repeat(1700)}END_MARKER`;
    const message = formatExecutionMessage(
      {
        ok: false,
        logs: [],
        error: "SyntaxError: unexpected token",
        durationMs: 3,
        timedOut: false,
        truncated: false,
      },
      code,
    );

    expect(message.text).toContain("END_MARKER");
    expect(message.text).not.toContain("truncated");
  });

  test("builds inline preview from result and logs", () => {
    const preview = formatInlineExecutionPreview({
      ok: true,
      logs: ["hello", "world"],
      result: "2",
      durationMs: 8,
      timedOut: false,
      truncated: false,
    });

    expect(preview.title).toBe("Result: 2");
    expect(preview.description).toContain("console: hello | world");
  });

  test("builds inline preview from errors", () => {
    const preview = formatInlineExecutionPreview({
      ok: false,
      logs: [],
      error: "ReferenceError: x is not defined",
      durationMs: 15,
      timedOut: false,
      truncated: false,
    });

    expect(preview.title).toContain("Error:");
    expect(preview.description).toContain("failed in 15ms");
  });

  test("says where a syntax error is, since the list shows it before the user picks", () => {
    const preview = formatInlineExecutionPreview({
      ok: false,
      logs: [],
      error: "SyntaxError: expecting ';'",
      line: 3,
      column: 17,
      durationMs: 2,
      timedOut: false,
      truncated: false,
    });

    expect(preview.title).toBe("Error: SyntaxError: expecting ';'");
    expect(preview.description).toBe("at line 3, column 17");
  });

  test("says a run that timed out timed out, and how long it ran", () => {
    const preview = formatInlineExecutionPreview({
      ok: false,
      logs: [],
      error: "Sandbox execution timed out.",
      durationMs: 701,
      timedOut: true,
      truncated: false,
    });

    expect(preview.title).toBe("Error: Sandbox execution timed out.");
    expect(preview.description).toBe("failed in 701ms");
  });
});

describe("error locations", () => {
  const failure = (line?: number) => ({
    ok: false as const,
    logs: [],
    error: "ReferenceError: 'total' is not defined",
    ...(line ? { line } : {}),
    durationMs: 4,
    timedOut: false,
    truncated: false,
  });
  const code = "const items = [1, 2];\nconst sum = items.length;\nconsole.log(total);\nsum";

  test("names the line and shows what is on it", () => {
    const message = formatExecutionMessage(failure(3), code);

    expect(message.text).toContain("ReferenceError: 'total' is not defined\n    at line 3: console.log(total);");
  });

  test("cuts a long source line", () => {
    const longLine = `const x = ${"1 + ".repeat(40)}1;`;
    const message = formatExecutionMessage(failure(2), `first();\n${longLine}\nlast();`);

    const errorSection = message.text.slice(message.text.indexOf("*Error*"));

    expect(errorSection).toContain("at line 2: const x = 1 + 1 + 1");
    expect(errorSection).toContain("...");
    expect(errorSection).not.toContain(longLine);
  });

  test("leaves one-line code alone, since the location is obvious", () => {
    const message = formatExecutionMessage(failure(1), "console.log(total)");

    expect(message.text).not.toContain("at line");
  });

  test("ignores a line the code does not have", () => {
    const message = formatExecutionMessage(failure(40), code);

    expect(message.text).not.toContain("at line");
  });

  test("shows nothing extra when the line is unknown", () => {
    const message = formatExecutionMessage(failure(), code);

    expect(message.text).not.toContain("at line");
  });
});

describe("syntax error carets", () => {
  const syntaxFailure = (line: number, column: number, error: string) => ({
    ok: false as const,
    logs: [],
    error,
    line,
    column,
    durationMs: 1,
    timedOut: false,
    truncated: false,
  });

  test("shows the line, a caret under the column, then the message", () => {
    const message = formatExecutionMessage(
      syntaxFailure(2, 9, "SyntaxError: unexpected token in expression: ';'"),
      "const a = 1;\nlet b = ;\nconst c = 3;",
    );

    expect(message.text).toContain("let b = ;\n        ^\nSyntaxError: unexpected token in expression: ';'");
  });

  test("keeps a tab before the error so the caret lines up under it", () => {
    const message = formatExecutionMessage(syntaxFailure(2, 10, "SyntaxError: unexpected token in expression: ';'"), "const a = 1;\n\tlet b = ;");

    expect(message.text).toContain("\tlet b = ;\n\t        ^\n");
  });

  test("places a caret after the last character of a line with no line break", () => {
    const message = formatExecutionMessage(syntaxFailure(2, 12, "SyntaxError: unexpected end of input"), "const a = 1;\nlet b = 2 +");

    expect(message.text).toContain("let b = 2 +\n           ^\n");
  });

  test("counts characters outside ASCII by code point", () => {
    const message = formatExecutionMessage(syntaxFailure(1, 25, "SyntaxError: unexpected token in expression: ';'"), 'const s = "é😀"; let z = ;');

    // The column is 25 in code points; the emoji before it takes two cells, so the caret is 25 cells in.
    expect(message.text).toContain(`const s = "é😀"; let z = ;\n${" ".repeat(25)}^\n`);
  });
});

describe("cutting text that holds characters outside the BMP", () => {
  const loneSurrogate = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

  test("never leaves half of a pair in the message or the inline preview", () => {
    for (const prefix of ["", "a"]) {
      const execution = {
        ok: true as const,
        logs: [prefix + "😀".repeat(1500)],
        result: prefix + "😀".repeat(1500),
        durationMs: 1,
        timedOut: false as const,
        truncated: false,
      };
      const message = formatExecutionMessage(execution, prefix + "😀".repeat(3000));
      const preview = formatInlineExecutionPreview(execution);

      expect(loneSurrogate.test(message.text)).toBe(false);
      expect(loneSurrogate.test(preview.title)).toBe(false);
      expect(loneSurrogate.test(preview.description)).toBe(false);
    }
  });
});

describe("sharing the room in one message", () => {
  const run = (overrides: { logs?: string[]; result?: string }) => ({
    ok: true as const,
    logs: overrides.logs ?? [],
    result: overrides.result ?? "1",
    durationMs: 2,
    timedOut: false as const,
    truncated: false,
  });
  const count = (text: string, char: string) => text.split(char).length - 1;

  test("shows a long result in full when the code is short", () => {
    const message = formatExecutionMessage(run({ result: "r".repeat(3_000) }), "bigString()");

    expect(count(message.text, "r")).toBeGreaterThanOrEqual(3_000);
    expect(message.text).not.toContain("truncated");
  });

  test("shows a long console log in full when the rest is short", () => {
    const logs = Array.from({ length: 20 }, (_, index) => `line ${index} ${"l".repeat(90)}`);
    const message = formatExecutionMessage(run({ logs }), "print()");

    expect(message.text).toContain(logs[19]);
    expect(message.text).not.toContain("truncated");
  });

  test("gives a result and a console log of the same size the same room", () => {
    const message = formatExecutionMessage(
      run({ logs: ["c".repeat(3_000)], result: "r".repeat(3_000) }),
      "x",
    );

    const console = count(message.text, "c");
    const result = count(message.text, "r");
    expect(Math.abs(console - result)).toBeLessThan(10);
    expect(console).toBeGreaterThan(1_500);
    expect(message.text).toContain("truncated");
  });

  test("keeps a short result whole next to a long console log", () => {
    const message = formatExecutionMessage(run({ logs: ["c".repeat(5_000)], result: "the answer" }), "x");

    expect(message.text).toContain("the answer");
    expect(message.text.length).toBeLessThanOrEqual(4_000);
  });

  test("fills the message but stays within it when escaping doubles the text", () => {
    const message = formatExecutionMessage(run({ result: "`".repeat(4_000) }), "`".repeat(2_000));

    expect(message.text.length).toBeLessThanOrEqual(4_000);
    expect(message.text.length).toBeGreaterThan(3_800);
  });
});

describe("curly quotes", () => {
  const sandbox = new QuickJsSandboxService({ timeoutMs: 300 });

  test("an error caused by them says so", async () => {
    const code = "console.log(“hello”)";
    const message = formatExecutionMessage(await sandbox.execute(code), code);

    expect(message.text).toContain("SyntaxError: unexpected character");
    expect(message.text).toContain("Hint: the code has curly quotes");
  });

  test("curly quotes inside a string that runs fine get no hint", async () => {
    const code = "'“hello”'";
    const message = formatExecutionMessage(await sandbox.execute(code), code);

    expect(message.text).not.toContain("Hint");
  });

  test("another error in code that has curly quotes gets no hint", () => {
    const message = formatExecutionMessage(
      { ok: false, logs: [], error: "SyntaxError: unexpected token in expression: ';'", durationMs: 1, timedOut: false, truncated: false },
      "'\u201Cx\u201D'; let b = ;",
    );

    expect(message.text).not.toContain("Hint");
  });
});

describe("look-alike characters", () => {
  const sandbox = new QuickJsSandboxService({ timeoutMs: 300 });

  test("an error caused by a dash, a sign or a zero-width space says so", async () => {
    for (const code of ["2 \u2212 1", "let a = 3 \u00D7 4; a", "const s = 'a' \uFF0B 'b'; s", "const x\u200B= 5; x"]) {
      const message = formatExecutionMessage(await sandbox.execute(code), code);

      expect(message.text).toContain("SyntaxError: unexpected character");
      expect(message.text).toContain("Hint: the code has look-alike characters");
    }
  });

  test("a look-alike inside a string that runs fine gets no hint", async () => {
    const code = "'2 \u2212 1'";
    const message = formatExecutionMessage(await sandbox.execute(code), code);

    expect(message.text).not.toContain("Hint");
  });

  test("an unexpected character that is not a look-alike gets no hint", async () => {
    const code = "const c = \u2713;";
    const execution = await sandbox.execute(code);

    expect(execution.ok ? "" : execution.error).toContain("unexpected character");
    expect(formatExecutionMessage(execution, code).text).not.toContain("Hint");
  });
});

describe("import and export", () => {
  const sandbox = new QuickJsSandboxService({ timeoutMs: 300 });

  test("a program that uses either is told it is not a module", async () => {
    for (const code of [
      'import fs from "fs";\nconsole.log(fs)',
      'import { a } from "b"',
      'import * as x from "x"',
      'import "side-effect"',
      "const a = 1\nexport default a",
      "export function f() {}",
      'import type { A } from "a";\nconst b: A = 1;\nb',
      "const a: number = 1;\nexport type T = number;\na",
      'import fs = require("fs");\nfs',
      "const a = 5;\nexport = a;",
    ]) {
      const message = formatExecutionMessage(await sandbox.execute(code), code);

      expect(message.text).toContain("Hint: this runs as a script");
    }
  });

  test("a dynamic import and other errors get no hint", async () => {
    for (const code of ['await import("x")', "if (1 {", "const s = 'import a from b'; s.x.y"]) {
      const message = formatExecutionMessage(await sandbox.execute(code), code);

      expect(message.text).not.toContain("Hint");
    }
  });
});

describe("host APIs the sandbox does not have", () => {
  const sandbox = new QuickJsSandboxService({ timeoutMs: 300 });

  test("a program that calls require, process, fetch or module is told there is no host", async () => {
    for (const code of [
      "require('fs')",
      "const fs = require('fs'); fs.readFileSync('x')",
      "process.env.TOKEN",
      "fetch('https://example.com')",
      "module.exports = 1",
      "console.log(__dirname)",
    ]) {
      const message = formatExecutionMessage(await sandbox.execute(code), code);

      expect(message.text).toContain("Hint: the sandbox has no require, process, fetch or file system");
    }
  });

  test("a program that defines its own name, or reads one that is there, gets no hint", async () => {
    for (const code of ["const process = 1; process + 1", "const require = (x) => x; require(2)", "typeof fetch"]) {
      const message = formatExecutionMessage(await sandbox.execute(code), code);

      expect(message.text).not.toContain("Hint");
    }
  });
});

describe("output that needs a file", () => {
  const run = (logs: string[], result = "1") => ({
    ok: true as const,
    logs,
    result,
    durationMs: 2,
    timedOut: false as const,
    truncated: false,
  });

  test("the message says whether it had to leave something out", () => {
    expect(formatExecutionMessage(run(["a"]), "x").cut).toBe(false);
    expect(formatExecutionMessage(run(["a".repeat(5_000)]), "x").cut).toBe(true);
  });

  test("a cut made by the sandbox alone is not one", () => {
    expect(formatExecutionMessage({ ...run(["a"]), truncated: true }, "x").cut).toBe(false);
  });

  test("the file holds every section whole and unescaped", () => {
    const text = formatExecutionDocument(run(["a`b", "c"], "d\\e"), "code()");

    expect(text).toBe(
      ["Code", "----", "code()", "", "Console", "-------", "a`b", "c", "", "Result", "------", "d\\e", ""].join("\n"),
    );
  });

  test("the file names the error and its line like the message does", () => {
    const text = formatExecutionDocument(
      { ok: false, logs: [], error: "ReferenceError: x is not defined", line: 2, durationMs: 1, timedOut: false, truncated: false },
      "a();\nx;",
    );

    expect(text).toContain("Error\n-----\nReferenceError: x is not defined\n    at line 2: x;\n");
  });
});

describe("lone surrogates in what a program printed", () => {
  const loneSurrogate = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

  test("are sent as U+FFFD in the message and the preview, so Telegram gets well-formed text", () => {
    const execution = {
      ok: true as const,
      logs: ["half \ud800 here"],
      result: "\udc00 result",
      durationMs: 1,
      timedOut: false as const,
      truncated: false,
    };
    const code = "'\ud800'";

    const message = formatExecutionMessage(execution, code);
    const preview = formatInlineExecutionPreview(execution);

    for (const text of [message.text, preview.title, preview.description]) {
      expect(loneSurrogate.test(text)).toBe(false);
    }
    expect(message.text).toContain("half � here");
    expect(message.text).toContain("� result");
  });

  test("a lone surrogate at the cut keeps the message within the limit", () => {
    const result = "a".repeat(3_990) + "\ud800" + "b".repeat(200);
    const message = formatExecutionMessage({
      ok: true,
      logs: [],
      result,
      durationMs: 1,
      timedOut: false,
      truncated: false,
    });

    expect(message.text.length).toBeLessThanOrEqual(4_096);
    expect(message.cut).toBe(true);
    expect(loneSurrogate.test(message.text)).toBe(false);
  });
});

describe("syntax error carets in a message, from a real run", () => {
  const sandbox = new QuickJsSandboxService({ timeoutMs: 300 });

  /** The source line and the caret line above the message, as they are before escaping. */
  function caretPair(text: string): { source: string; caret: string } {
    const plain = text.replace(/\\([`\\])/g, "$1");
    const lines = plain.split("\n");
    const at = lines.findIndex((line) => line.trimEnd().endsWith("^"));
    expect(at).toBeGreaterThan(0);
    return { source: lines[at - 1], caret: lines[at] };
  }

  test("a long line is cut around the error, keeps the caret under it and stays within the limit", async () => {
    const code = `const total = ${"1 + ".repeat(70)}1 2;`;
    const message = formatExecutionMessage(await sandbox.execute(code), code);
    const { source, caret } = caretPair(message.text);

    expect(message.text.length).toBeLessThanOrEqual(4_096);
    expect(source.length).toBeLessThanOrEqual(100);
    expect(source).toContain("...");
    expect(caret.indexOf("^")).toBe(source.lastIndexOf("2"));
  });

  test("a character outside the BMP before the error takes two cells, as it does in a monospace font", async () => {
    // The `!` after a string is a non-null assertion as TypeScript reads it, so
    // the error is the `1` after it: three emoji before it take three extra cells.
    const code = '"😀😀😀" ! 1';
    const message = formatExecutionMessage(await sandbox.execute(code), code);
    const { caret } = caretPair(message.text);

    expect(caret.indexOf("^")).toBe(11);
  });

  test("the caret stays under the error when the source has backticks that are escaped in the message", async () => {
    const code = "const a_b = `x` 1;";
    const message = formatExecutionMessage(await sandbox.execute(code), code);
    const { source, caret } = caretPair(message.text);

    expect(message.text).toContain("\\`x\\`");
    expect(caret.indexOf("^")).toBe(source.indexOf("1"));
  });
});

describe("code fences that are never closed", () => {
  const sandbox = new QuickJsSandboxService({ timeoutMs: 300 });

  test("a fence that is opened and not closed gets a hint", async () => {
    for (const code of ["```js\nconst a = 1;\na + 1", "```js 1 + 1", "```"]) {
      const message = formatExecutionMessage(await sandbox.execute(code), code);

      expect(message.text).toContain("Hint: the code starts with a code fence that is never closed");
    }
  });

  test("a fence that is closed, or code that does not start with one, gets no hint", async () => {
    for (const code of ["```js\n1 + 1\n``` + nope", "const a = 1; ```x", "1 +"]) {
      const message = formatExecutionMessage(await sandbox.execute(code), code);

      expect(message.text).not.toContain("Hint: the code starts with a code fence");
    }
  });
});
