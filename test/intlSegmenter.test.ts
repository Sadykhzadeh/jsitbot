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

  test("keeps a joiner after a letter, and the tags of a flag, with the character they belong to", async () => {
    expect(await segments("grapheme", "\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645 \u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} ok")).toEqual([
      ["\u0645", 0, null],
      ["\u06cc\u200c", 1, null],
      ["\u062e", 3, null],
      ["\u0648", 4, null],
      ["\u0627", 5, null],
      ["\u0647", 6, null],
      ["\u0645", 7, null],
      [" ", 8, null],
      ["\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}", 9, null],
      [" ", 23, null],
      ["o", 24, null],
      ["k", 25, null],
    ]);
  });

  test("keeps a Devanagari conjunct, joined by a virama, in one grapheme", async () => {
    expect(await segments("grapheme", "\u0928\u092e\u0938\u094d\u0924\u0947 \u0926\u0941\u0928\u093f\u092f\u093e \u0915\u094d\u200d\u0937\u094d\u092e")).toEqual([
      ["\u{928}", 0, null],
      ["\u{92E}", 1, null],
      ["\u{938}\u{94D}\u{924}\u{947}", 2, null],
      [" ", 6, null],
      ["\u{926}\u{941}", 7, null],
      ["\u{928}\u{93F}", 9, null],
      ["\u{92F}\u{93E}", 11, null],
      [" ", 13, null],
      ["\u{915}\u{94D}\u{200D}\u{937}\u{94D}\u{92E}", 14, null],
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

  test("keeps the marks of a word, a joined word and an emoji or flag in one segment", async () => {
    expect(await segments("word", "a\u0301b c\u0308d \u{1F1EB}\u{1F1F7}\u{1F1E9}\u{1F1EA} flag \u{1F468}\u200d\u{1F469}\u200d\u{1F467} hi\u200dthere")).toEqual([
      ["a\u0301b", 0, true],
      [" ", 3, false],
      ["c\u0308d", 4, true],
      [" ", 7, false],
      ["\u{1F1EB}\u{1F1F7}", 8, false],
      ["\u{1F1E9}\u{1F1EA}", 12, false],
      [" ", 16, false],
      ["flag", 17, true],
      [" ", 21, false],
      ["\u{1F468}\u200d\u{1F469}\u200d\u{1F467}", 22, false],
      [" ", 30, false],
      ["hi\u200dthere", 31, true],
    ]);
  });

  test("keeps the digits of a number with commas in one word, and a comma between words apart", async () => {
    expect(await segments("word", "1,000.50 and 2,5 a,1 x,\u0301y 3.000,50 ok 12,")).toEqual([
      ["1,000.50", 0, true],
      [" ", 8, false],
      ["and", 9, true],
      [" ", 12, false],
      ["2,5", 13, true],
      [" ", 16, false],
      ["a", 17, true],
      [",", 18, false],
      ["1", 19, true],
      [" ", 20, false],
      ["x", 21, true],
      [",\u0301", 22, false],
      ["y", 24, true],
      [" ", 25, false],
      ["3.000,50", 26, true],
      [" ", 34, false],
      ["ok", 35, true],
      [" ", 37, false],
      ["12", 38, true],
      [",", 40, false],
    ]);
  });

  test("cuts a sentence at a line break, and not after a period that a lowercase word follows", async () => {
    expect(await segments("sentence", "Hello\nWorld\r\nagain. how are\n\nyou?  Yes")).toEqual([
      ["Hello\n", 0, null],
      ["World\r\n", 6, null],
      ["again. how are\n", 13, null],
      ["\n", 28, null],
      ["you?  ", 29, null],
      ["Yes", 35, null],
    ]);
    expect(await segments("sentence", "e.g. foo.bar 1.2.3 and Hi. X")).toEqual([
      ["e.g. foo.bar 1.2.3 and Hi. ", 0, null],
      ["X", 27, null],
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
