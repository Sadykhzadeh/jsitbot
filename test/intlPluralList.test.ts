import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

describe("Intl.PluralRules", () => {
  test("picks the cardinal category of English", async () => {
    // from the browser engine: [0, 1, 1.5, 2, -1, "1", 1e21, NaN, Infinity, 0.5]
    expect(
      await value(`
        const rules = new Intl.PluralRules("en-US");
        return [0, 1, 1.5, 2, -1, "1", 1e21, NaN, Infinity, 0.5].map((n) => rules.select(n)).join();
      `),
    ).toBe("other,one,other,other,one,one,other,other,other,other");
  });

  test("picks the ordinal category of English", async () => {
    // from the browser engine
    expect(
      await value(`
        const rules = new Intl.PluralRules("en-US", { type: "ordinal" });
        return [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112, 0, -1, -2, 1.5, 1e21].map((n) => rules.select(n)).join();
      `),
    ).toBe("one,two,few,other,other,other,other,one,two,few,one,other,other,other,one,two,other,other");
  });

  test("counts the digits that are shown, as the fraction options say", async () => {
    // from the browser engine: other one other other
    expect(
      await value(`
        return [
          new Intl.PluralRules("en", { minimumFractionDigits: 1 }).select(1),
          new Intl.PluralRules("en", { maximumFractionDigits: 0 }).select(1.2),
          new Intl.PluralRules("en", { maximumFractionDigits: 0 }).select(1.5),
          new Intl.PluralRules("en", { minimumFractionDigits: 2 }).select(1),
        ].join(" ");
      `),
    ).toBe("other one other other");
  });

  test("works detached from its object, as a helper is passed around", async () => {
    expect(await value(`const { select } = new Intl.PluralRules("en"); return select(1)`)).toMatch(/^error: TypeError/);
  });

  test("reports what it was made with", async () => {
    expect(
      await value(`
        const r = new Intl.PluralRules("en-US", { type: "ordinal" }).resolvedOptions();
        return [r.locale, r.type, r.pluralCategories.join("/")].join();
      `),
    ).toBe("en-US,ordinal,one/two/few/other");
    expect(await value(`return new Intl.PluralRules("en").resolvedOptions().pluralCategories.join("/")`)).toBe("one/other");
  });

  test("refuses what a browser refuses", async () => {
    expect(await value(`new Intl.PluralRules("en", { type: "x" })`)).toBe(
      "error: RangeError: Value x out of range for Intl.PluralRules options property type",
    );
    expect(await value(`new Intl.PluralRules("en").select(1n)`)).toMatch(/^error: TypeError/);
    expect(await value(`Intl.PluralRules("en")`)).toMatch(/^error: TypeError/);
    expect(await value(`new Intl.PluralRules("ru")`)).toMatch(/^error: RangeError/);
  });

  test("looks like the built-ins", async () => {
    expect(
      await value(`
        const r = new Intl.PluralRules();
        return [Object.prototype.toString.call(r), r instanceof Intl.PluralRules, Intl.PluralRules.name, Object.keys(Intl).join()].join();
      `),
    ).toBe("[object Intl.PluralRules],true,PluralRules,");
  });

  test("makes readable plurals", async () => {
    expect(
      await value(`
        const rules = new Intl.PluralRules("en");
        const forms = { one: "file", other: "files" };
        return [0, 1, 2].map((n) => n + " " + forms[rules.select(n)]).join(", ");
      `),
    ).toBe("0 files, 1 file, 2 files");
  });
});

describe("Intl.ListFormat", () => {
  // every row is what the browser engine gives for [], [a], [a b], [a b c], [a b c d]
  const rows: Array<[string, string, string[]]> = [
    ["conjunction", "long", ["", "a", "a and b", "a, b, and c", "a, b, c, and d"]],
    ["conjunction", "short", ["", "a", "a & b", "a, b, & c", "a, b, c, & d"]],
    ["conjunction", "narrow", ["", "a", "a, b", "a, b, c", "a, b, c, d"]],
    ["disjunction", "long", ["", "a", "a or b", "a, b, or c", "a, b, c, or d"]],
    ["disjunction", "short", ["", "a", "a or b", "a, b, or c", "a, b, c, or d"]],
    ["disjunction", "narrow", ["", "a", "a or b", "a, b, or c", "a, b, c, or d"]],
    ["unit", "long", ["", "a", "a, b", "a, b, c", "a, b, c, d"]],
    ["unit", "short", ["", "a", "a, b", "a, b, c", "a, b, c, d"]],
    ["unit", "narrow", ["", "a", "a b", "a b c", "a b c d"]],
  ];

  for (const [type, style, expected] of rows) {
    test(`joins a ${type} list in the ${style} style`, async () => {
      const got = await value(`
        const f = new Intl.ListFormat("en-US", { type: "${type}", style: "${style}" });
        return JSON.stringify([[], ["a"], ["a", "b"], ["a", "b", "c"], ["a", "b", "c", "d"]].map((list) => f.format(list)));
      `);

      expect(JSON.parse(got)).toEqual(expected);
    });
  }

  test("defaults to a long conjunction", async () => {
    expect(await value(`return new Intl.ListFormat("en").format(["x", "y", "z"])`)).toBe("x, y, and z");
    expect(await value(`return new Intl.ListFormat().format(["x", "y"])`)).toBe("x and y");
  });

  test("takes any iterable of strings, and nothing at all", async () => {
    expect(await value(`return new Intl.ListFormat("en").format(new Set(["x", "y"]))`)).toBe("x and y");
    expect(await value(`return new Intl.ListFormat("en").format("abc")`)).toBe("a, b, and c");
    expect(await value(`return new Intl.ListFormat("en").format()`)).toBe("");
  });

  test("refuses what a browser refuses", async () => {
    expect(await value(`new Intl.ListFormat("en").format([1, 2])`)).toBe("error: TypeError: Iterable yielded 1 which is not a string");
    expect(await value(`new Intl.ListFormat("en").format(5)`)).toMatch(/^error: TypeError/);
    expect(await value(`new Intl.ListFormat("en", { type: "x" })`)).toBe(
      "error: RangeError: Value x out of range for Intl.ListFormat options property type",
    );
    expect(await value(`new Intl.ListFormat("en", { style: "x" })`)).toMatch(/^error: RangeError/);
    expect(await value(`Intl.ListFormat("en")`)).toMatch(/^error: TypeError/);
    expect(await value(`new Intl.ListFormat("de")`)).toMatch(/^error: RangeError/);
  });

  test("reports what it was made with, and looks like the built-ins", async () => {
    expect(
      await value(`
        const f = new Intl.ListFormat("en-US", { type: "unit", style: "narrow" });
        const r = f.resolvedOptions();
        return [r.locale, r.type, r.style, Object.prototype.toString.call(f), f instanceof Intl.ListFormat].join();
      `),
    ).toBe("en-US,unit,narrow,[object Intl.ListFormat],true");
  });
});
