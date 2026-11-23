import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

// Each row is a text given to JSON.parse and what Node 26.13.0 said of it: the error's
// name and message, or "OK" and the value when the text is valid JSON. The positions are
// the same as Node's, with the line and column.
const CASES: Array<[string, string]> = [
  ["{", "SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)"],
  ["[1,]", "SyntaxError: Unexpected token ']', \"[1,]\" is not valid JSON"],
  ["{'a':1}", "SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)"],
  ["tru", "SyntaxError: Unexpected end of JSON input"],
  ["{\"a\":1,}", "SyntaxError: Expected double-quoted property name in JSON at position 7 (line 1 column 8)"],
  ["{\"a\":1", "SyntaxError: Expected ',' or '}' after property value in JSON at position 6 (line 1 column 7)"],
  ["[1 2]", "SyntaxError: Expected ',' or ']' after array element in JSON at position 3 (line 1 column 4)"],
  ["{\"a\" 1}", "SyntaxError: Expected ':' after property name in JSON at position 5 (line 1 column 6)"],
  ["{\"a\":1 \"b\":2}", "SyntaxError: Expected ',' or '}' after property value in JSON at position 7 (line 1 column 8)"],
  ["\"abc", "SyntaxError: Unterminated string in JSON at position 4 (line 1 column 5)"],
  ["nul", "SyntaxError: Unexpected end of JSON input"],
  ["01", "SyntaxError: Unexpected number in JSON at position 1 (line 1 column 2)"],
  ["1.", "SyntaxError: Unterminated fractional number in JSON at position 2 (line 1 column 3)"],
  ["-", "SyntaxError: No number after minus sign in JSON at position 1 (line 1 column 2)"],
  ["1e", "SyntaxError: Exponent part is missing a number in JSON at position 2 (line 1 column 3)"],
  ["[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, x]", "SyntaxError: Unexpected token 'x', ...\", 19, 20, x]\" is not valid JSON"],
  ["{\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\": tru}", "SyntaxError: Unexpected token '}', ...\"aaaa\": tru}\" is not valid JSON"],
  ["{}x", "SyntaxError: Unexpected non-whitespace character after JSON at position 2 (line 1 column 3)"],
  ["\"\t\"", "SyntaxError: Bad control character in string literal in JSON at position 1 (line 1 column 2)"],
  ["", "SyntaxError: Unexpected end of JSON input"],
  ["undefined", "SyntaxError: \"undefined\" is not valid JSON"],
  ["NaN", "SyntaxError: \"NaN\" is not valid JSON"],
  ["[object Object]", "SyntaxError: \"[object Object]\" is not valid JSON"],
  ["{\"a\":1}", "OK {\"a\":1}"],
  ["[1,2]", "OK [1,2]"],
  [" 42 ", "OK 42"],
  ["{\n  \"a\": 1,\n  b: 2\n}", "SyntaxError: Expected double-quoted property name in JSON at position 14 (line 3 column 3)"],
  ["[\n1,\n2,\n]", "SyntaxError: Unexpected token ']', \"[\n1,\n2,\n]\" is not valid JSON"],
  ["{\"a\":{\"b\":[1,2,}}", "SyntaxError: Unexpected token '}', \"{\"a\":{\"b\":[1,2,}}\" is not valid JSON"],
  ["tr", "SyntaxError: Unexpected end of JSON input"],
  ["truex", "SyntaxError: Unexpected non-whitespace character after JSON at position 4 (line 1 column 5)"],
  ["1 2", "SyntaxError: Unexpected non-whitespace character after JSON at position 2 (line 1 column 3)"],
  ["{\"k\":\"v\"", "SyntaxError: Expected ',' or '}' after property value in JSON at position 8 (line 1 column 9)"],
  ["[", "SyntaxError: Unexpected end of JSON input"],
  ["]", "SyntaxError: Unexpected token ']', \"]\" is not valid JSON"],
  ["{]", "SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)"],
  ["1e+", "SyntaxError: Exponent part is missing a number in JSON at position 3 (line 1 column 4)"],
  ["-01", "SyntaxError: Unexpected number in JSON at position 2 (line 1 column 3)"],
  ["2.5e10", "OK 25000000000"],
];

describe("JSON.parse errors, as Node words them", () => {
  test("names the place and what was found, as Node does", async () => {
    for (const [text, expected] of CASES) {
      const result = await sandbox.execute("return JSON.stringify(JSON.parse(" + JSON.stringify(text) + "))");
      const got = result.ok ? "OK " + result.result : result.error;
      expect(got, text).toBe(expected);
    }
  });
});
