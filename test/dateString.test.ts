import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

describe("Date.prototype.toString and toTimeString", () => {
  const moments = [0, Date.UTC(2024, 0, 1, 12), Date.UTC(2024, 6, 1, 12), Date.UTC(2031, 2, 30, 1, 30)];

  test("end with the name of the time zone, as they do on the machine", async () => {
    for (const moment of moments) {
      const host = new Date(moment);

      expect(await value(`return new Date(${moment}).toString()`)).toBe(host.toString());
      expect(await value(`return new Date(${moment}).toTimeString()`)).toBe(host.toTimeString());
      expect(await value(`return String(new Date(${moment}))`)).toBe(host.toString());
      expect(await value("return `${new Date(" + moment + ")}`")).toBe(host.toString());
    }
  });

  test("leave toDateString and an invalid date as they were", async () => {
    expect(await value(`return new Date(0).toDateString()`)).toBe(new Date(0).toDateString());
    expect(await value(`return [new Date(NaN).toString(), new Date(NaN).toTimeString()].join()`)).toBe("Invalid Date,Invalid Date");
  });

  test("keep the name and length of the built-ins, and stay out of Object.keys", async () => {
    expect(
      await value(
        `return ["toString", "toTimeString"].map((n) => [Date.prototype[n].name, Date.prototype[n].length, Object.keys(Date.prototype).includes(n)].join()).join(" ")`,
      ),
    ).toBe("toString,0,false toTimeString,0,false");
  });

  test("throw on something that is not a date", async () => {
    expect(await value(`Date.prototype.toString.call({})`)).toMatch(/^error: TypeError/);
  });
});
