import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

async function runCompat(nodePath: string | undefined, temp?: string) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "NODE26" && key !== "TMPDIR") {
      env[key] = value;
    }
  }
  if (nodePath !== undefined) {
    env.NODE26 = nodePath;
  }
  if (temp !== undefined) {
    env.TMPDIR = temp;
  }

  const run = Bun.spawn([process.execPath, "run", "scripts/node-diff/run.ts"], {
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text()]);
  return { code: await run.exited, output: out + err };
}

describe("the Node comparison script", () => {
  test("asks for NODE26 when it is not set", async () => {
    const run = await runCompat(undefined);

    expect(run.code).toBe(2);
    expect(run.output).toContain("Set NODE26 to a Node 26 binary");
  });

  test("says in one line when NODE26 is not a binary that runs", async () => {
    const missing = `${root}does-not-exist/node`;
    const run = await runCompat(missing);

    expect(run.code).toBe(2);
    expect(run.output.trim().split("\n")).toHaveLength(1);
    expect(run.output).toContain(`NODE26 is not a Node binary that runs: ${missing}`);
    expect(run.output).not.toContain("    at ");
  });

  test.skipIf(process.platform === "win32")("removes its work directory when the Node run fails", async () => {
    const temp = mkdtempSync(join(tmpdir(), "compat-test-"));
    try {
      // Reports version 26 to the version probe, then fails every run.
      const fake = join(temp, "node26");
      writeFileSync(fake, '#!/bin/sh\nif [ "$1" = "-p" ]; then echo 26.13.0; exit 0; fi\nexit 3\n');
      chmodSync(fake, 0o755);
      const scratch = join(temp, "tmp");
      mkdirSync(scratch);

      const run = await runCompat(fake, scratch);

      expect(run.code).toBe(1);
      expect(run.output).toContain("basic.txt: the Node run failed");
      expect(readdirSync(scratch)).toEqual([]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
