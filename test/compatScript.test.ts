import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

async function runCompat(nodePath: string | undefined) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "NODE26") {
      env[key] = value;
    }
  }
  if (nodePath !== undefined) {
    env.NODE26 = nodePath;
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
});
