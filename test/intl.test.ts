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

  test("reads each option once, when it is made, as a getter is not called again by each format", async () => {
    expect(
      await value(`
        let reads = 0;
        const format = new Intl.NumberFormat("en", { get maximumFractionDigits() { reads++; return 2; } });
        return [format.format(1.234), format.format(1.234), reads].join("|");
      `),
    ).toBe("1.23|1.23|1");
    expect(
      await value(`
        let reads = 0;
        return (5).toLocaleString("en", { get style() { return reads++ ? "unit" : "decimal"; }, unit: "acre" });
      `),
    ).toBe("5");
  });
});

describe("Intl.Collator", () => {
  test("reads each option once, when it is made", async () => {
    expect(
      await value(`
        let reads = 0;
        const collator = new Intl.Collator("en", { get numeric() { reads++; return true; } });
        return [collator.compare("a10", "a9"), collator.compare("a10", "a9"), reads].join("|");
      `),
    ).toBe("1|1|1");
  });

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
      "NumberFormat,Collator,DateTimeFormat,PluralRules,ListFormat,RelativeTimeFormat,Segmenter,DisplayNames,Locale,supportedValuesOf,getCanonicalLocales",
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

  test("of a date format names a zone the way Intl spells it", async () => {
    expect(await value(`return new Intl.DateTimeFormat("en-US", { timeZone: "europe/berlin" }).resolvedOptions().timeZone`)).toBe("Europe/Berlin");
    expect(await value(`return new Intl.DateTimeFormat("en-US", { timeZone: "etc/gmt+5" }).resolvedOptions().timeZone`)).toBe("Etc/GMT+5");
    expect(await value(`return new Intl.DateTimeFormat("en-US", { timeZone: "+05:00" }).resolvedOptions().timeZone`)).toBe("+05:00");
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
      `{"locale":"en-US","numberingSystem":"latn","style":"decimal","minimumIntegerDigits":1,"minimumFractionDigits":0,"maximumFractionDigits":3,"useGrouping":"auto","notation":"standard","signDisplay":"auto","roundingIncrement":1,"roundingMode":"halfExpand","roundingPriority":"auto","trailingZeroDisplay":"auto"}`,
    );
    expect(
      await value(`return JSON.stringify(new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).resolvedOptions())`),
    ).toBe(
      `{"locale":"en-US","numberingSystem":"latn","style":"currency","currency":"USD","currencyDisplay":"symbol","currencySign":"standard","minimumIntegerDigits":1,"minimumFractionDigits":2,"maximumFractionDigits":2,"useGrouping":"auto","notation":"standard","signDisplay":"auto","roundingIncrement":1,"roundingMode":"halfExpand","roundingPriority":"auto","trailingZeroDisplay":"auto"}`,
    );
    expect(
      await value(`const o = new Intl.NumberFormat("en-US", { style: "percent" }).resolvedOptions(); return [o.minimumFractionDigits, o.maximumFractionDigits].join()`),
    ).toBe("0,0");
    expect(
      await value(`return ["JPY", "KWD", "usd"].map((currency) => { const o = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions(); return [o.minimumFractionDigits, o.maximumFractionDigits].join("-") }).join(" ")`),
    ).toBe("0-0 3-3 2-2");
    expect(
      await value(`const o = new Intl.NumberFormat("en-US", { style: "currency", currency: "KWD", maximumFractionDigits: 1 }).resolvedOptions(); return [o.minimumFractionDigits, o.maximumFractionDigits].join()`),
    ).toBe("1,1");
    expect(
      await value(`const o = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 }).resolvedOptions(); return [o.minimumFractionDigits, o.maximumFractionDigits].join()`),
    ).toBe("2,3");
    expect(
      await value(`return [{ roundingMode: "floor", roundingPriority: "lessPrecision", maximumFractionDigits: 1 }, { trailingZeroDisplay: "stripIfInteger", roundingPriority: "morePrecision", maximumFractionDigits: 1 }, { notation: "compact" }].map((options) => { const o = new Intl.NumberFormat("en-US", options).resolvedOptions(); return [o.roundingIncrement, o.roundingMode, o.roundingPriority, o.trailingZeroDisplay].join() }).join(" ")`),
    ).toBe("1,floor,lessPrecision,auto 1,halfExpand,auto,stripIfInteger 1,halfExpand,morePrecision,auto");
    expect(await value(`return new Intl.NumberFormat("en-US", { useGrouping: false }).resolvedOptions().useGrouping`)).toBe("false");
    expect(await value(`return new Intl.NumberFormat("en-US", { useGrouping: "min2" }).resolvedOptions().useGrouping`)).toBe("min2");
    expect(await value(`return new Intl.NumberFormat("en-US", { notation: "compact" }).resolvedOptions().useGrouping`)).toBe("min2");
    expect(await value(`return new Intl.NumberFormat("en-US", { notation: "compact", useGrouping: "true" }).resolvedOptions().useGrouping`)).toBe("min2");
    expect(await value(`return new Intl.NumberFormat("en-US", { useGrouping: "true" }).resolvedOptions().useGrouping`)).toBe("auto");
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
      [`{ useGrouping: "bogus" }`, "RangeError: Value bogus out of range for Intl.NumberFormat options property useGrouping"],
      [`{ style: "currency", currency: "us" }`, "RangeError: Invalid currency code : us"],
      [`{ style: "currency", currency: "USDX" }`, "RangeError: Invalid currency code : USDX"],
      [`{ style: "currency", currency: 123 }`, "RangeError: Invalid currency code : 123"],
      [`{ style: "unit" }`, "TypeError: Invalid unit argument for Intl.NumberFormat() ''"],
      [`{ style: "unit", unit: "furlong" }`, "RangeError: Invalid unit argument for Intl.NumberFormat() 'furlong'"],
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
  test("reads each option once, when it is made, so a format does not call the getters again", async () => {
    expect(
      await value(`
        let reads = 0;
        const format = new Intl.DateTimeFormat("en", { timeZone: "UTC", get hour() { reads++; return "numeric"; } });
        return [format.format(0), format.format(0), reads].join("|");
      `),
    ).toBe("12 AM|12 AM|1");
  });

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

describe("Intl.DisplayNames, checked against Node 26.13", () => {
  test("names regions, currencies and base languages in English", async () => {
    expect(
      await value(`const r = new Intl.DisplayNames("en", { type: "region" }); return [r.of("US"), r.of("GB"), r.of("419"), r.of("ZZ"), r.of("XX"), r.of("001")].join("|")`),
    ).toBe("United States|United Kingdom|Latin America|Unknown Region|XX|world");
    expect(
      await value(`const c = new Intl.DisplayNames("en", { type: "currency" }); return [c.of("USD"), c.of("EUR"), c.of("JPY"), c.of("usd"), c.of("XXX"), c.of("xyz")].join("|")`),
    ).toBe("US Dollar|Euro|Japanese Yen|US Dollar|Unknown Currency|xyz");
    expect(
      await value(`const l = new Intl.DisplayNames("en", { type: "language" }); return [l.of("en"), l.of("fr"), l.of("zh"), l.of("EN")].join("|")`),
    ).toBe("English|French|Chinese|English");
  });

  test("gives the short region names for the ten regions that have one", async () => {
    expect(
      await value(`const s = new Intl.DisplayNames("en", { type: "region", style: "short" }); return [s.of("US"), s.of("GB"), s.of("HK"), s.of("CA")].join("|")`),
    ).toBe("US|UK|Hong Kong|Canada");
    expect(
      await value(`const n = new Intl.DisplayNames("en", { type: "region", style: "narrow" }); return [n.of("GB"), n.of("US")].join("|")`),
    ).toBe("UK|US");
  });

  test("answers an unknown code with the code, or with nothing for fallback none", async () => {
    expect(await value(`return new Intl.DisplayNames("en", { type: "region" }).of("XX")`)).toBe("XX");
    expect(await value(`return String(new Intl.DisplayNames("en", { type: "region", fallback: "none" }).of("XX"))`)).toBe("undefined");
    expect(await value(`return String(new Intl.DisplayNames("en", { type: "currency", fallback: "none" }).of("xyz"))`)).toBe("undefined");
  });

  test("reports its options as Node does", async () => {
    expect(await value(`return JSON.stringify(new Intl.DisplayNames("en", { type: "region" }).resolvedOptions())`)).toBe(
      '{"locale":"en","style":"long","type":"region","fallback":"code"}',
    );
    expect(await value(`return JSON.stringify(new Intl.DisplayNames("en", { type: "language" }).resolvedOptions())`)).toBe(
      '{"locale":"en","style":"long","type":"language","fallback":"code","languageDisplay":"dialect"}',
    );
    expect(await value(`return new Intl.DisplayNames(undefined, { type: "region" }).resolvedOptions().locale`)).toBe("en-US");
    expect(await value(`return Object.prototype.toString.call(new Intl.DisplayNames("en", { type: "region" }))`)).toBe("[object Intl.DisplayNames]");
  });

  test("refuses another language rather than answer it in English", async () => {
    expect(await value(`try { new Intl.DisplayNames("de", { type: "region" }); return "ok" } catch (e) { return e.name }`)).toBe("RangeError");
  });

  test("refuses what Node refuses, with its messages", async () => {
    const cases: Array<[string, string]> = [
      [`Intl.DisplayNames("en", { type: "region" })`, "TypeError: Constructor Intl.DisplayNames requires 'new'"],
      [`new Intl.DisplayNames("en")`, "TypeError: invalid_argument"],
      [`new Intl.DisplayNames("en", null)`, "TypeError: invalid_argument"],
      [`new Intl.DisplayNames("en", { type: "bogus" })`, "RangeError: Value bogus out of range for Intl.DisplayNames options property type"],
      [`new Intl.DisplayNames("en", { type: "region", style: "bogus" })`, "RangeError: Value bogus out of range for Intl.DisplayNames options property style"],
      [`new Intl.DisplayNames("en", { type: "region", fallback: "bogus" })`, "RangeError: Value bogus out of range for Intl.DisplayNames options property fallback"],
      [`new Intl.DisplayNames("en", { type: "region", languageDisplay: "bogus" })`, "RangeError: Value bogus out of range for Intl.DisplayNames options property languageDisplay"],
      [`new Intl.DisplayNames("en", { type: "region" }).of("USA")`, "RangeError: invalid_argument"],
      [`new Intl.DisplayNames("en", { type: "region" }).of()`, "RangeError: invalid_argument"],
      [`new Intl.DisplayNames("en", { type: "currency" }).of("US")`, "RangeError: invalid_argument"],
      [`new Intl.DisplayNames("en", { type: "language" }).of("en_US")`, "RangeError: invalid_argument"],
    ];

    for (const [call, expected] of cases) {
      expect(await value(`try { ${call}; return "ok" } catch (e) { return e.name + ": " + e.message }`)).toBe(expected);
    }
  });
});

describe("Intl.Locale, checked against Node 26.13", () => {
  test("parses a tag into its language, script and region, in Node's case", async () => {
    expect(await value(`const l = new Intl.Locale("EN-us"); return [l.language, l.script, l.region, l.baseName, l.toString()].join("|")`)).toBe(
      "en||US|en-US|en-US",
    );
    expect(await value(`const l = new Intl.Locale("zh-hant-tw"); return [l.language, l.script, l.region, l.baseName, String(l)].join("|")`)).toBe(
      "zh|Hant|TW|zh-Hant-TW|zh-Hant-TW",
    );
    expect(await value(`return String(new Intl.Locale("en-latn-us"))`)).toBe("en-Latn-US");
    expect(await value(`return [new Intl.Locale("en").region, new Intl.Locale("en").script, String(new Intl.Locale("en").region)].join("|")`)).toBe(
      "||undefined",
    );
  });

  test("keeps the extensions in toString and leaves them out of baseName", async () => {
    expect(await value(`const l = new Intl.Locale("EN-US-U-CA-BUDDHIST"); return [l.toString(), l.baseName, l.language, l.region].join("|")`)).toBe(
      "en-US-u-ca-buddhist|en-US|en|US",
    );
    expect(await value(`return [new Intl.Locale("en-x-private").toString(), new Intl.Locale("en-x-private").baseName].join("|")`)).toBe("en-x-private|en");
    expect(await value(`return new Intl.Locale("en-u-ca-buddhist").region`)).toBe("undefined");
  });

  test("sorts the variants as Node does", async () => {
    expect(await value(`return new Intl.Locale("sl-rozaj-biske").toString()`)).toBe("sl-biske-rozaj");
    expect(await value(`return new Intl.Locale("de-1996").toString()`)).toBe("de-1996");
    expect(await value(`return [new Intl.Locale("und").language, new Intl.Locale("und-Latn").toString()].join("|")`)).toBe("und|und-Latn");
  });

  test("sorts the keywords of the Unicode extension as Node does", async () => {
    expect(await value(`return new Intl.Locale("en-u-nu-latn-ca-buddhist").toString()`)).toBe("en-u-ca-buddhist-nu-latn");
    expect(await value(`return new Intl.Locale("en-US-u-ca-gregory-nu-latn-ca-buddhist").toString()`)).toBe("en-US-u-ca-gregory-nu-latn");
    expect(await value(`return new Intl.Locale("en-u-kn-false-kf-upper").toString()`)).toBe("en-u-kf-upper-kn-false");
    expect(await value(`return new Intl.Locale("en-u-kb-true-kn-true-ca-gregory").toString()`)).toBe("en-u-ca-gregory-kb-kn");
    expect(await value(`return new Intl.Locale("en-u-ca-true").toString()`)).toBe("en-u-ca");
    expect(await value(`return new Intl.Locale("en-u-co-pinyin-co-phonebk-x-a-b-c").toString()`)).toBe("en-u-co-pinyin-x-a-b-c");
  });

  test("takes the language, script and region options over the tag", async () => {
    expect(await value(`return new Intl.Locale("en", { region: "gb" }).toString()`)).toBe("en-GB");
    expect(await value(`return new Intl.Locale("en-US", { region: "GB" }).toString()`)).toBe("en-GB");
    expect(await value(`return new Intl.Locale("en", { script: "latn" }).toString()`)).toBe("en-Latn");
    expect(await value(`return new Intl.Locale("en", { language: "fr" }).toString()`)).toBe("fr");
  });

  test("refuses what Node refuses, with its messages", async () => {
    const cases: Array<[string, string]> = [
      [`new Intl.Locale("en_US")`, "RangeError: Incorrect locale information provided"],
      [`new Intl.Locale("en--US")`, "RangeError: Incorrect locale information provided"],
      [`new Intl.Locale("e")`, "RangeError: Incorrect locale information provided"],
      [`new Intl.Locale("123")`, "RangeError: Incorrect locale information provided"],
      [`new Intl.Locale("")`, "RangeError: First argument to Intl.Locale constructor can't be empty or missing"],
      [`new Intl.Locale()`, "TypeError: First argument to Intl.Locale constructor can't be empty or missing"],
      [`Intl.Locale("en")`, "TypeError: Constructor Intl.Locale requires 'new'"],
      [`new Intl.Locale("en", { region: "U" })`, "RangeError: Incorrect locale information provided"],
      [`new Intl.Locale("en", { script: "lat" })`, "RangeError: Incorrect locale information provided"],
      [`new Intl.Locale("en", null)`, "TypeError: Intl.Locale called on null or undefined"],
    ];

    for (const [call, expected] of cases) {
      expect(await value(`try { ${call}; return "ok" } catch (e) { return e.name + ": " + e.message }`)).toBe(expected);
    }
  });
});

describe("Intl.getCanonicalLocales, checked against Node 26.13", () => {
  test("writes each tag in the form Intl.Locale gives, once", async () => {
    expect(await value(`return JSON.stringify(Intl.getCanonicalLocales("EN-us"))`)).toBe(`["en-US"]`);
    expect(await value(`return JSON.stringify(Intl.getCanonicalLocales(["en-us", "EN-US", "fr"]))`)).toBe(`["en-US","fr"]`);
    expect(await value(`return JSON.stringify(Intl.getCanonicalLocales("zh-hant-tw"))`)).toBe(`["zh-Hant-TW"]`);
    expect(await value(`return JSON.stringify(Intl.getCanonicalLocales("sl-rozaj-biske"))`)).toBe(`["sl-biske-rozaj"]`);
    expect(await value(`return JSON.stringify(Intl.getCanonicalLocales("en-u-nu-latn-ca-buddhist"))`)).toBe(
      `["en-u-ca-buddhist-nu-latn"]`,
    );
    expect(await value(`return JSON.stringify(Intl.getCanonicalLocales([new Intl.Locale("de-at")]))`)).toBe(`["de-AT"]`);
    expect(await value(`return JSON.stringify(Intl.getCanonicalLocales(["en", , "fr"]))`)).toBe(`["en","fr"]`);
  });

  test("gives an empty list for nothing, and for a value that is not a list", async () => {
    expect(await value(`return JSON.stringify(Intl.getCanonicalLocales())`)).toBe("[]");
    expect(await value(`return JSON.stringify(Intl.getCanonicalLocales([]))`)).toBe("[]");
    expect(await value(`return JSON.stringify([5, true, {}].map((v) => Intl.getCanonicalLocales(v)))`)).toBe("[[],[],[]]");
  });

  test("refuses what Node refuses, with its messages", async () => {
    const cases: Array<[string, string]> = [
      [`Intl.getCanonicalLocales("en_US")`, "RangeError: Invalid language tag: en_US"],
      [`Intl.getCanonicalLocales("")`, "RangeError: Invalid language tag: "],
      [`Intl.getCanonicalLocales(["en", "root"])`, "RangeError: Invalid language tag: root"],
      [`Intl.getCanonicalLocales("zh-cmn-hans-cn")`, "RangeError: Invalid language tag: zh-cmn-hans-cn"],
      [`Intl.getCanonicalLocales(["en", 1])`, "TypeError: Language ID should be string or object."],
      [`Intl.getCanonicalLocales([null])`, "TypeError: Language ID should be string or object."],
      [`Intl.getCanonicalLocales(null)`, "TypeError: Cannot convert undefined or null to object"],
    ];

    for (const [call, expected] of cases) {
      expect(await value(`try { ${call}; return "ok" } catch (e) { return e.name + ": " + e.message }`)).toBe(expected);
    }
  });
});

describe("Intl objects, checked against Node 26.13", () => {
  test("have the tag Node gives them", async () => {
    expect(await value(`return Object.prototype.toString.call(new Intl.NumberFormat("en"))`)).toBe("[object Intl.NumberFormat]");
    expect(await value(`return Object.prototype.toString.call(new Intl.DateTimeFormat("en"))`)).toBe("[object Intl.DateTimeFormat]");
    expect(await value(`return String(new Intl.Collator())`)).toBe("[object Intl.Collator]");
  });
});

describe("Intl.DateTimeFormat.formatToParts, checked against Node 26.13", () => {
  test("gives the parts a date is written with, as Node does", async () => {
    expect(await value(`return JSON.stringify(new Intl.DateTimeFormat("en-US", {}).formatToParts(new Date(Date.UTC(2024, 0, 5, 13, 7, 9, 45))))`)).toBe(
      "[{\"type\":\"month\",\"value\":\"1\"},{\"type\":\"literal\",\"value\":\"/\"},{\"type\":\"day\",\"value\":\"5\"},{\"type\":\"literal\",\"value\":\"/\"},{\"type\":\"year\",\"value\":\"2024\"}]",
    );
    expect(await value(`return JSON.stringify(new Intl.DateTimeFormat("en-US", {"dateStyle":"full","timeStyle":"long","timeZone":"America/New_York"}).formatToParts(new Date(Date.UTC(2024, 0, 5, 13, 7, 9, 45))))`)).toBe(
      "[{\"type\":\"weekday\",\"value\":\"Friday\"},{\"type\":\"literal\",\"value\":\", \"},{\"type\":\"month\",\"value\":\"January\"},{\"type\":\"literal\",\"value\":\" \"},{\"type\":\"day\",\"value\":\"5\"},{\"type\":\"literal\",\"value\":\", \"},{\"type\":\"year\",\"value\":\"2024\"},{\"type\":\"literal\",\"value\":\" at \"},{\"type\":\"hour\",\"value\":\"8\"},{\"type\":\"literal\",\"value\":\":\"},{\"type\":\"minute\",\"value\":\"07\"},{\"type\":\"literal\",\"value\":\":\"},{\"type\":\"second\",\"value\":\"09\"},{\"type\":\"literal\",\"value\":\" \"},{\"type\":\"dayPeriod\",\"value\":\"AM\"},{\"type\":\"literal\",\"value\":\" \"},{\"type\":\"timeZoneName\",\"value\":\"EST\"}]",
    );
    expect(await value(`return JSON.stringify(new Intl.DateTimeFormat("en-US", {"hour":"numeric","minute":"2-digit","second":"2-digit","fractionalSecondDigits":3,"hour12":false,"timeZone":"America/New_York"}).formatToParts(new Date(Date.UTC(2024, 0, 5, 13, 7, 9, 45))))`)).toBe(
      "[{\"type\":\"hour\",\"value\":\"08\"},{\"type\":\"literal\",\"value\":\":\"},{\"type\":\"minute\",\"value\":\"07\"},{\"type\":\"literal\",\"value\":\":\"},{\"type\":\"second\",\"value\":\"09\"},{\"type\":\"literal\",\"value\":\".\"},{\"type\":\"fractionalSecond\",\"value\":\"045\"}]",
    );
    expect(await value(`return JSON.stringify(new Intl.DateTimeFormat("en-US", {"timeZoneName":"long","timeZone":"America/New_York"}).formatToParts(new Date(Date.UTC(2024, 0, 5, 13, 7, 9, 45))))`)).toBe(
      "[{\"type\":\"month\",\"value\":\"1\"},{\"type\":\"literal\",\"value\":\"/\"},{\"type\":\"day\",\"value\":\"5\"},{\"type\":\"literal\",\"value\":\"/\"},{\"type\":\"year\",\"value\":\"2024\"},{\"type\":\"literal\",\"value\":\", \"},{\"type\":\"timeZoneName\",\"value\":\"Eastern Standard Time\"}]",
    );
    expect(await value(`return JSON.stringify(new Intl.DateTimeFormat("en-US", {"dateStyle":"medium","timeStyle":"short","timeZone":"UTC"}).formatToParts(new Date(Date.UTC(2024, 0, 5, 13, 7, 9, 45))))`)).toBe(
      "[{\"type\":\"month\",\"value\":\"Jan\"},{\"type\":\"literal\",\"value\":\" \"},{\"type\":\"day\",\"value\":\"5\"},{\"type\":\"literal\",\"value\":\", \"},{\"type\":\"year\",\"value\":\"2024\"},{\"type\":\"literal\",\"value\":\", \"},{\"type\":\"hour\",\"value\":\"1\"},{\"type\":\"literal\",\"value\":\":\"},{\"type\":\"minute\",\"value\":\"07\"},{\"type\":\"literal\",\"value\":\" \"},{\"type\":\"dayPeriod\",\"value\":\"PM\"}]",
    );
  });

  test("joins its parts into what format writes, also where the engine writes the date", async () => {
    expect(
      await value(`const d = new Date(Date.UTC(2024, 0, 5, 13, 7, 9, 45)); return [
        { year: "2-digit", month: "narrow", weekday: "short", timeZone: "UTC" },
        { era: "short", timeZone: "UTC" },
        { dayPeriod: "short", hour: "numeric", timeZone: "UTC" },
        { timeStyle: "medium", timeZone: "Asia/Kolkata" },
        { month: "long", day: "numeric", timeZone: "America/New_York", timeZoneName: "short" },
      ].map((o) => { const f = new Intl.DateTimeFormat("en-US", o); return f.formatToParts(d).map((p) => p.value).join("") === f.format(d) }).join()`),
    ).toBe("true,true,true,true,true");
  });
});
