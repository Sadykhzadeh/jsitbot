import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

describe("Number.prototype.toLocaleString", () => {
  test("groups thousands and keeps up to three decimals", async () => {
    expect(await value(`return (1234567.891).toLocaleString()`)).toBe("1,234,567.891");
    expect(await value(`return (1234.56789).toLocaleString("en-US")`)).toBe("1,234.568");
    expect(await value(`return (999).toLocaleString()`)).toBe("999");
    expect(await value(`return (-1234.5).toLocaleString()`)).toBe("-1,234.5");
    expect(await value(`return (1e21).toLocaleString()`)).toBe("1,000,000,000,000,000,000,000");
  });

  test("rounds on the digits the number is written with, half away from zero", async () => {
    expect(await value(`return (1.005).toLocaleString("en-US", { maximumFractionDigits: 2 })`)).toBe("1.01");
    expect(await value(`return (2.5).toLocaleString("en-US", { maximumFractionDigits: 0 })`)).toBe("3");
    expect(await value(`return (999999.9995).toLocaleString()`)).toBe("1,000,000");
    expect(await value(`return (0.0004).toLocaleString()`)).toBe("0");
    expect(await value(`return (-0.0004).toLocaleString()`)).toBe("-0");
  });

  test("honours the digit options", async () => {
    expect(await value(`return (5).toLocaleString("en-US", { minimumFractionDigits: 2 })`)).toBe("5.00");
    expect(await value(`return (1234.5).toLocaleString("en-US", { minimumFractionDigits: 5 })`)).toBe("1,234.50000");
    expect(await value(`return (7).toLocaleString("en-US", { minimumIntegerDigits: 3 })`)).toBe("007");
    expect(await value(`return (1234567).toLocaleString("en-US", { useGrouping: false })`)).toBe("1234567");
    expect(
      await value(`return (3).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 1 })`),
    ).toBe("error: RangeError: maximumFractionDigits value is out of range.");
  });

  test("formats percentages and currencies", async () => {
    expect(await value(`return (0.256).toLocaleString("en-US", { style: "percent" })`)).toBe("26%");
    expect(await value(`return (0.07).toLocaleString("en-US", { style: "percent", minimumFractionDigits: 1 })`)).toBe("7.0%");
    expect(await value(`return (1234.5).toLocaleString("en-US", { style: "currency", currency: "USD" })`)).toBe("$1,234.50");
    expect(await value(`return (-5).toLocaleString("en-US", { style: "currency", currency: "eur" })`)).toBe("-\u20ac5.00");
    expect(await value(`return (1234.5).toLocaleString("en-US", { style: "currency", currency: "JPY" })`)).toBe("\u00a51,235");
    expect(await value(`return (5).toLocaleString("en-US", { style: "currency", currency: "CHF" })`)).toBe("CHF\u00a05.00");
    expect(await value(`return (5).toLocaleString("en-US", { style: "currency" })`)).toContain("Currency code is required");
  });

  test("writes NaN and the infinities", async () => {
    expect(await value(`return [NaN, Infinity, -Infinity].map((n) => n.toLocaleString()).join(" ")`)).toBe("NaN \u221e -\u221e");
    expect(await value(`return NaN.toLocaleString("en-US", { style: "percent" })`)).toBe("NaN%");
  });

  test("is used for the numbers of an array", async () => {
    expect(await value(`return [1234.5, 1e6].toLocaleString()`)).toBe("1,234.5,1,000,000");
  });

  test("leaves another language and options it does not know to the engine", async () => {
    expect(await value(`return (1234.5).toLocaleString("de-DE")`)).toBe("1234.5");
    expect(await value(`return (1234.5).toLocaleString("en-US", { notation: "scientific" })`)).toBe("1234.5");
  });

  test("writes a compact number as a smaller one and a letter", async () => {
    const compact = (n: string, options = "") => value(`return (${n}).toLocaleString("en-US", { notation: "compact"${options} })`);

    expect(await compact("999")).toBe("999");
    expect(await compact("1000")).toBe("1K");
    expect(await compact("1234")).toBe("1.2K");
    expect(await compact("12345")).toBe("12K");
    expect(await compact("999499")).toBe("999K");
    expect(await compact("999500")).toBe("1M");
    expect(await compact("1234567")).toBe("1.2M");
    expect(await compact("-1500000000")).toBe("-1.5B");
    expect(await compact("2.5e12")).toBe("2.5T");
    expect(await compact("2.5e15")).toBe("2500T");
    expect(await compact("1e19")).toBe("10,000,000T");
    expect(await compact("0.1234")).toBe("0.12");
    expect(await compact("999.7")).toBe("1K");
    expect(await compact("1234", ', style: "currency", currency: "USD"')).toBe("$1.2K");
    expect(await compact("1234567", ', compactDisplay: "long"')).toBe("1.2 million");
    expect(await compact("1234567", ', style: "currency", currency: "USD", compactDisplay: "long"')).toBe("$1.2M");
    expect(await compact("1234", ", maximumFractionDigits: 2")).toBe("1.23K");
    expect(await compact("1000", ", minimumFractionDigits: 1")).toBe("1.0K");
    expect(await compact("123456", ", maximumSignificantDigits: 2")).toBe("120K");
    expect(await compact("1234567890123456789012", ", useGrouping: true")).toBe("1,234,567,890T");
    expect(await value(`return (1234567n).toLocaleString("en-US", { notation: "compact" })`)).toBe("1.2M");
  });

  test("rounds to a number of significant digits", async () => {
    const significant = (n: string, options: string) => value(`return (${n}).toLocaleString("en-US", { ${options} })`);

    expect(await significant("123456", "maximumSignificantDigits: 3")).toBe("123,000");
    expect(await significant("1.2345", "maximumSignificantDigits: 3")).toBe("1.23");
    expect(await significant("0.0012345", "maximumSignificantDigits: 2")).toBe("0.0012");
    expect(await significant("9.99", "maximumSignificantDigits: 2")).toBe("10");
    expect(await significant("0.999", "maximumSignificantDigits: 2")).toBe("1");
    expect(await significant("5", "minimumSignificantDigits: 3")).toBe("5.00");
    expect(await significant("0", "minimumSignificantDigits: 3")).toBe("0.00");
    expect(await significant("1234.5", "minimumSignificantDigits: 2, maximumSignificantDigits: 4")).toBe("1,235");
    expect(await significant("0.5", "style: 'percent', maximumSignificantDigits: 1")).toBe("50%");
    expect(await significant("1234.5", "minimumSignificantDigits: 5, maximumFractionDigits: 1")).toBe("1,234.5");
    expect(await significant("5", "minimumSignificantDigits: 4, maximumSignificantDigits: 2")).toBe(
      "error: RangeError: maximumSignificantDigits value is out of range.",
    );
    expect(await significant("5", "maximumSignificantDigits: 0")).toBe("error: RangeError: maximumSignificantDigits value is out of range.");
  });

  test("writes the sign the way signDisplay asks", async () => {
    const row = (mode: string) =>
      value(
        `return [5, -5, 0, -0, 0.0004, -0.0004, NaN, Infinity, -Infinity, 1234.5]` +
          `.map((n) => n.toLocaleString("en-US", { signDisplay: "${mode}" })).join(" ")`,
      );

    expect(await row("auto")).toBe("5 -5 0 -0 0 -0 NaN ∞ -∞ 1,234.5");
    expect(await row("always")).toBe("+5 -5 +0 -0 +0 -0 +NaN +∞ -∞ +1,234.5");
    expect(await row("exceptZero")).toBe("+5 -5 0 0 0 0 NaN +∞ -∞ +1,234.5");
    expect(await row("negative")).toBe("5 -5 0 0 0 0 NaN ∞ -∞ 1,234.5");
    expect(await row("never")).toBe("5 5 0 0 0 0 NaN ∞ ∞ 1,234.5");
  });

  test("puts the sign before a currency symbol, and judges zero by what is written", async () => {
    const sign = (n: string, options: string) => value(`return (${n}).toLocaleString("en-US", { ${options} })`);

    expect(await sign("5", "signDisplay: 'always', style: 'percent'")).toBe("+500%");
    expect(await sign("5", "signDisplay: 'always', style: 'currency', currency: 'USD'")).toBe("+$5.00");
    expect(await sign("1234567", "signDisplay: 'always', notation: 'compact'")).toBe("+1.2M");
    expect(await sign("0.001", "signDisplay: 'exceptZero', maximumFractionDigits: 0")).toBe("0");
    expect(await sign("-0.4", "signDisplay: 'negative', maximumFractionDigits: 0")).toBe("0");
    expect(await sign("-0.4", "signDisplay: 'auto', maximumFractionDigits: 0")).toBe("-0");
    expect(await value(`return (5n).toLocaleString("en-US", { signDisplay: "always" })`)).toBe("+5");
    expect(await sign("1", "signDisplay: 'bogus'")).toBe(
      "error: RangeError: Value bogus out of range for Intl.NumberFormat options property signDisplay",
    );
  });

  test("throws for a value that is not a number", async () => {
    expect(await value(`return Number.prototype.toLocaleString.call("x")`)).toContain("TypeError");
  });

  test("keeps the name and length of the built-in", async () => {
    expect(await value(`return [Number.prototype.toLocaleString.name, Number.prototype.toLocaleString.length].join()`)).toBe(
      "toLocaleString,0",
    );
  });
});

describe("BigInt.prototype.toLocaleString", () => {
  test("groups the digits, however many there are", async () => {
    expect(await value(`return (12345678901234567890n).toLocaleString()`)).toBe("12,345,678,901,234,567,890");
    expect(await value(`return (-1000n).toLocaleString("en-US")`)).toBe("-1,000");
    expect(await value(`return (5n).toLocaleString("en-US", { minimumFractionDigits: 2 })`)).toBe("5.00");
  });
});
