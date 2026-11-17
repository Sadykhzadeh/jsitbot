import { describe, expect, test } from "bun:test";

import { formatExecutionMessage } from "../src/bot/formatters/telegramExecutionMessage";
import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

// Input that simply stops too early. The wording and the place are the ones Node
// 26.13 gives for the same text as a script (checked in WSL), so the message
// never names a bracket the user did not write.
const cases: Array<{ code: string; error: string; line: number; column: number }> = [
  { code: `"abc" +`, error: "SyntaxError: Unexpected end of input", line: 1, column: 8 },
  { code: "function f() {", error: "SyntaxError: Unexpected end of input", line: 1, column: 15 },
  { code: "[1, 2", error: "SyntaxError: Unexpected end of input", line: 1, column: 6 },
  { code: "`abc ${1}", error: "SyntaxError: Unexpected end of input", line: 1, column: 10 },
  { code: "/* open comment", error: "SyntaxError: Invalid or unexpected token", line: 1, column: 1 },
  // The same inputs with type annotations: the TypeScript reading must not change the wording.
  { code: "const x: number = \"abc\" +", error: "SyntaxError: Unexpected end of input", line: 1, column: 26 },
  { code: "function f(a: number) {", error: "SyntaxError: Unexpected end of input", line: 1, column: 24 },
  { code: "const xs: number[] = [1, 2", error: "SyntaxError: Unexpected end of input", line: 1, column: 27 },
  { code: "const t: string = `abc ${1}", error: "SyntaxError: Unexpected end of input", line: 1, column: 28 },
  { code: "/* typed */ const y: number = 1 /* open", error: "SyntaxError: Invalid or unexpected token", line: 1, column: 33 },
];

describe("input that ends too early", () => {
  for (const { code, error, line, column } of cases) {
    test(`${JSON.stringify(code)} is reported as ${error.slice("SyntaxError: ".length)}`, async () => {
      const result = await sandbox.execute(code);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(error);
        expect(result.line).toBe(line);
        expect(result.column).toBe(column);
        expect(result.error).not.toMatch(/'[})\]]'/);
      }
    });
  }

  test("the caret stands just after the last character of the text", async () => {
    const code = `const total = 1 +\n  "abc" +\n`;
    const result = await sandbox.execute(code);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.line).toBe(2);
      expect(result.column).toBe(10);
    }

    const message = result.ok ? "" : formatExecutionMessage(result, code).text;
    expect(message).toContain('  "abc" +\n' + " ".repeat(9) + "^\nSyntaxError: Unexpected end of input");
  });

  test("an error in the middle of the code is still reported where it is", async () => {
    const result = await sandbox.execute("let x = 1 +\nlet y = 2");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("SyntaxError: expecting ';'");
      expect(result.line).toBe(2);
    }
  });
});
