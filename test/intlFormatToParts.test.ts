import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService({ timeoutMs: 5_000, maxResultLength: 100_000 });

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

// The parts are compared with what the host's Intl gives for the same options, since
// what each kind of part is called and where the pieces split is its to say.
// The numbers and the options are written as source, since a few of them (NaN, -0) are not JSON.
const read = (source: string) => (0, eval)(`(${source})`);
const NUMBERS = ["0", "1", "1234.5", "-1234.5", "1234567.891", "0.256", "-0", "1e21", "12345678901234", "NaN", "Infinity", "-Infinity", "1500", "1e9", "0.000123", "999999.5", "-0.4"];
const OPTIONS = [
  "{}",
  `{ style: "percent" }`,
  `{ style: "currency", currency: "USD" }`,
  `{ style: "currency", currency: "EUR" }`,
  `{ style: "currency", currency: "JPY" }`,
  `{ style: "currency", currency: "CHF" }`,
  `{ style: "currency", currency: "USD", currencyDisplay: "code" }`,
  `{ style: "currency", currency: "USD", currencySign: "accounting" }`,
  `{ notation: "compact" }`,
  `{ notation: "compact", compactDisplay: "long" }`,
  `{ notation: "compact", style: "currency", currency: "USD" }`,
  `{ notation: "scientific" }`,
  `{ notation: "engineering", signDisplay: "always" }`,
  `{ signDisplay: "always" }`,
  `{ minimumFractionDigits: 2 }`,
  `{ useGrouping: false }`,
  `{ maximumSignificantDigits: 3 }`,
];

describe("Intl.NumberFormat formatToParts", () => {
  test("splits a number into the parts the platform names", async () => {
    for (const number of NUMBERS) {
      const sets = OPTIONS.map((options) => JSON.stringify(new Intl.NumberFormat("en-US", read(options)).formatToParts(read(number))));
      const guest = await value(`
        const options = [${OPTIONS.join(", ")}];
        return JSON.stringify(options.map((o) => JSON.stringify(new Intl.NumberFormat("en-US", o).formatToParts(${number}))));
      `);

      expect(JSON.parse(guest)).toEqual(sets);
    }
  });

  test("joins up to what format gives", async () => {
    expect(
      await value(`
        const f = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
        return [1234.5, -0.5, 1e6].every((n) => f.formatToParts(n).map((p) => p.value).join("") === f.format(n));
      `),
    ).toBe("true");
  });

  test("takes a bigint and a value that is not a number", async () => {
    expect(await value(`return JSON.stringify(new Intl.NumberFormat("en-US").formatToParts(1234567n))`)).toBe(
      JSON.stringify(new Intl.NumberFormat("en-US").formatToParts(1234567n)),
    );
    expect(await value(`return JSON.stringify(new Intl.NumberFormat("en-US").formatToParts("42.5"))`)).toBe(
      JSON.stringify(new Intl.NumberFormat("en-US").formatToParts("42.5" as unknown as number)),
    );
  });
});
