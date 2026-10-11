// Measures what a message costs before it reaches Telegram: how long the
// sandbox takes to come up, how long the first run takes, and how long a run
// takes once it is warm. Usage: bun run bench
import { createSandbox } from "../src/services/sandbox/createSandbox";

const PROGRAMS: Array<[string, string]> = [
  ["expression", "1 + 1"],
  ["script with console", `const xs = [1, 2, 3, 4, 5].map((x) => x * x); console.log(xs); xs.reduce((a, b) => a + b, 0)`],
  ["object result", `({ name: "Ada", tags: ["a", "b"], nested: { ok: true } })`],
  ["runtime error", `const user = null;\nuser.name`],
];
const RUNS = 200;
const GAP_MS = 20;

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const rssMb = () => Math.round(process.memoryUsage.rss() / 1024 / 1024);

const startedAt = performance.now();
const sandbox = await createSandbox({});
const readyMs = performance.now() - startedAt;

const firstStartedAt = performance.now();
await sandbox.execute("1 + 1");
const firstMs = performance.now() - firstStartedAt;

console.log(`sandbox ready in ${readyMs.toFixed(0)} ms, first run ${firstMs.toFixed(1)} ms, rss ${rssMb()} MB`);
console.log(`warm runs (${RUNS} each, ${GAP_MS} ms apart, as messages arrive):`);

for (const [name, code] of PROGRAMS) {
  const samples: number[] = [];

  for (let run = 0; run < RUNS; run++) {
    const runStartedAt = performance.now();
    await sandbox.execute(code);
    samples.push(performance.now() - runStartedAt);
    await new Promise((resolve) => setTimeout(resolve, GAP_MS));
  }

  samples.sort((a, b) => a - b);
  console.log(
    `  ${name.padEnd(20)} p50 ${percentile(samples, 50).toFixed(2)} ms   p95 ${percentile(samples, 95).toFixed(2)} ms`,
  );
}

const hostileStartedAt = performance.now();
await sandbox.execute(`new Array(2 ** 28).join("ab").length`);
console.log(`a native loop that ignores the timeout is cut off after ${(performance.now() - hostileStartedAt).toFixed(0)} ms`);
console.log(`rss ${rssMb()} MB`);

await sandbox.dispose?.();
process.exit(0);
