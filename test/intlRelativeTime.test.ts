import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

// Every expected text below is what node 24 answers for the same call.
const UNITS = ["second", "minute", "hour", "day", "week", "month", "quarter", "year"];
const VALUES = "[-2, -1, -0, 0, 1, 2, 1.5, 1000]";

describe("Intl.RelativeTimeFormat", () => {
  const tables: Array<[string, string, string[][]]> = [
    ["long", "always", [
      ["2 seconds ago","1 second ago","0 seconds ago","in 0 seconds","in 1 second","in 2 seconds","in 1.5 seconds","in 1,000 seconds"],
      ["2 minutes ago","1 minute ago","0 minutes ago","in 0 minutes","in 1 minute","in 2 minutes","in 1.5 minutes","in 1,000 minutes"],
      ["2 hours ago","1 hour ago","0 hours ago","in 0 hours","in 1 hour","in 2 hours","in 1.5 hours","in 1,000 hours"],
      ["2 days ago","1 day ago","0 days ago","in 0 days","in 1 day","in 2 days","in 1.5 days","in 1,000 days"],
      ["2 weeks ago","1 week ago","0 weeks ago","in 0 weeks","in 1 week","in 2 weeks","in 1.5 weeks","in 1,000 weeks"],
      ["2 months ago","1 month ago","0 months ago","in 0 months","in 1 month","in 2 months","in 1.5 months","in 1,000 months"],
      ["2 quarters ago","1 quarter ago","0 quarters ago","in 0 quarters","in 1 quarter","in 2 quarters","in 1.5 quarters","in 1,000 quarters"],
      ["2 years ago","1 year ago","0 years ago","in 0 years","in 1 year","in 2 years","in 1.5 years","in 1,000 years"],
    ]],
    ["long", "auto", [
      ["2 seconds ago","1 second ago","now","now","in 1 second","in 2 seconds","in 1.5 seconds","in 1,000 seconds"],
      ["2 minutes ago","1 minute ago","this minute","this minute","in 1 minute","in 2 minutes","in 1.5 minutes","in 1,000 minutes"],
      ["2 hours ago","1 hour ago","this hour","this hour","in 1 hour","in 2 hours","in 1.5 hours","in 1,000 hours"],
      ["2 days ago","yesterday","today","today","tomorrow","in 2 days","in 1.5 days","in 1,000 days"],
      ["2 weeks ago","last week","this week","this week","next week","in 2 weeks","in 1.5 weeks","in 1,000 weeks"],
      ["2 months ago","last month","this month","this month","next month","in 2 months","in 1.5 months","in 1,000 months"],
      ["2 quarters ago","last quarter","this quarter","this quarter","next quarter","in 2 quarters","in 1.5 quarters","in 1,000 quarters"],
      ["2 years ago","last year","this year","this year","next year","in 2 years","in 1.5 years","in 1,000 years"],
    ]],
    ["short", "always", [
      ["2 sec. ago","1 sec. ago","0 sec. ago","in 0 sec.","in 1 sec.","in 2 sec.","in 1.5 sec.","in 1,000 sec."],
      ["2 min. ago","1 min. ago","0 min. ago","in 0 min.","in 1 min.","in 2 min.","in 1.5 min.","in 1,000 min."],
      ["2 hr. ago","1 hr. ago","0 hr. ago","in 0 hr.","in 1 hr.","in 2 hr.","in 1.5 hr.","in 1,000 hr."],
      ["2 days ago","1 day ago","0 days ago","in 0 days","in 1 day","in 2 days","in 1.5 days","in 1,000 days"],
      ["2 wk. ago","1 wk. ago","0 wk. ago","in 0 wk.","in 1 wk.","in 2 wk.","in 1.5 wk.","in 1,000 wk."],
      ["2 mo. ago","1 mo. ago","0 mo. ago","in 0 mo.","in 1 mo.","in 2 mo.","in 1.5 mo.","in 1,000 mo."],
      ["2 qtrs. ago","1 qtr. ago","0 qtrs. ago","in 0 qtrs.","in 1 qtr.","in 2 qtrs.","in 1.5 qtrs.","in 1,000 qtrs."],
      ["2 yr. ago","1 yr. ago","0 yr. ago","in 0 yr.","in 1 yr.","in 2 yr.","in 1.5 yr.","in 1,000 yr."],
    ]],
    ["short", "auto", [
      ["2 sec. ago","1 sec. ago","now","now","in 1 sec.","in 2 sec.","in 1.5 sec.","in 1,000 sec."],
      ["2 min. ago","1 min. ago","this minute","this minute","in 1 min.","in 2 min.","in 1.5 min.","in 1,000 min."],
      ["2 hr. ago","1 hr. ago","this hour","this hour","in 1 hr.","in 2 hr.","in 1.5 hr.","in 1,000 hr."],
      ["2 days ago","yesterday","today","today","tomorrow","in 2 days","in 1.5 days","in 1,000 days"],
      ["2 wk. ago","last wk.","this wk.","this wk.","next wk.","in 2 wk.","in 1.5 wk.","in 1,000 wk."],
      ["2 mo. ago","last mo.","this mo.","this mo.","next mo.","in 2 mo.","in 1.5 mo.","in 1,000 mo."],
      ["2 qtrs. ago","last qtr.","this qtr.","this qtr.","next qtr.","in 2 qtrs.","in 1.5 qtrs.","in 1,000 qtrs."],
      ["2 yr. ago","last yr.","this yr.","this yr.","next yr.","in 2 yr.","in 1.5 yr.","in 1,000 yr."],
    ]],
    ["narrow", "always", [
      ["2s ago","1s ago","0s ago","in 0s","in 1s","in 2s","in 1.5s","in 1,000s"],
      ["2m ago","1m ago","0m ago","in 0m","in 1m","in 2m","in 1.5m","in 1,000m"],
      ["2h ago","1h ago","0h ago","in 0h","in 1h","in 2h","in 1.5h","in 1,000h"],
      ["2d ago","1d ago","0d ago","in 0d","in 1d","in 2d","in 1.5d","in 1,000d"],
      ["2w ago","1w ago","0w ago","in 0w","in 1w","in 2w","in 1.5w","in 1,000w"],
      ["2mo ago","1mo ago","0mo ago","in 0mo","in 1mo","in 2mo","in 1.5mo","in 1,000mo"],
      ["2q ago","1q ago","0q ago","in 0q","in 1q","in 2q","in 1.5q","in 1,000q"],
      ["2y ago","1y ago","0y ago","in 0y","in 1y","in 2y","in 1.5y","in 1,000y"],
    ]],
    ["narrow", "auto", [
      ["2s ago","1s ago","now","now","in 1s","in 2s","in 1.5s","in 1,000s"],
      ["2m ago","1m ago","this minute","this minute","in 1m","in 2m","in 1.5m","in 1,000m"],
      ["2h ago","1h ago","this hour","this hour","in 1h","in 2h","in 1.5h","in 1,000h"],
      ["2d ago","yesterday","today","today","tomorrow","in 2d","in 1.5d","in 1,000d"],
      ["2w ago","last wk.","this wk.","this wk.","next wk.","in 2w","in 1.5w","in 1,000w"],
      ["2mo ago","last mo.","this mo.","this mo.","next mo.","in 2mo","in 1.5mo","in 1,000mo"],
      ["2q ago","last qtr.","this qtr.","this qtr.","next qtr.","in 2q","in 1.5q","in 1,000q"],
      ["2y ago","last yr.","this yr.","this yr.","next yr.","in 2y","in 1.5y","in 1,000y"],
    ]],
  ];

  for (const [style, numeric, rows] of tables) {
    test(`says every unit in the ${style} style, numeric ${numeric}`, async () => {
      const answer = await value(`
        const f = new Intl.RelativeTimeFormat("en", { style: "${style}", numeric: "${numeric}" });
        return JSON.stringify(${JSON.stringify(UNITS)}.map((unit) => ${VALUES}.map((n) => f.format(n, unit))));
      `);

      expect(JSON.parse(answer)).toEqual(rows);
    });
  }

  test("takes the plural of a unit as well as the singular", async () => {
    expect(await value(`return new Intl.RelativeTimeFormat("en").format(1, "days")`)).toBe("in 1 day");
    expect(await value(`return new Intl.RelativeTimeFormat("en").format(-3, "hours")`)).toBe("3 hours ago");
  });

  test("takes a number given as text, and the defaults are long and always", async () => {
    expect(await value(`return new Intl.RelativeTimeFormat().format("3", "day")`)).toBe("in 3 days");
    expect(await value(`return new Intl.RelativeTimeFormat("en", { numeric: undefined }).format(1, "day")`)).toBe("in 1 day");
  });

  test("refuses a unit it does not know and a value that is not finite", async () => {
    expect(await value(`new Intl.RelativeTimeFormat().format(1, "fortnight")`)).toBe(
      "error: RangeError: Invalid unit argument for Intl.RelativeTimeFormat.prototype.format() 'fortnight'",
    );
    expect(await value(`new Intl.RelativeTimeFormat().format(Infinity, "day")`)).toBe(
      "error: RangeError: Value need to be finite number for Intl.RelativeTimeFormat.prototype.format()",
    );
    expect(await value(`new Intl.RelativeTimeFormat().format(NaN, "day")`)).toContain("finite number");
  });

  test("refuses an option it does not know and a language other than English", async () => {
    expect(await value(`new Intl.RelativeTimeFormat("en", { style: "x" })`)).toBe(
      "error: RangeError: Value x out of range for Intl.RelativeTimeFormat options property style",
    );
    expect(await value(`new Intl.RelativeTimeFormat("de")`)).toContain("RangeError");
  });

  test("tells its options, and is named like the others", async () => {
    expect(await value(`return JSON.stringify(new Intl.RelativeTimeFormat().resolvedOptions())`)).toBe(
      '{"locale":"en-US","style":"long","numeric":"always","numberingSystem":"latn"}',
    );
    expect(await value(`return Object.prototype.toString.call(new Intl.RelativeTimeFormat())`)).toBe("[object Intl.RelativeTimeFormat]");
  });
});
