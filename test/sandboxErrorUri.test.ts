import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

// Programs that throw from the URI functions, and the error Node 26.13.0 printed for each.
// Node words every URIError the same way, whichever function and whatever the text.
const CASES: Array<[string, string]> = [
  ['decodeURIComponent("%")', "URIError: URI malformed"],
  ['decodeURI("%E0%A4%A")', "URIError: URI malformed"],
  ['encodeURIComponent("\uD800")', "URIError: URI malformed"],
];

describe("the URI functions, as Node words their errors", () => {
  test("prints URI malformed for a bad escape and a lone surrogate", async () => {
    for (const [code, expected] of CASES) {
      const result = await sandbox.execute(code);
      expect(result.ok ? "OK" : result.error, code).toBe(expected);
    }
  });
});
