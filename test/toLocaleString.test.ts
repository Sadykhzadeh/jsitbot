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
    expect(await value(`return (1234.5).toLocaleString("en-US", { notation: "compact" })`)).toBe("1234.5");
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
