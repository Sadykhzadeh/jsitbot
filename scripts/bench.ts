// Measures what a message costs before it reaches Telegram: how long the
// sandbox takes to come up, how long a run takes from the moment the snippet
// is handed over to the moment the result is back, how many runs it gets
// through when they arrive together, what the child process costs in memory
// and CPU, and how fast a runaway run is stopped.
//
// Usage: bun run bench [--runs=150]
import { createSandbox } from "../src/services/sandbox/createSandbox";
import { ProcessSandboxService } from "../src/services/sandbox/processSandbox";
import type { SandboxService } from "../src/services/sandbox/types";

const PROGRAMS: Array<[string, string]> = [
  ["trivial", "1 + 1"],
  ["console + reduce", `const xs = [1, 2, 3, 4, 5].map((x) => x * x); console.log(xs); xs.reduce((a, b) => a + b, 0)`],
  ["object result", `({ name: "Ada", tags: ["a", "b"], nested: { ok: true } })`],
  ["runtime error", `const user = null;\nuser.name`],
  ["loop", `let total = 0; for (let i = 0; i < 200000; i++) total += i % 7; total`],
  ["string work", `"the quick brown fox ".repeat(40).split(" ").map((w) => w.toUpperCase().padEnd(8, ".")).join("|").length`],
  ["json", `const doc = { items: Array.from({ length: 200 }, (_, i) => ({ id: i, tag: "t" + i })) }; JSON.parse(JSON.stringify(doc)).items.length`],
  ["array methods", `Array.from({ length: 2000 }, (_, i) => i).filter((n) => n % 3 === 0).map((n) => n * 2).sort((a, b) => b - a).slice(0, 5)`],
  ["classes", `class Shape { constructor(n) { this.n = n } area() { return 0 } }\nclass Square extends Shape { area() { return this.n ** 2 } }\nnew Square(4).area()`],
  ["async/await", `const wait = (v) => new Promise((r) => r(v)); const a = await wait(1); const b = await Promise.all([wait(2), wait(3)]); a + b[0] + b[1]`],
  ["timers", `await new Promise((r) => setTimeout(r, 1000)); setTimeout(() => console.log("late"), 50); "done"`],
  ["typescript", `interface Point { x: number; y: number }\nconst p: Point = { x: 1, y: 2 };\nconst len = (q: Point): number => Math.hypot(q.x, q.y);\nlen(p)`],
];

const argument = process.argv.find((a) => a.startsWith("--runs="));
const RUNS = argument ? Number(argument.slice("--runs=".length)) : 150;
const GAP_MS = 15;
const SOAK_RUNS = 1000;
const BURST = 200;

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const rssMb = () => Math.round(process.memoryUsage.rss() / 1024 / 1024);

function summary(samples: number[]): string {
  const sorted = [...samples].sort((a, b) => a - b);
  return `p50 ${percentile(sorted, 50).toFixed(2)} ms   p95 ${percentile(sorted, 95).toFixed(2)} ms`;
}

async function timed(sandbox: SandboxService, code: string): Promise<number> {
  const startedAt = performance.now();
  await sandbox.execute(code);
  return performance.now() - startedAt;
}

/** The child process of a ProcessSandboxService, for reading its memory and CPU. */
async function childProcess(sandbox: SandboxService): Promise<Bun.Subprocess | undefined> {
  if (!(sandbox instanceof ProcessSandboxService)) {
    return undefined;
  }
  const child = await (sandbox as unknown as { child?: Promise<{ process: Bun.Subprocess }> }).child;
  return child?.process;
}

/** Resident set of another process right now, in MB. */
function residentMb(pid: number): number | undefined {
  if (process.platform === "win32") {
    const out = Bun.spawnSync(["tasklist", "/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"]).stdout.toString();
    const kilobytes = out.match(/"([\d,.]+) K"\s*$/m)?.[1];
    return kilobytes ? Math.round(Number(kilobytes.replace(/[,.]/g, "")) / 1024) : undefined;
  }
  const out = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(pid)]).stdout.toString().trim();
  return out ? Math.round(Number(out) / 1024) : undefined;
}

const cpuMs = (process: Bun.Subprocess) => Number(process.resourceUsage()?.cpuTime.total ?? 0n) / 1000;

const startedAt = performance.now();
const sandbox = await createSandbox({});
const readyMs = performance.now() - startedAt;
console.log(`runtime: ${sandbox.constructor.name}, bun ${Bun.version}, ${process.platform}`);

const firstMs = await timed(sandbox, "1 + 1");
console.log(`sandbox ready in ${readyMs.toFixed(0)} ms, first run ${firstMs.toFixed(1)} ms, bot rss ${rssMb()} MB`);

console.log(`\nlatency per run, ${RUNS} runs each, ${GAP_MS} ms apart (as messages arrive):`);
for (const [name, code] of PROGRAMS) {
  const samples: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    samples.push(await timed(sandbox, code));
    await sleep(GAP_MS);
  }
  console.log(`  ${name.padEnd(18)} ${summary(samples)}`);
}

const backToBack: number[] = [];
for (let run = 0; run < RUNS; run++) {
  backToBack.push(await timed(sandbox, "1 + 1"));
}
console.log(`  ${"trivial, no gap".padEnd(18)} ${summary(backToBack)}`);

console.log(`\nthroughput, ${BURST} runs handed over at once:`);
for (const [name, code] of [PROGRAMS[0], PROGRAMS[1], PROGRAMS[7]]) {
  const burstStartedAt = performance.now();
  await Promise.all(Array.from({ length: BURST }, () => sandbox.execute(code)));
  const seconds = (performance.now() - burstStartedAt) / 1000;
  console.log(`  ${name.padEnd(18)} ${(BURST / seconds).toFixed(0)} runs/s`);
}

console.log(`\nchild process over ${SOAK_RUNS} runs of the programs above, mixed:`);
// Its own sandbox: the CPU time of a process can only be read once it has
// exited, so this run ends by killing the child. A sandbox that did nothing is
// measured the same way to get the cost of starting one, which is taken off.
const idle = await createSandbox({});
const idleChild = await childProcess(idle);
await idle.dispose?.();

const soak = await createSandbox({});
const child = await childProcess(soak);
if (child && idleChild) {
  const rssBefore = residentMb(child.pid);
  const checkpoints: string[] = [];
  for (let run = 1; run <= SOAK_RUNS; run++) {
    await soak.execute(PROGRAMS[run % PROGRAMS.length][1]);
    if (run % 250 === 0) {
      checkpoints.push(`${run}: ${residentMb(child.pid)} MB`);
    }
  }
  await soak.dispose?.();
  const peak = (child.resourceUsage()?.maxRSS ?? 0) / 1024;
  console.log(`  rss at start ${rssBefore} MB, then ${checkpoints.join(", ")}, peak ${peak.toFixed(0)} MB`);
  console.log(
    `  cpu per run ${((cpuMs(child) - cpuMs(idleChild)) / SOAK_RUNS).toFixed(2)} ms (child process, user + system; starting one costs ${cpuMs(idleChild).toFixed(0)} ms)`,
  );
} else {
  await soak.dispose?.();
  console.log("  (no child process: the sandbox runs inside the bot)");
}

console.log("\nwhere a run goes, inside the child (median of 100, a fresh instance each time):");
{
  const { createCappedModule } = await import("../src/services/sandbox/wasmHeap");
  const { guestRuntimeSource } = await import("../src/services/sandbox/executionWrapper");
  await createCappedModule(64 * 1024 * 1024);
  const instance: number[] = [];
  const runtimeAndContext: number[] = [];
  const guest: number[] = [];
  const evaluate: number[] = [];
  const teardown: number[] = [];

  for (let run = 0; run < 100; run++) {
    let mark = performance.now();
    const quickjs = await createCappedModule(64 * 1024 * 1024);
    instance.push(performance.now() - mark);

    mark = performance.now();
    const runtime = quickjs.newRuntime({ memoryLimitBytes: 64 * 1024 * 1024, maxStackSizeBytes: 512 * 1024 });
    const context = runtime.newContext();
    runtimeAndContext.push(performance.now() - mark);

    mark = performance.now();
    context.unwrapResult(context.evalCode(guestRuntimeSource, "guest.js")).dispose();
    guest.push(performance.now() - mark);

    mark = performance.now();
    context.unwrapResult(context.evalCode("1 + 1", "input.js")).dispose();
    evaluate.push(performance.now() - mark);

    mark = performance.now();
    context.dispose();
    runtime.dispose();
    teardown.push(performance.now() - mark);
  }

  const median = (samples: number[]) => [...samples].sort((a, b) => a - b)[samples.length >> 1].toFixed(2);
  console.log(`  instantiate wasm ${median(instance)} ms, runtime + context ${median(runtimeAndContext)} ms, guest runtime ${median(guest)} ms, evaluate ${median(evaluate)} ms, teardown ${median(teardown)} ms`);
}

console.log("\nrunaway code:");
const loopMs = await timed(sandbox, "while (true) {}");
const afterLoopMs = await timed(sandbox, "1 + 1");
console.log(`  while (true) {}                   stopped after ${loopMs.toFixed(0)} ms, next run ${afterLoopMs.toFixed(1)} ms`);
const nativeMs = await timed(sandbox, `new Array(2 ** 28).join("ab").length`);
const afterNativeMs = await timed(sandbox, "1 + 1");
console.log(`  native call that never returns    stopped after ${nativeMs.toFixed(0)} ms, next run ${afterNativeMs.toFixed(1)} ms`);
const bombMs = await timed(sandbox, `const kept = []; while (true) kept.push("x".repeat(1024 * 1024));`);
const afterBombMs = await timed(sandbox, "1 + 1");
console.log(`  memory bomb                       stopped after ${bombMs.toFixed(0)} ms, next run ${afterBombMs.toFixed(1)} ms`);
console.log(`\nbot rss ${rssMb()} MB`);

await sandbox.dispose?.();
process.exit(0);
