import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

describe("String.prototype.toLocaleUpperCase and toLocaleLowerCase", () => {
  test("maps the dotted and the dotless i apart in Turkish and Azeri, as Node does", async () => {
    expect(
      await value(
        `return ["i".toLocaleUpperCase("tr"), "I".toLocaleLowerCase("tr"), "\\u0130".toLocaleLowerCase("tr"), "I\\u0307".toLocaleLowerCase("tr"), "i".toLocaleUpperCase("az"), "I".toLocaleLowerCase("az-Latn")].map((s) => [...s].map((c) => c.codePointAt(0).toString(16)).join(" ")).join("|")`,
      ),
    ).toBe("130|131|69|69|130|131");
  });

  test("maps a mixed Turkish text as Node does", async () => {
    expect(await value(`return "iI\\u0307\\u0130\\u0131".toLocaleUpperCase("tr")`)).toBe("İİİI");
    expect(await value(`return "iI\\u0307\\u0130\\u0131".toLocaleLowerCase("tr")`)).toBe("iiiı");
  });

  test("takes the first of a list of locales", async () => {
    expect(await value(`return ["i".toLocaleUpperCase(["tr-TR", "en"]), "I".toLocaleLowerCase(["en", "tr"])].join("|")`)).toBe(
      "İ|i",
    );
  });

  test("maps every other locale and no locale as the engine does", async () => {
    expect(await value(`return ["i".toLocaleUpperCase("en-US"), "i".toLocaleUpperCase(), "I".toLocaleLowerCase("tra")].join("|")`)).toBe(
      "I|I|i",
    );
  });

  test("keeps the final sigma of Greek", async () => {
    expect(await value(`return "\\u0391\\u03a3".toLocaleLowerCase("tr")`)).toBe("ας");
  });

  test("refuses a missing this, as Node does", async () => {
    expect(await value(`try { String.prototype.toLocaleUpperCase.call(undefined, "tr") } catch (e) { return e.name }`)).toBe(
      "TypeError",
    );
  });
});
