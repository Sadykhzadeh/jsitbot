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
      "NumberFormat,Collator,DateTimeFormat,PluralRules,ListFormat,RelativeTimeFormat,Segmenter,supportedValuesOf",
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

describe("Intl.NumberFormat options, checked against Node 26.13", () => {
  test("refuses a value Node refuses, and names the constructor", async () => {
    const cases: Array<[string, string]> = [
      [`{ style: "bogus" }`, "RangeError: Value bogus out of range for Intl.NumberFormat options property style"],
      [`{ currencyDisplay: "bogus" }`, "RangeError: Value bogus out of range for Intl.NumberFormat options property currencyDisplay"],
      [`{ notation: "bogus" }`, "RangeError: Value bogus out of range for Intl.NumberFormat options property notation"],
      [`{ notation: "compact", compactDisplay: "bogus" }`, "RangeError: Value bogus out of range for Intl.NumberFormat options property compactDisplay"],
      [`{ unitDisplay: "bogus", style: "unit", unit: "meter" }`, "RangeError: Value bogus out of range for Intl.NumberFormat options property unitDisplay"],
      [`{ signDisplay: "bogus" }`, "RangeError: Value bogus out of range for Intl.NumberFormat options property signDisplay"],
      [`{ roundingMode: "bogus" }`, "RangeError: Value bogus out of range for Intl.NumberFormat options property roundingMode"],
      [`{ style: "currency", currency: "us" }`, "RangeError: Invalid currency code : us"],
      [`{ style: "currency", currency: "USDX" }`, "RangeError: Invalid currency code : USDX"],
      [`{ style: "currency", currency: 123 }`, "RangeError: Invalid currency code : 123"],
      [`{ style: "unit" }`, "TypeError: Invalid unit argument for Intl.NumberFormat() ''"],
    ];

    for (const [options, expected] of cases) {
      expect(await value(`try { new Intl.NumberFormat("en", ${options}); return "ok" } catch (e) { return e.name + ": " + e.message }`)).toBe(expected);
    }
  });

  test("still takes the values Node takes, and a currency code in either case", async () => {
    expect(await value(`return [new Intl.NumberFormat("en", { style: "currency", currency: "usd" }).format(1), new Intl.NumberFormat("en", { style: "currency", currency: "XYZ" }).format(1)].join(" ")`)).toBe(
      "$1.00 XYZ\u00a01.00",
    );
  });
});

describe("Intl.Collator options, checked against Node 26.13", () => {
  test("refuses a value Node refuses, in the constructor and in localeCompare", async () => {
    const cases: Array<[string, string]> = [
      [`new Intl.Collator("en", { sensitivity: "bogus" })`, "RangeError: Value bogus out of range for Intl.Collator options property sensitivity"],
      [`new Intl.Collator("en", { usage: "bogus" })`, "RangeError: Value bogus out of range for Intl.Collator options property usage"],
      [`new Intl.Collator("en", { caseFirst: "bogus" })`, "RangeError: Value bogus out of range for Intl.Collator options property caseFirst"],
      [`new Intl.Collator("en", null)`, "TypeError: Intl.Collator called on null or undefined"],
      [`"a".localeCompare("b", "en", { sensitivity: "bogus" })`, "RangeError: Value bogus out of range for String.prototype.localeCompare options property sensitivity"],
      [`"a".localeCompare("b", "en", null)`, "TypeError: String.prototype.localeCompare called on null or undefined"],
    ];

    for (const [call, expected] of cases) {
      expect(await value(`try { ${call}; return "ok" } catch (e) { return e.name + ": " + e.message }`)).toBe(expected);
    }
  });

  test("reports caseFirst false as the string Node reports it as", async () => {
    expect(await value(`return JSON.stringify(new Intl.Collator("en", { caseFirst: false }).resolvedOptions().caseFirst)`)).toBe('"false"');
  });
});

describe("Intl.DateTimeFormat and toLocale* options, checked against Node 26.13", () => {
  test("refuses an era, day period or matcher value Node refuses, and names the method", async () => {
    const cases: Array<[string, string]> = [
      [`new Intl.DateTimeFormat("en", { era: "bogus" })`, "RangeError: Value bogus out of range for Intl.DateTimeFormat options property era"],
      [`new Intl.DateTimeFormat("en", { dayPeriod: "bogus" })`, "RangeError: Value bogus out of range for Intl.DateTimeFormat options property dayPeriod"],
      [`new Intl.DateTimeFormat("en", { formatMatcher: "bogus" })`, "RangeError: Value bogus out of range for Intl.DateTimeFormat options property formatMatcher"],
      [`new Intl.DateTimeFormat("en", { localeMatcher: "bogus" })`, "RangeError: Value bogus out of range for Intl.DateTimeFormat options property localeMatcher"],
      [`new Date(0).toLocaleString("en", { era: "bogus" })`, "RangeError: Value bogus out of range for Date.prototype.toLocaleString options property era"],
      [`new Date(0).toLocaleDateString("en", { dayPeriod: "bogus" })`, "RangeError: Value bogus out of range for Date.prototype.toLocaleDateString options property dayPeriod"],
      [`new Date(0).toLocaleTimeString("en", { formatMatcher: "bogus" })`, "RangeError: Value bogus out of range for Date.prototype.toLocaleTimeString options property formatMatcher"],
      [`new Date(0).toLocaleTimeString("en", { localeMatcher: "bogus" })`, "RangeError: Value bogus out of range for Date.prototype.toLocaleTimeString options property localeMatcher"],
    ];

    for (const [call, expected] of cases) {
      expect(await value(`try { ${call}; return "ok" } catch (e) { return e.name + ": " + e.message }`)).toBe(expected);
    }
  });

  test("takes the values Node takes for them, and leaves the matchers out of resolvedOptions", async () => {
    expect(
      await value(`return new Intl.DateTimeFormat("en-US", { formatMatcher: "basic", localeMatcher: "lookup", year: "numeric" }).format(new Date(0))`),
    ).toBe("1970");
    expect(
      await value(`return JSON.stringify(new Intl.DateTimeFormat("en-US", { timeZone: "UTC", era: "narrow", dayPeriod: "long", formatMatcher: "best fit", localeMatcher: "best fit", year: "numeric" }).resolvedOptions())`),
    ).toBe('{"locale":"en-US","calendar":"gregory","numberingSystem":"latn","timeZone":"UTC","era":"narrow","year":"numeric","dayPeriod":"long"}');
  });
});

describe("Intl.supportedValuesOf, checked against Node 26.13", () => {
  test("lists each key with the count, first and last value Node gives", async () => {
    const cases: Array<[string, string]> = [
      ["calendar", "18,buddhist,roc"],
      ["collation", "12,compat,zhuyin"],
      ["currency", "162,AED,ZWL"],
      ["numberingSystem", "78,adlm,wcho"],
      ["timeZone", "418,Africa/Abidjan,Pacific/Wallis"],
      ["unit", "45,acre,year"],
    ];

    for (const [key, expected] of cases) {
      expect(
        await value(`const v = Intl.supportedValuesOf("${key}"); return [v.length, v[0], v[v.length - 1]].join()`),
      ).toBe(expected);
    }
  });

  test("lists the units without the compound ones the number format also takes, and the zones by Node's names", async () => {
    expect(await value(`return [Intl.supportedValuesOf("unit").includes("kilometer"), Intl.supportedValuesOf("unit").includes("kilometer-per-hour")].join()`)).toBe("true,false");
    expect(await value(`return [Intl.supportedValuesOf("timeZone").includes("Asia/Calcutta"), Intl.supportedValuesOf("timeZone").includes("Asia/Kolkata")].join()`)).toBe("true,false");
  });

  test("returns a new array each time", async () => {
    expect(await value(`Intl.supportedValuesOf("unit").length = 0; return Intl.supportedValuesOf("unit").length`)).toBe("45");
  });

  test("refuses a key Node refuses", async () => {
    expect(await value(`try { Intl.supportedValuesOf("bogus"); return "ok" } catch (e) { return e.name + ": " + e.message }`)).toBe(
      "RangeError: Invalid key : bogus",
    );
    expect(await value(`try { Intl.supportedValuesOf(); return "ok" } catch (e) { return e.name + ": " + e.message }`)).toBe(
      "RangeError: Invalid key : undefined",
    );
    expect(await value(`return [Intl.supportedValuesOf.name, Intl.supportedValuesOf.length].join()`)).toBe("supportedValuesOf,1");
  });
});
