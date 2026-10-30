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
  test("is there, and has only what the two classes need", async () => {
    expect(await value(`return [typeof Intl, Object.prototype.toString.call(Intl)].join()`)).toBe("object,[object Intl]");
    expect(await value(`return typeof Intl.DateTimeFormat`)).toBe("undefined");
  });

  test("can be replaced by the program, and is not carried into the next run", async () => {
    expect(await value(`Intl = 5; return Intl`)).toBe("5");
    expect(await value(`return typeof Intl`)).toBe("object");
  });
});
