// Runs every snippet of a corpus file in Node and records what console.log
// wrote for it, as JSON. Errors are recorded too, so a snippet that throws
// is not mistaken for one that printed nothing.
//
// Usage: node node-oracle.mjs <corpus file> <output file>
// The sandbox prints without stack frames, so the snippets run with
// Error.stackTraceLimit set to 0, and with util.inspect at depth 3, which is
// the depth the sandbox shows.
import { readFileSync, writeFileSync } from "node:fs";
import { Console } from "node:console";
import { Writable } from "node:stream";
import vm from "node:vm";

const [corpusPath, outPath] = process.argv.slice(2);
if (!corpusPath || !outPath) {
  console.error("usage: node node-oracle.mjs <corpus file> <output file>");
  process.exit(2);
}

const snippets = readFileSync(corpusPath, "utf8")
  .split(/\n---8<---\n/)
  .map((snippet) => snippet.replace(/\n$/, ""));

const results = [];
for (const code of snippets) {
  const chunks = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const console = new Console({ stdout: sink, stderr: sink, inspectOptions: { depth: 3 } });
  const context = vm.createContext({ console, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval });
  vm.runInContext("globalThis.global = globalThis; Error.stackTraceLimit = 0;", context);

  let error = null;
  try {
    const run = vm.runInContext(`(async () => {\n${code}\n})`, context, { timeout: 2000 });
    await run();
  } catch (thrown) {
    error = thrown && thrown.name ? `${thrown.name}: ${thrown.message}` : String(thrown);
  }
  await new Promise((resolve) => setImmediate(resolve));
  results.push({ logs: chunks.map((chunk) => chunk.replace(/\n$/, "")), error });
}

writeFileSync(outPath, JSON.stringify(results));
