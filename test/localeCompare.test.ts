import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

describe("String.prototype.localeCompare", () => {
  test("answers -1, 0 or 1", async () => {
    expect(await value(`return ["a".localeCompare("b"), "b".localeCompare("a"), "a".localeCompare("a")].join()`)).toBe(
      "-1,1,0",
    );
  });

  test("puts a small letter before a capital one, and letters before the next letter", async () => {
    expect(await value(`return ["b", "a", "C", "A", "c", "B"].sort((x, y) => x.localeCompare(y)).join("")`)).toBe(
      "aAbBcC",
    );
  });

  test("compares letters before accents", async () => {
    expect(
      await value(`return ["z", "ä", "a", "Z", "A", "resume", "résumé", "Resume"].sort((x, y) => x.localeCompare(y)).join(" ")`),
    ).toBe("a A ä resume Resume résumé z Z");
  });

  test("puts white space and punctuation before digits and digits before letters", async () => {
    expect(await value(`return ["ab", "a-b", "a b", "a1", "a_b"].sort((x, y) => x.localeCompare(y)).join("|")`)).toBe(
      "a b|a_b|a-b|a1|ab",
    );
  });

  test("sorts numbers by their value with numeric", async () => {
    expect(
      await value(
        `return ["item10", "item2", "Item1"].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })).join()`,
      ),
    ).toBe("Item1,item2,item10");
    expect(await value(`return "a02".localeCompare("a2", undefined, { numeric: true })`)).toBe("0");
    expect(await value(`return "a10".localeCompare("a9")`)).toBe("-1");
  });

  test("leaves out what the sensitivity says does not count", async () => {
    expect(await value(`return "a".localeCompare("A", "en", { sensitivity: "base" })`)).toBe("0");
    expect(await value(`return "a".localeCompare("á", "en", { sensitivity: "base" })`)).toBe("0");
    expect(await value(`return "a".localeCompare("A", "en", { sensitivity: "accent" })`)).toBe("0");
    expect(await value(`return "a".localeCompare("á", "en", { sensitivity: "accent" })`)).toBe("-1");
    expect(await value(`return "a".localeCompare("á", "en", { sensitivity: "case" })`)).toBe("0");
    expect(await value(`return "a".localeCompare("A", "en", { sensitivity: "case" })`)).toBe("-1");
  });

  test("puts capitals first with caseFirst upper", async () => {
    expect(await value(`return "a".localeCompare("A", undefined, { caseFirst: "upper" })`)).toBe("1");
  });

  test("can leave punctuation out", async () => {
    expect(await value(`return "a-b".localeCompare("ab", undefined, { ignorePunctuation: true })`)).toBe("0");
  });

  test("takes the text it is called on and the one it is given as strings", async () => {
    expect(await value(`return String.prototype.localeCompare.call(12, 9, undefined, { numeric: true })`)).toBe("1");
    expect(await value(`return "undefined".localeCompare()`)).toBe("0");
  });

  test("throws for null or undefined as any string method does", async () => {
    expect(await value(`String.prototype.localeCompare.call(null, "a")`)).toContain("TypeError");
  });

  test("keeps the name and length of the built-in", async () => {
    expect(await value(`return [String.prototype.localeCompare.name, String.prototype.localeCompare.length].join()`)).toBe(
      "localeCompare,1",
    );
  });

  test("is not carried into the next run", async () => {
    await sandbox.execute(`String.prototype.localeCompare = () => 7`);

    expect(await value(`return "a".localeCompare("b")`)).toBe("-1");
  });
});
