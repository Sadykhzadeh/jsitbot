import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const CHILD = fileURLToPath(new URL("./helpers/crashChild.ts", import.meta.url));
const SECRET = "123456789:AAHsecretValue0123456789abcdefghijk";

async function crash(mode: "throw" | "reject") {
  const child = Bun.spawn([process.execPath, CHILD, mode, SECRET], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code: await child.exited, output: out + err };
}

describe.each(["throw", "reject"] as const)("an error nobody handled (%s)", (mode) => {
  test("ends the process with status 1 and one line that does not carry the token", async () => {
    const run = await crash(mode);
    const lines = run.output.trim().split("\n");

    expect(run.code).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith("Crashed: FetchError: request to https://api.telegram.org/bot<token>/getUpdates failed")).toBe(
      true,
    );
    expect(run.output).not.toContain(SECRET);
    expect(run.output).not.toContain("Bun v");
  });
});
