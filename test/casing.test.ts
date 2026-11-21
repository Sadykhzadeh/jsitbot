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

  test("refuses a malformed locale tag, as Node does", async () => {
    expect(await value(`try { "i".toLocaleUpperCase("x_y") } catch (e) { return e.name + " " + e.message }`)).toBe(
      "RangeError Invalid language tag: x_y",
    );
    expect(await value(`try { "I".toLocaleLowerCase("en--US") } catch (e) { return e.name + " " + e.message }`)).toBe(
      "RangeError Invalid language tag: en--US",
    );
    expect(await value(`try { "i".toLocaleUpperCase(["x_y", "tr"]) } catch (e) { return e.name + " " + e.message }`)).toBe(
      "RangeError Invalid language tag: x_y",
    );
    expect(await value(`try { "i".toLocaleUpperCase(null) } catch (e) { return e.name }`)).toBe("TypeError");
  });

  test("reads the first locale of a list, as Node does", async () => {
    expect(await value(`return "i".toLocaleUpperCase(["tr", "x_y"])`)).toBe("\u0130");
  });

  test("reads the locale argument by its shape, as Node does", async () => {
    const shapes = [
      `[undefined]`,
      `[1, "tr"]`,
      `[null]`,
      `[[]]`,
      `[{}]`,
      `"tr"`,
      `[["tr"]]`,
      `[{ toString() { return "tr" } }]`,
      `[new String("tr")]`,
      `["tr", undefined]`,
      `[]`,
      `{}`,
      `5`,
    ];
    const code = `const out = []; for (const v of [${shapes.join(", ")}]) { try { out.push(JSON.stringify("i".toLocaleUpperCase(v))) } catch (e) { out.push(e.name) } } return out.join(" ")`;

    expect(await value(code)).toBe(
      'TypeError TypeError TypeError RangeError RangeError "\u0130" "\u0130" "\u0130" "\u0130" "\u0130" "I" "I" "I"',
    );
  });

  test("still refuses a malformed tag after a valid one has been read, and after many tags", async () => {
    expect(
      await value(
        `"i".toLocaleUpperCase("tr"); "i".toLocaleUpperCase("tr"); try { "i".toLocaleUpperCase("x_y") } catch (e) { return e.name }`,
      ),
    ).toBe("RangeError");
    expect(
      await value(
        `for (let i = 0; i < 300; i++) "i".toLocaleUpperCase("en-x-t" + i); return "i".toLocaleUpperCase("tr")`,
      ),
    ).toBe("\u0130");
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
