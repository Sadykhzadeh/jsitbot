// Compares the console output of the sandbox with real Node for every snippet
// in scripts/node-diff/corpus. It needs a local Node 26 (the oracle), named by
// the NODE26 environment variable; nothing here runs in the test suite.
//
// Usage: NODE26=/path/to/node26 bun run compat [--verbose]
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { QuickJsSandboxService } from "../../src/services/sandbox/quickjsSandbox";

const here = import.meta.dir;
const corpusDir = join(here, "corpus");
const oracle = join(here, "node-oracle.mjs");
for (const unknown of process.argv.slice(2)) {
  if (unknown !== "--verbose") {
    console.error(`Unknown argument "${unknown}". The only option is --verbose`);
    process.exit(2);
  }
}
const verbose = process.argv.includes("--verbose");

// On Windows, a Node that lives in WSL is named as wsl:<path inside WSL>, and
// the paths handed to it are converted to /mnt/... form.
const setting = process.env.NODE26;
if (!setting) {
  console.error("Set NODE26 to a Node 26 binary, for example NODE26=$HOME/.nvm/versions/node/v26.13.0/bin/node, or wsl:<that path> on Windows");
  process.exit(2);
}
const inWsl = setting.startsWith("wsl:");
const nodeCommand = inWsl ? ["wsl", "-e", setting.slice("wsl:".length)] : [setting];
const toNodePath = (path: string) => (inWsl ? path.replace(/^([A-Za-z]):/, (_, drive: string) => `/mnt/${drive.toLowerCase()}`).replace(/\\/g, "/") : path);

function nodeVersion(): string | undefined {
  try {
    const probe = Bun.spawnSync([...nodeCommand, "-p", "process.versions.node"]);
    const printed = probe.stdout.toString().trim();
    return probe.exitCode === 0 && printed !== "" ? printed : undefined;
  } catch {
    return undefined;
  }
}

const version = nodeVersion();
if (version === undefined) {
  console.error(`NODE26 is not a Node binary that runs: ${setting}`);
  process.exit(2);
}
if (!version.startsWith("26.")) {
  console.error(`NODE26 points to Node ${version}; the comparison is for Node 26.`);
  process.exit(2);
}

function readSnippets(path: string): string[] {
  return readFileSync(path, "utf8")
    .split(/\n---8<---\n/)
    .map((snippet) => snippet.replace(/\n$/, ""));
}

type Record = { logs: string[]; error: string | null };

const workDir = mkdtempSync(join(tmpdir(), "node-diff-"));
const sandbox = new QuickJsSandboxService();
const totals = { snippets: 0, exact: 0 };
const rows: string[] = [];
const summaries: string[] = [];

try {
  for (const file of readdirSync(corpusDir).filter((name) => name.endsWith(".txt")).sort()) {
    const corpus = join(corpusDir, file);
    const nodeOut = join(workDir, `${file}.node.json`);
    const run = Bun.spawnSync([...nodeCommand, "--no-warnings", toNodePath(oracle), toNodePath(resolve(corpus)), toNodePath(nodeOut)], {
      stdout: "inherit",
      stderr: "inherit",
    });
    if (run.exitCode !== 0) {
      console.error(`${file}: the Node run failed`);
      // process.exit skips the finally block below, so the work directory goes here.
      rmSync(workDir, { recursive: true, force: true });
      process.exit(1);
    }
    const expected: Record[] = JSON.parse(readFileSync(nodeOut, "utf8"));

    const snippets = readSnippets(corpus);
    let exact = 0;
    for (let i = 0; i < snippets.length; i++) {
      const execution = await sandbox.execute(snippets[i]);
      const got = execution.logs.join("\n");
      const want = expected[i].logs.join("\n");
      if (got === want) {
        exact++;
        continue;
      }
      if (verbose) {
        rows.push(`---- ${file} #${i} ${JSON.stringify(snippets[i])}`);
        rows.push(`node:    ${JSON.stringify(want)}${expected[i].error ? "  error " + expected[i].error : ""}`);
        rows.push(`sandbox: ${JSON.stringify(got)}${execution.ok ? "" : "  error " + execution.error}`);
      }
    }
    totals.snippets += snippets.length;
    totals.exact += exact;
    summaries.push(`${file.padEnd(16)} ${String(exact).padStart(4)} / ${snippets.length} exact`);
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

console.log(`Node ${version}, sandbox of this checkout`);
console.log(summaries.join("\n"));
if (verbose) console.log(rows.join("\n"));
console.log(`total ${totals.exact} / ${totals.snippets} exact (${((100 * totals.exact) / totals.snippets).toFixed(1)}%)`);
