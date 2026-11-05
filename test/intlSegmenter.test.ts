import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

async function segments(granularity: string, text: string): Promise<Array<[string, number, boolean | null]>> {
  const answer = await value(`
    return JSON.stringify([...new Intl.Segmenter("en", { granularity: ${JSON.stringify(granularity)} }).segment(${JSON.stringify(text)})]
      .map((s) => [s.segment, s.index, s.isWordLike === undefined ? null : s.isWordLike]));
  `);

  return JSON.parse(answer);
}

// The expected segments are what node 24 answers.
describe("Intl.Segmenter", () => {
  test("cuts graphemes: accents, joined emoji, flags, skin tones and CRLF stay whole", async () => {
    const text = "áb\u{1F468}‍\u{1F469}‍\u{1F467}\u{1F1E6}\u{1F1FF}\u{1F1FA}\u{1F1F8}x\u{1F44D}\u{1F3FD}\r\n";

    expect(await segments("grapheme", text)).toEqual([
      ["á", 0, null],
      ["b", 2, null],
      ["\u{1F468}‍\u{1F469}‍\u{1F467}", 3, null],
      ["\u{1F1E6}\u{1F1FF}", 11, null],
      ["\u{1F1FA}\u{1F1F8}", 15, null],
      ["x", 19, null],
      ["\u{1F44D}\u{1F3FD}", 20, null],
      ["\r\n", 24, null],
    ]);
  });

  test("grapheme is the default and counts what a person sees", async () => {
    expect(await value(`return [...new Intl.Segmenter().segment("e\\u0301\\u{1F44D}\\u{1F3FD}")].length`)).toBe("2");
  });

  test("cuts words and says which of them are words", async () => {
    expect(await segments("word", "Hello, world! It's 3.14 ok_x")).toEqual([
      ["Hello", 0, true],
      [",", 5, false],
      [" ", 6, false],
      ["world", 7, true],
      ["!", 12, false],
      [" ", 13, false],
      ["It's", 14, true],
      [" ", 18, false],
      ["3.14", 19, true],
      [" ", 23, false],
      ["ok_x", 24, true],
    ]);
  });

  test("cuts sentences after their end marks and the space that follows", async () => {
    expect(await segments("sentence", "Hi there. How are you? Fine!")).toEqual([
      ["Hi there. ", 0, null],
      ["How are you? ", 10, null],
      ["Fine!", 23, null],
    ]);
  });

  test("finds the segment that holds an index, and nothing outside the text", async () => {
    expect(await value(`return JSON.stringify(new Intl.Segmenter().segment("ab\\u{1F44D}").containing(3))`)).toBe(
      '{"segment":"\u{1F44D}","index":2,"input":"ab\u{1F44D}"}',
    );
    expect(await value(`return String(new Intl.Segmenter().segment("ab").containing(10))`)).toBe("undefined");
  });

  test("tells its options, is named like the others, and refuses what it does not know", async () => {
    expect(await value(`return JSON.stringify(new Intl.Segmenter().resolvedOptions())`)).toBe(
      '{"locale":"en-US","granularity":"grapheme"}',
    );
    expect(await value(`return Object.prototype.toString.call(new Intl.Segmenter())`)).toBe("[object Intl.Segmenter]");
    expect(await value(`new Intl.Segmenter("en", { granularity: "line" })`)).toBe(
      "error: RangeError: Value line out of range for Intl.Segmenter options property granularity",
    );
  });
});
