import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

describe("Intl.NumberFormat", () => {
  test("formats with the options of toLocaleString", async () => {
    expect(
      await value(`return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(1234.5)`),
    ).toBe("$1,234.50");
    expect(await value(`return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(2.5)`)).toBe("3");
  });

  test("has a format that works detached, as map needs", async () => {
    expect(await value(`return [1, 22222, 333.333].map(new Intl.NumberFormat().format).join(" ")`)).toBe("1 22,222 333.333");
  });

  test("formats a numeric string and a big integer", async () => {
    expect(await value(`return Intl.NumberFormat("en-US").format("1234567.5")`)).toBe("1,234,567.5");
    expect(await value(`return new Intl.NumberFormat().format(12345678901234567890n)`)).toBe("12,345,678,901,234,567,890");
  });

  test("checks its arguments when it is made", async () => {
    expect(await value(`new Intl.NumberFormat("en", { style: "currency" })`)).toContain("Currency code is required");
  });

  test("can be called without new, and is an instance of itself", async () => {
    expect(await value(`return Intl.NumberFormat() instanceof Intl.NumberFormat`)).toBe("true");
    expect(await value(`return Intl.NumberFormat.name`)).toBe("NumberFormat");
  });
});

describe("Intl.Collator", () => {
  test("compares as localeCompare does, and sorts when its compare is handed to sort", async () => {
    expect(await value(`return ["b", "a", "C"].sort(new Intl.Collator().compare).join("")`)).toBe("abC");
    expect(
      await value(`return ["a10", "a2"].sort(new Intl.Collator(undefined, { numeric: true }).compare).join()`),
    ).toBe("a2,a10");
    expect(await value(`return new Intl.Collator("en", { sensitivity: "base" }).compare("a", "A")`)).toBe("0");
  });
});

describe("Intl", () => {
  test("is there, and has only the classes it has", async () => {
    expect(await value(`return [typeof Intl, Object.prototype.toString.call(Intl)].join()`)).toBe("object,[object Intl]");
    expect(await value(`return Object.getOwnPropertyNames(Intl).join()`)).toBe(
      "NumberFormat,Collator,DateTimeFormat,PluralRules,ListFormat,RelativeTimeFormat,Segmenter",
    );
  });

  test("can be replaced by the program, and is not carried into the next run", async () => {
    expect(await value(`Intl = 5; return Intl`)).toBe("5");
    expect(await value(`return typeof Intl`)).toBe("object");
  });
});

describe("resolvedOptions", () => {
  const hostZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  test("of a date format names the time zone of the sandbox", async () => {
    expect(await value(`return Intl.DateTimeFormat().resolvedOptions().timeZone`)).toBe(hostZone);
    expect(await value(`return new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).resolvedOptions().timeZone`)).toBe("UTC");
  });

  test("of a date format has the locale, the calendar and what was asked for", async () => {
    expect(
      await value(`return JSON.stringify(new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", hour: "numeric" }).resolvedOptions())`),
    ).toBe(
      `{"locale":"en-US","calendar":"gregory","numberingSystem":"latn","timeZone":"UTC","hourCycle":"h12","hour12":true,"weekday":"long","hour":"numeric"}`,
    );
    expect(
      await value(`return JSON.stringify(new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).resolvedOptions())`),
    ).toBe(
      `{"locale":"en-US","calendar":"gregory","numberingSystem":"latn","timeZone":"UTC","year":"numeric","month":"numeric","day":"numeric"}`,
    );
  });

  test("of a number format fills in the defaults of its style", async () => {
    expect(await value(`return JSON.stringify(new Intl.NumberFormat("en-US").resolvedOptions())`)).toBe(
      `{"locale":"en-US","numberingSystem":"latn","style":"decimal","minimumIntegerDigits":1,"minimumFractionDigits":0,"maximumFractionDigits":3,"useGrouping":"auto","notation":"standard","signDisplay":"auto"}`,
    );
    expect(
      await value(`return JSON.stringify(new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).resolvedOptions())`),
    ).toBe(
      `{"locale":"en-US","numberingSystem":"latn","style":"currency","currency":"USD","currencyDisplay":"symbol","currencySign":"standard","minimumIntegerDigits":1,"minimumFractionDigits":2,"maximumFractionDigits":2,"useGrouping":"auto","notation":"standard","signDisplay":"auto"}`,
    );
    expect(
      await value(`const o = new Intl.NumberFormat("en-US", { style: "percent" }).resolvedOptions(); return [o.minimumFractionDigits, o.maximumFractionDigits].join()`),
    ).toBe("0,0");
    expect(
      await value(`const o = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 }).resolvedOptions(); return [o.minimumFractionDigits, o.maximumFractionDigits].join()`),
    ).toBe("2,3");
    expect(await value(`return new Intl.NumberFormat("en-US", { useGrouping: false }).resolvedOptions().useGrouping`)).toBe("false");
  });

  test("of a collator has the comparison options", async () => {
    expect(await value(`return JSON.stringify(new Intl.Collator("en-US", { numeric: true, sensitivity: "base" }).resolvedOptions())`)).toBe(
      `{"locale":"en-US","usage":"sort","sensitivity":"base","ignorePunctuation":false,"collation":"default","numeric":true,"caseFirst":"false"}`,
    );
    expect(await value(`return new Intl.Collator().resolvedOptions().sensitivity`)).toBe("variant");
  });
});

describe("language tags, checked as Node 26.13 checks them", () => {
  test("a tag that is not well formed is refused by every method that takes one", async () => {
    const tags = ["xx-invalid-!!", "en_US", "en--US", "root", "e", "en-u", "en-x", "en-u-ca-gregory-u-nu-latn", "x-foo", ""];
    const probes = [
      "new Intl.NumberFormat(t)",
      "new Intl.DateTimeFormat(t)",
      "new Intl.Collator(t)",
      "new Intl.Segmenter(t)",
      "new Intl.PluralRules(t)",
      "new Intl.ListFormat(t)",
      "new Intl.RelativeTimeFormat(t)",
      "(1).toLocaleString(t)",
      "new Date(0).toLocaleString(t)",
      `"a".localeCompare("b", t)`,
    ];
    const code = `
      const out = [];
      for (const t of ${JSON.stringify(tags)}) {
        ${probes.map((probe) => `try { ${probe}; out.push("ok"); } catch (e) { out.push(e.name + " " + e.message); }`).join("\n        ")}
      }
      return out.join("\\n");
    `;

    const result = await new QuickJsSandboxService({ maxResultLength: 100_000 }).execute(code);
    expect(result.ok && result.result.split("\n")).toEqual(
      tags.flatMap((tag) => probes.map(() => `RangeError Invalid language tag: ${tag}`)),
    );
  });

  test("a tag that is well formed is accepted, whatever its case and extensions", async () => {
    expect(
      await value(`
        const tags = ["EN-gb", "zh-Hant-TW", "sr-Latn-RS", "es-419", "en-US-posix", "en-a-bbb-x-a-ccc", "de-DE-u-co-phonebk-co-phonebk", "de-1901"];
        const out = [];
        for (const t of tags) {
          new Intl.NumberFormat(t); new Intl.DateTimeFormat(t); new Intl.Collator(t); new Intl.Segmenter(t);
          (1).toLocaleString(t); "a".localeCompare("b", t);
          out.push(t);
        }
        return out.join(",");
      `),
    ).toBe("EN-gb,zh-Hant-TW,sr-Latn-RS,es-419,en-US-posix,en-a-bbb-x-a-ccc,de-DE-u-co-phonebk-co-phonebk,de-1901");
  });
});
