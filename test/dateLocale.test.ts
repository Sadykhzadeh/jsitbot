import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();
const wide = new QuickJsSandboxService({ maxResultLength: 100_000 });

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

type Case = [time: number, method: string, options: object, expected: string];

// Every row was produced by the browser engine's own Intl for en-US in UTC.
const CASES: Case[] = [
  [1704413229045, "toLocaleString", {}, "1/5/2024, 12:07:09 AM"],
  [1704413229045, "toLocaleDateString", {}, "1/5/2024"],
  [1704413229045, "toLocaleTimeString", {}, "12:07:09 AM"],
  [1704413229045, "toLocaleString", {"hour12":false}, "1/5/2024, 00:07:09"],
  [1704413229045, "toLocaleTimeString", {"hour12":false}, "00:07:09"],
  [1704413229045, "toLocaleTimeString", {"hourCycle":"h23"}, "00:07:09"],
  [1704413229045, "toLocaleTimeString", {"hourCycle":"h24"}, "00:07:09"],
  [1704413229045, "toLocaleString", {"dateStyle":"full"}, "Friday, January 5, 2024"],
  [1704413229045, "toLocaleString", {"dateStyle":"long"}, "January 5, 2024"],
  [1704413229045, "toLocaleString", {"dateStyle":"medium"}, "Jan 5, 2024"],
  [1704413229045, "toLocaleString", {"dateStyle":"short"}, "1/5/24"],
  [1704413229045, "toLocaleString", {"timeStyle":"long"}, "12:07:09 AM UTC"],
  [1704413229045, "toLocaleString", {"timeStyle":"medium"}, "12:07:09 AM"],
  [1704413229045, "toLocaleString", {"timeStyle":"short"}, "12:07 AM"],
  [1704413229045, "toLocaleString", {"dateStyle":"medium","timeStyle":"short"}, "Jan 5, 2024, 12:07 AM"],
  [1704413229045, "toLocaleString", {"dateStyle":"full","timeStyle":"long"}, "Friday, January 5, 2024 at 12:07:09 AM UTC"],
  [1704413229045, "toLocaleDateString", {"dateStyle":"long"}, "January 5, 2024"],
  [1704413229045, "toLocaleTimeString", {"timeStyle":"short"}, "12:07 AM"],
  [1704413229045, "toLocaleDateString", {"year":"numeric","month":"long","day":"numeric"}, "January 5, 2024"],
  [1704413229045, "toLocaleDateString", {"weekday":"long","year":"numeric","month":"long","day":"numeric"}, "Friday, January 5, 2024"],
  [1704413229045, "toLocaleDateString", {"weekday":"short","year":"numeric","month":"short","day":"numeric"}, "Fri, Jan 5, 2024"],
  [1704413229045, "toLocaleDateString", {"month":"short","day":"numeric"}, "Jan 5"],
  [1704413229045, "toLocaleDateString", {"month":"long","year":"numeric"}, "January 2024"],
  [1704413229045, "toLocaleDateString", {"month":"long"}, "January"],
  [1704413229045, "toLocaleDateString", {"weekday":"long"}, "Friday"],
  [1704413229045, "toLocaleDateString", {"year":"2-digit","month":"2-digit","day":"2-digit"}, "01/05/24"],
  [1704413229045, "toLocaleDateString", {"month":"narrow"}, "J"],
  [1704413229045, "toLocaleDateString", {"weekday":"narrow"}, "F"],
  [1704413229045, "toLocaleDateString", {"year":"numeric"}, "2024"],
  [1704413229045, "toLocaleDateString", {"day":"numeric"}, "5"],
  [1704413229045, "toLocaleDateString", {"month":"numeric","day":"numeric"}, "1/5"],
  [1704413229045, "toLocaleDateString", {"year":"numeric","month":"numeric"}, "1/2024"],
  [1704413229045, "toLocaleDateString", {"weekday":"short","month":"numeric","day":"numeric","year":"numeric"}, "Fri, 1/5/2024"],
  [1704413229045, "toLocaleDateString", {"weekday":"long","month":"long","day":"numeric"}, "Friday, January 5"],
  [1704413229045, "toLocaleDateString", {"weekday":"long","day":"numeric"}, "5 Friday"],
  [1704413229045, "toLocaleDateString", {"weekday":"short","year":"numeric"}, "2024 Fri"],
  [1704413229045, "toLocaleDateString", {"weekday":"long","month":"long"}, "January Friday"],
  [1704413229045, "toLocaleDateString", {"month":"long","day":"2-digit"}, "January 05"],
  [1704413229045, "toLocaleDateString", {"year":"2-digit","month":"long"}, "January 24"],
  [1704413229045, "toLocaleDateString", {"year":"numeric","month":"short","day":"2-digit"}, "Jan 05, 2024"],
  [1704413229045, "toLocaleTimeString", {"hour":"numeric"}, "12 AM"],
  [1704413229045, "toLocaleTimeString", {"hour":"2-digit"}, "12 AM"],
  [1704413229045, "toLocaleTimeString", {"minute":"numeric"}, "7"],
  [1704413229045, "toLocaleTimeString", {"second":"numeric"}, "9"],
  [1704413229045, "toLocaleTimeString", {"hour":"numeric","minute":"numeric"}, "12:07 AM"],
  [1704413229045, "toLocaleTimeString", {"hour":"2-digit","minute":"2-digit"}, "12:07 AM"],
  [1704413229045, "toLocaleTimeString", {"minute":"2-digit","second":"2-digit"}, "07:09"],
  [1704413229045, "toLocaleTimeString", {"minute":"numeric","second":"numeric"}, "07:09"],
  [1704413229045, "toLocaleTimeString", {"hour":"numeric","minute":"numeric","hour12":false}, "00:07"],
  [1704413229045, "toLocaleTimeString", {"hour":"numeric","hour12":false}, "00"],
  [1704413229045, "toLocaleTimeString", {"hour":"numeric","minute":"numeric","second":"numeric","hour12":false}, "00:07:09"],
  [1704413229045, "toLocaleTimeString", {"hour":"numeric","minute":"numeric","second":"numeric","fractionalSecondDigits":3}, "12:07:09.045 AM"],
  [1704413229045, "toLocaleTimeString", {"second":"numeric","fractionalSecondDigits":2}, "9.04"],
  [1704413229045, "toLocaleTimeString", {"timeZoneName":"short"}, "12:07:09 AM UTC"],
  [1704413229045, "toLocaleTimeString", {"timeZoneName":"long"}, "12:07:09 AM Coordinated Universal Time"],
  [1704413229045, "toLocaleTimeString", {"hour":"numeric","timeZoneName":"short"}, "12 AM UTC"],
  [1704413229045, "toLocaleString", {"year":"numeric","month":"long","day":"numeric","hour":"numeric","minute":"numeric"}, "January 5, 2024 at 12:07 AM"],
  [1704413229045, "toLocaleString", {"month":"short","day":"numeric","hour":"numeric","minute":"2-digit"}, "Jan 5, 12:07 AM"],
  [1704413229045, "toLocaleString", {"year":"numeric","month":"numeric","day":"numeric","hour":"numeric"}, "1/5/2024, 12 AM"],
  [1704413229045, "toLocaleString", {"weekday":"long","hour":"numeric","minute":"numeric"}, "Friday 12:07 AM"],
  [1704413229045, "toLocaleString", {"weekday":"short","month":"short","day":"numeric","hour":"numeric","minute":"2-digit"}, "Fri, Jan 5, 12:07 AM"],
  [1704413229045, "toLocaleString", {"month":"2-digit","day":"2-digit"}, "01/05"],
  [1704413229045, "toLocaleString", {"hour":"numeric"}, "12 AM"],
  [1704413229045, "toLocaleDateString", {"hour":"numeric"}, "1/5/2024, 12 AM"],
  [1704413229045, "toLocaleDateString", {"weekday":"long","hour":"numeric","minute":"numeric"}, "Friday 12:07 AM"],
  [1704413229045, "toLocaleTimeString", {"year":"numeric"}, "2024, 12:07:09 AM"],
  [1704413229045, "toLocaleString", {"hour12":true,"hour":"numeric","minute":"numeric","hourCycle":"h23"}, "12:07 AM"],
  [1704413229045, "toLocaleString", {"hour":"2-digit","hour12":true}, "12 AM"],
  [1704413229045, "toLocaleString", {"timeZoneName":"short"}, "1/5/2024, 12:07:09 AM UTC"],
  [1703516645006, "toLocaleString", {}, "12/25/2023, 3:04:05 PM"],
  [1703516645006, "toLocaleDateString", {}, "12/25/2023"],
  [1703516645006, "toLocaleTimeString", {}, "3:04:05 PM"],
  [1703516645006, "toLocaleString", {"hour12":false}, "12/25/2023, 15:04:05"],
  [1703516645006, "toLocaleTimeString", {"hour12":false}, "15:04:05"],
  [1703516645006, "toLocaleTimeString", {"hourCycle":"h23"}, "15:04:05"],
  [1703516645006, "toLocaleTimeString", {"hourCycle":"h24"}, "15:04:05"],
  [1703516645006, "toLocaleString", {"dateStyle":"full"}, "Monday, December 25, 2023"],
  [1703516645006, "toLocaleString", {"dateStyle":"long"}, "December 25, 2023"],
  [1703516645006, "toLocaleString", {"dateStyle":"medium"}, "Dec 25, 2023"],
  [1703516645006, "toLocaleString", {"dateStyle":"short"}, "12/25/23"],
  [1703516645006, "toLocaleString", {"timeStyle":"long"}, "3:04:05 PM UTC"],
  [1703516645006, "toLocaleString", {"timeStyle":"medium"}, "3:04:05 PM"],
  [1703516645006, "toLocaleString", {"timeStyle":"short"}, "3:04 PM"],
  [1703516645006, "toLocaleString", {"dateStyle":"medium","timeStyle":"short"}, "Dec 25, 2023, 3:04 PM"],
  [1703516645006, "toLocaleString", {"dateStyle":"full","timeStyle":"long"}, "Monday, December 25, 2023 at 3:04:05 PM UTC"],
  [1703516645006, "toLocaleDateString", {"dateStyle":"long"}, "December 25, 2023"],
  [1703516645006, "toLocaleTimeString", {"timeStyle":"short"}, "3:04 PM"],
  [1703516645006, "toLocaleDateString", {"year":"numeric","month":"long","day":"numeric"}, "December 25, 2023"],
  [1703516645006, "toLocaleDateString", {"weekday":"long","year":"numeric","month":"long","day":"numeric"}, "Monday, December 25, 2023"],
  [1703516645006, "toLocaleDateString", {"weekday":"short","year":"numeric","month":"short","day":"numeric"}, "Mon, Dec 25, 2023"],
  [1703516645006, "toLocaleDateString", {"month":"short","day":"numeric"}, "Dec 25"],
  [1703516645006, "toLocaleDateString", {"month":"long","year":"numeric"}, "December 2023"],
  [1703516645006, "toLocaleDateString", {"month":"long"}, "December"],
  [1703516645006, "toLocaleDateString", {"weekday":"long"}, "Monday"],
  [1703516645006, "toLocaleDateString", {"year":"2-digit","month":"2-digit","day":"2-digit"}, "12/25/23"],
  [1703516645006, "toLocaleDateString", {"month":"narrow"}, "D"],
  [1703516645006, "toLocaleDateString", {"weekday":"narrow"}, "M"],
  [1703516645006, "toLocaleDateString", {"year":"numeric"}, "2023"],
  [1703516645006, "toLocaleDateString", {"day":"numeric"}, "25"],
  [1703516645006, "toLocaleDateString", {"month":"numeric","day":"numeric"}, "12/25"],
  [1703516645006, "toLocaleDateString", {"year":"numeric","month":"numeric"}, "12/2023"],
  [1703516645006, "toLocaleDateString", {"weekday":"short","month":"numeric","day":"numeric","year":"numeric"}, "Mon, 12/25/2023"],
  [1703516645006, "toLocaleDateString", {"weekday":"long","month":"long","day":"numeric"}, "Monday, December 25"],
  [1703516645006, "toLocaleDateString", {"weekday":"long","day":"numeric"}, "25 Monday"],
  [1703516645006, "toLocaleDateString", {"weekday":"short","year":"numeric"}, "2023 Mon"],
  [1703516645006, "toLocaleDateString", {"weekday":"long","month":"long"}, "December Monday"],
  [1703516645006, "toLocaleDateString", {"month":"long","day":"2-digit"}, "December 25"],
  [1703516645006, "toLocaleDateString", {"year":"2-digit","month":"long"}, "December 23"],
  [1703516645006, "toLocaleDateString", {"year":"numeric","month":"short","day":"2-digit"}, "Dec 25, 2023"],
  [1703516645006, "toLocaleTimeString", {"hour":"numeric"}, "3 PM"],
  [1703516645006, "toLocaleTimeString", {"hour":"2-digit"}, "03 PM"],
  [1703516645006, "toLocaleTimeString", {"minute":"numeric"}, "4"],
  [1703516645006, "toLocaleTimeString", {"second":"numeric"}, "5"],
  [1703516645006, "toLocaleTimeString", {"hour":"numeric","minute":"numeric"}, "3:04 PM"],
  [1703516645006, "toLocaleTimeString", {"hour":"2-digit","minute":"2-digit"}, "03:04 PM"],
  [1703516645006, "toLocaleTimeString", {"minute":"2-digit","second":"2-digit"}, "04:05"],
  [1703516645006, "toLocaleTimeString", {"minute":"numeric","second":"numeric"}, "04:05"],
  [1703516645006, "toLocaleTimeString", {"hour":"numeric","minute":"numeric","hour12":false}, "15:04"],
  [1703516645006, "toLocaleTimeString", {"hour":"numeric","hour12":false}, "15"],
  [1703516645006, "toLocaleTimeString", {"hour":"numeric","minute":"numeric","second":"numeric","hour12":false}, "15:04:05"],
  [1703516645006, "toLocaleTimeString", {"hour":"numeric","minute":"numeric","second":"numeric","fractionalSecondDigits":3}, "3:04:05.006 PM"],
  [1703516645006, "toLocaleTimeString", {"second":"numeric","fractionalSecondDigits":2}, "5.00"],
  [1703516645006, "toLocaleTimeString", {"timeZoneName":"short"}, "3:04:05 PM UTC"],
  [1703516645006, "toLocaleTimeString", {"timeZoneName":"long"}, "3:04:05 PM Coordinated Universal Time"],
  [1703516645006, "toLocaleTimeString", {"hour":"numeric","timeZoneName":"short"}, "3 PM UTC"],
  [1703516645006, "toLocaleString", {"year":"numeric","month":"long","day":"numeric","hour":"numeric","minute":"numeric"}, "December 25, 2023 at 3:04 PM"],
  [1703516645006, "toLocaleString", {"month":"short","day":"numeric","hour":"numeric","minute":"2-digit"}, "Dec 25, 3:04 PM"],
  [1703516645006, "toLocaleString", {"year":"numeric","month":"numeric","day":"numeric","hour":"numeric"}, "12/25/2023, 3 PM"],
  [1703516645006, "toLocaleString", {"weekday":"long","hour":"numeric","minute":"numeric"}, "Monday 3:04 PM"],
  [1703516645006, "toLocaleString", {"weekday":"short","month":"short","day":"numeric","hour":"numeric","minute":"2-digit"}, "Mon, Dec 25, 3:04 PM"],
  [1703516645006, "toLocaleString", {"month":"2-digit","day":"2-digit"}, "12/25"],
  [1703516645006, "toLocaleString", {"hour":"numeric"}, "3 PM"],
  [1703516645006, "toLocaleDateString", {"hour":"numeric"}, "12/25/2023, 3 PM"],
  [1703516645006, "toLocaleDateString", {"weekday":"long","hour":"numeric","minute":"numeric"}, "Monday 3:04 PM"],
  [1703516645006, "toLocaleTimeString", {"year":"numeric"}, "2023, 3:04:05 PM"],
  [1703516645006, "toLocaleString", {"hour12":true,"hour":"numeric","minute":"numeric","hourCycle":"h23"}, "3:04 PM"],
  [1703516645006, "toLocaleString", {"hour":"2-digit","hour12":true}, "03 PM"],
  [1703516645006, "toLocaleString", {"timeZoneName":"short"}, "12/25/2023, 3:04:05 PM UTC"],
  [1625400000000, "toLocaleString", {}, "7/4/2021, 12:00:00 PM"],
  [1625400000000, "toLocaleDateString", {}, "7/4/2021"],
  [1625400000000, "toLocaleTimeString", {}, "12:00:00 PM"],
  [1625400000000, "toLocaleString", {"hour12":false}, "7/4/2021, 12:00:00"],
  [1625400000000, "toLocaleTimeString", {"hour12":false}, "12:00:00"],
  [1625400000000, "toLocaleTimeString", {"hourCycle":"h23"}, "12:00:00"],
  [1625400000000, "toLocaleTimeString", {"hourCycle":"h24"}, "12:00:00"],
  [1625400000000, "toLocaleString", {"dateStyle":"full"}, "Sunday, July 4, 2021"],
  [1625400000000, "toLocaleString", {"dateStyle":"long"}, "July 4, 2021"],
  [1625400000000, "toLocaleString", {"dateStyle":"medium"}, "Jul 4, 2021"],
  [1625400000000, "toLocaleString", {"dateStyle":"short"}, "7/4/21"],
  [1625400000000, "toLocaleString", {"timeStyle":"long"}, "12:00:00 PM UTC"],
  [1625400000000, "toLocaleString", {"timeStyle":"medium"}, "12:00:00 PM"],
  [1625400000000, "toLocaleString", {"timeStyle":"short"}, "12:00 PM"],
  [1625400000000, "toLocaleString", {"dateStyle":"medium","timeStyle":"short"}, "Jul 4, 2021, 12:00 PM"],
  [1625400000000, "toLocaleString", {"dateStyle":"full","timeStyle":"long"}, "Sunday, July 4, 2021 at 12:00:00 PM UTC"],
  [1625400000000, "toLocaleDateString", {"dateStyle":"long"}, "July 4, 2021"],
  [1625400000000, "toLocaleTimeString", {"timeStyle":"short"}, "12:00 PM"],
  [1625400000000, "toLocaleDateString", {"year":"numeric","month":"long","day":"numeric"}, "July 4, 2021"],
  [1625400000000, "toLocaleDateString", {"weekday":"long","year":"numeric","month":"long","day":"numeric"}, "Sunday, July 4, 2021"],
  [1625400000000, "toLocaleDateString", {"weekday":"short","year":"numeric","month":"short","day":"numeric"}, "Sun, Jul 4, 2021"],
  [1625400000000, "toLocaleDateString", {"month":"short","day":"numeric"}, "Jul 4"],
  [1625400000000, "toLocaleDateString", {"month":"long","year":"numeric"}, "July 2021"],
  [1625400000000, "toLocaleDateString", {"month":"long"}, "July"],
  [1625400000000, "toLocaleDateString", {"weekday":"long"}, "Sunday"],
  [1625400000000, "toLocaleDateString", {"year":"2-digit","month":"2-digit","day":"2-digit"}, "07/04/21"],
  [1625400000000, "toLocaleDateString", {"month":"narrow"}, "J"],
  [1625400000000, "toLocaleDateString", {"weekday":"narrow"}, "S"],
  [1625400000000, "toLocaleDateString", {"year":"numeric"}, "2021"],
  [1625400000000, "toLocaleDateString", {"day":"numeric"}, "4"],
  [1625400000000, "toLocaleDateString", {"month":"numeric","day":"numeric"}, "7/4"],
  [1625400000000, "toLocaleDateString", {"year":"numeric","month":"numeric"}, "7/2021"],
  [1625400000000, "toLocaleDateString", {"weekday":"short","month":"numeric","day":"numeric","year":"numeric"}, "Sun, 7/4/2021"],
  [1625400000000, "toLocaleDateString", {"weekday":"long","month":"long","day":"numeric"}, "Sunday, July 4"],
  [1625400000000, "toLocaleDateString", {"weekday":"long","day":"numeric"}, "4 Sunday"],
  [1625400000000, "toLocaleDateString", {"weekday":"short","year":"numeric"}, "2021 Sun"],
  [1625400000000, "toLocaleDateString", {"weekday":"long","month":"long"}, "July Sunday"],
  [1625400000000, "toLocaleDateString", {"month":"long","day":"2-digit"}, "July 04"],
  [1625400000000, "toLocaleDateString", {"year":"2-digit","month":"long"}, "July 21"],
  [1625400000000, "toLocaleDateString", {"year":"numeric","month":"short","day":"2-digit"}, "Jul 04, 2021"],
  [1625400000000, "toLocaleTimeString", {"hour":"numeric"}, "12 PM"],
  [1625400000000, "toLocaleTimeString", {"hour":"2-digit"}, "12 PM"],
  [1625400000000, "toLocaleTimeString", {"minute":"numeric"}, "0"],
  [1625400000000, "toLocaleTimeString", {"second":"numeric"}, "0"],
  [1625400000000, "toLocaleTimeString", {"hour":"numeric","minute":"numeric"}, "12:00 PM"],
  [1625400000000, "toLocaleTimeString", {"hour":"2-digit","minute":"2-digit"}, "12:00 PM"],
  [1625400000000, "toLocaleTimeString", {"minute":"2-digit","second":"2-digit"}, "00:00"],
  [1625400000000, "toLocaleTimeString", {"minute":"numeric","second":"numeric"}, "00:00"],
  [1625400000000, "toLocaleTimeString", {"hour":"numeric","minute":"numeric","hour12":false}, "12:00"],
  [1625400000000, "toLocaleTimeString", {"hour":"numeric","hour12":false}, "12"],
  [1625400000000, "toLocaleTimeString", {"hour":"numeric","minute":"numeric","second":"numeric","hour12":false}, "12:00:00"],
  [1625400000000, "toLocaleTimeString", {"hour":"numeric","minute":"numeric","second":"numeric","fractionalSecondDigits":3}, "12:00:00.000 PM"],
  [1625400000000, "toLocaleTimeString", {"second":"numeric","fractionalSecondDigits":2}, "0.00"],
  [1625400000000, "toLocaleTimeString", {"timeZoneName":"short"}, "12:00:00 PM UTC"],
  [1625400000000, "toLocaleTimeString", {"timeZoneName":"long"}, "12:00:00 PM Coordinated Universal Time"],
  [1625400000000, "toLocaleTimeString", {"hour":"numeric","timeZoneName":"short"}, "12 PM UTC"],
  [1625400000000, "toLocaleString", {"year":"numeric","month":"long","day":"numeric","hour":"numeric","minute":"numeric"}, "July 4, 2021 at 12:00 PM"],
  [1625400000000, "toLocaleString", {"month":"short","day":"numeric","hour":"numeric","minute":"2-digit"}, "Jul 4, 12:00 PM"],
  [1625400000000, "toLocaleString", {"year":"numeric","month":"numeric","day":"numeric","hour":"numeric"}, "7/4/2021, 12 PM"],
  [1625400000000, "toLocaleString", {"weekday":"long","hour":"numeric","minute":"numeric"}, "Sunday 12:00 PM"],
  [1625400000000, "toLocaleString", {"weekday":"short","month":"short","day":"numeric","hour":"numeric","minute":"2-digit"}, "Sun, Jul 4, 12:00 PM"],
  [1625400000000, "toLocaleString", {"month":"2-digit","day":"2-digit"}, "07/04"],
  [1625400000000, "toLocaleString", {"hour":"numeric"}, "12 PM"],
  [1625400000000, "toLocaleDateString", {"hour":"numeric"}, "7/4/2021, 12 PM"],
  [1625400000000, "toLocaleDateString", {"weekday":"long","hour":"numeric","minute":"numeric"}, "Sunday 12:00 PM"],
  [1625400000000, "toLocaleTimeString", {"year":"numeric"}, "2021, 12:00:00 PM"],
  [1625400000000, "toLocaleString", {"hour12":true,"hour":"numeric","minute":"numeric","hourCycle":"h23"}, "12:00 PM"],
  [1625400000000, "toLocaleString", {"hour":"2-digit","hour12":true}, "12 PM"],
  [1625400000000, "toLocaleString", {"timeZoneName":"short"}, "7/4/2021, 12:00:00 PM UTC"],
];

describe("Date toLocaleString, toLocaleDateString and toLocaleTimeString", () => {
  test("write dates and times the way en-US does, for every option set in the table", async () => {
    const lines = CASES.map(
      ([time, method, options]) =>
        `try { out.push(new Date(${time}).${method}("en-US", { timeZone: "UTC", ...${JSON.stringify(options)} })) } catch (e) { out.push("error: " + e.message) }`,
    );
    const result = await wide.execute(`const out = [];\n${lines.join("\n")}\nreturn JSON.stringify(out)`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const got: string[] = JSON.parse(result.result);
    const wrong = CASES.flatMap(([time, method, options, expected], i) =>
      got[i] === expected ? [] : [`${time} ${method} ${JSON.stringify(options)}: got ${JSON.stringify(got[i])}, want ${JSON.stringify(expected)}`],
    );

    expect(wrong).toEqual([]);
  });

  test("with no locale they write en-US", async () => {
    expect(await value(`return new Date(Date.UTC(2024, 0, 5, 13, 7, 9)).toLocaleString(undefined, { timeZone: "UTC" })`)).toBe(
      "1/5/2024, 1:07:09 PM",
    );
    expect(await value(`return new Date(Date.UTC(2024, 0, 5, 13, 7, 9)).toLocaleDateString("en", { timeZone: "UTC" })`)).toBe("1/5/2024");
    expect(await value(`return new Date(Date.UTC(2024, 0, 5, 13, 7, 9)).toLocaleTimeString(["en-US"], { timeZone: "UTC" })`)).toBe(
      "1:07:09 PM",
    );
  });

  test("use the local time when no time zone is given", async () => {
    expect(await value(`return new Date(2024, 0, 5, 13, 7, 9).toLocaleString()`)).toBe("1/5/2024, 1:07:09 PM");
    expect(await value(`return new Date(2024, 0, 5, 13, 7, 9).toLocaleDateString()`)).toBe("1/5/2024");
    expect(await value(`return new Date(2024, 0, 5, 0, 7, 9).toLocaleTimeString()`)).toBe("12:07:09 AM");
    expect(
      await value(`return new Date(2024, 6, 4, 9, 5).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })`),
    ).toBe("Thursday, July 4");
  });

  test("know the time zone UTC under its other names", async () => {
    for (const zone of ["UTC", "utc", "GMT", "Etc/UTC", "Etc/GMT"]) {
      expect(await value(`return new Date(Date.UTC(2024, 0, 5, 23, 30)).toLocaleDateString("en-US", { timeZone: ${JSON.stringify(zone)}, day: "numeric" })`)).toBe(
        "5",
      );
    }
  });

  test("write an invalid date as Invalid Date", async () => {
    expect(await value(`return new Date(NaN).toLocaleString("en-US", { month: "long" })`)).toBe("Invalid Date");
  });

  test("refuse a value an option does not take, as a browser does", async () => {
    expect(await value(`new Date(0).toLocaleDateString("en-US", { month: "bad" })`)).toMatch(/^error: RangeError: .*month/);
    expect(await value(`new Date(0).toLocaleTimeString("en-US", { hour12: false, hourCycle: "h9" })`)).toMatch(/^error: RangeError: .*hourCycle/);
  });

  test("refuse a style mixed with single fields, or one that does not fit the method", async () => {
    expect(await value(`new Date(0).toLocaleString("en-US", { dateStyle: "full", year: "numeric" })`)).toMatch(/^error: TypeError/);
    expect(await value(`new Date(0).toLocaleTimeString("en-US", { dateStyle: "full" })`)).toMatch(/^error: TypeError/);
    expect(await value(`new Date(0).toLocaleDateString("en-US", { timeStyle: "short" })`)).toMatch(/^error: TypeError/);
  });

  test("leave what they cannot do to the engine, as before", async () => {
    // another language, another time zone, era, and a zone name for local time
    for (const call of [
      `new Date(0).toLocaleDateString("de-DE")`,
      `new Date(0).toLocaleDateString("en-US", { timeZone: "America/New_York" })`,
      `new Date(0).toLocaleDateString("en-US", { era: "short" })`,
      `new Date(0).toLocaleTimeString("en-US", { timeZoneName: "short" })`,
      `new Date(0).toLocaleTimeString("en-US", { hourCycle: "h11" })`,
    ]) {
      expect(await value(`return typeof ${call}`)).toBe("string");
    }
  });

  test("keep their length and name, and are not enumerable", async () => {
    expect(
      await value(`
        return ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"]
          .map((name) => [Date.prototype[name].name, Date.prototype[name].length, Object.keys(Date.prototype).includes(name)].join())
          .join(" ");
      `),
    ).toBe("toLocaleString,0,false toLocaleDateString,0,false toLocaleTimeString,0,false");
  });

  test("throw on something that is not a date", async () => {
    expect(await value(`Date.prototype.toLocaleString.call({}, "en-US")`)).toMatch(/^error: TypeError/);
  });
});

describe("Intl.DateTimeFormat", () => {
  test("formats the date part by default, and takes the options of toLocaleString", async () => {
    expect(
      await value(`
        const when = Date.UTC(2024, 0, 5, 13, 7, 9);
        return [
          new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).format(when),
          new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric" }).format(when),
          new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric" }).format(new Date(when)),
          Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(when),
        ].join(" | ");
      `),
    ).toBe("1/5/2024 | 1 PM | January 5 | Jan 5, 2024, 1:07 PM");
  });

  test("has a format that works detached, and one for now when it is given nothing", async () => {
    expect(
      await value(`
        const format = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric" }).format;
        return [[Date.UTC(2020, 5, 1), Date.UTC(2021, 5, 1)].map(format).join(), /^\\d+$/.test(format())].join();
      `),
    ).toBe("2020,2021,true");
  });

  test("refuses a time that is not one, as format of a browser does", async () => {
    expect(await value(`new Intl.DateTimeFormat("en-US").format(NaN)`)).toMatch(/^error: RangeError/);
    expect(await value(`new Intl.DateTimeFormat("en-US").format(new Date(NaN))`)).toMatch(/^error: RangeError/);
  });

  test("checks its options when it is made", async () => {
    expect(await value(`new Intl.DateTimeFormat("en-US", { month: "bad" })`)).toMatch(/^error: RangeError/);
  });
});
