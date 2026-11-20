import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

async function run(script: string, args: string[]) {
  const child = Bun.spawn([process.execPath, "run", `scripts/${script}`, ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code: await child.exited, output: out + err };
}

describe("the options of the benchmark and the soak test", () => {
  test("bench refuses a run count that is not a whole number of at least one", async () => {
    for (const value of ["abc", "0", "2.5"]) {
      const result = await run("bench.ts", [`--runs=${value}`]);

      expect(result.code).toBe(2);
      expect(result.output).toContain(`--runs must be a whole number of at least 1, not "${value}"`);
      expect(result.output).not.toContain("    at ");
    }
  });

  test("soak refuses a count of zero where it needs one", async () => {
    const result = await run("soak.ts", ["--starts=0"]);

    expect(result.code).toBe(2);
    expect(result.output).toContain('--starts must be a whole number of at least 1, not "0"');
  });

  test("soak refuses a negative limit and a fractional latency", async () => {
    const limit = await run("soak.ts", ["--limit=-1"]);
    expect(limit.code).toBe(2);
    expect(limit.output).toContain('--limit must be a whole number of at least 0, not "-1"');

    const latency = await run("soak.ts", ["--latency=0.5"]);
    expect(latency.code).toBe(2);
    expect(latency.output).toContain('--latency must be a whole number of at least 0, not "0.5"');
  });
});
