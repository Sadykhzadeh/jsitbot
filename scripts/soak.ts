// Starts the real bot (src/index.ts) against a fake Telegram API and measures
// what an operator cares about: how long it takes to come up, how much memory
// the bot and its sandbox process hold idle and after a burst of messages, and
// how long it takes to answer the burst.
//
// Usage: bun run soak [--starts=7] [--messages=300] [--latency=30] [--limit=30] [--users=60]
import { startFakeTelegram, type FakeTelegram } from "./fakeTelegram";

function option(name: string, fallback: number): number {
  const argument = process.argv.find((a) => a.startsWith(`--${name}=`));
  return argument ? Number(argument.slice(name.length + 3)) : fallback;
}

const STARTS = option("starts", 7);
const MESSAGES = option("messages", 300);
const LATENCY_MS = option("latency", 30);
// 0 for no limit; Telegram allows a bot about 30 messages per second.
const SENDS_PER_SECOND = option("limit", 0);
const USERS = option("users", 60);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function residentMb(pid: number): number {
  if (process.platform === "win32") {
    const out = Bun.spawnSync(["tasklist", "/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"]).stdout.toString();
    const kilobytes = out.match(/"([\d,.]+) K"\s*$/m)?.[1];
    return kilobytes ? Number(kilobytes.replace(/[,.]/g, "")) / 1024 : 0;
  }
  const out = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(pid)]).stdout.toString().trim();
  return out ? Number(out) / 1024 : 0;
}

function childPids(pid: number): number[] {
  const out =
    process.platform === "win32"
      ? Bun.spawnSync([
          "powershell",
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}").ProcessId`,
        ]).stdout.toString()
      : Bun.spawnSync(["pgrep", "-P", String(pid)]).stdout.toString();
  return out
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
}

/** Memory of the bot and of the sandbox process it started, in MB. */
function memory(pid: number): { bot: number; sandbox: number } {
  const sandbox = childPids(pid).reduce((sum, child) => sum + residentMb(child), 0);
  return { bot: residentMb(pid), sandbox };
}

interface Started {
  process: Bun.Subprocess<"ignore", "pipe", "pipe">;
  startupMs: number;
}

/** Lines the bot wrote to stderr, which a run prints a count of rather than all of. */
let stderrLines = 0;
const stderrSample: string[] = [];

async function collectStderr(stream: ReadableStream<Uint8Array>): Promise<void> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      stderrLines++;
      if (stderrSample.length < 3 && line.trim()) {
        stderrSample.push(line.slice(0, 200));
      }
    }
  }
}

async function startBot(telegram: FakeTelegram): Promise<Started> {
  const spawnedAt = performance.now();
  const bot = Bun.spawn(
    [process.execPath, "--preload", "./scripts/useFakeTelegram.ts", "src/index.ts"],
    {
      env: { ...process.env, BOT_TOKEN: "123456:fake-token", FAKE_TELEGRAM: telegram.url },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  void collectStderr(bot.stderr);

  const reader = bot.stdout.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  while (!seen.includes("Bot started")) {
    const chunk = await reader.read();
    if (chunk.done) {
      throw new Error(`The bot exited before it started:\n${seen}`);
    }
    seen += decoder.decode(chunk.value);
  }
  reader.releaseLock();

  return { process: bot, startupMs: performance.now() - spawnedAt };
}

function message(updateId: number, userId: number): any {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: userId, type: "private", first_name: "u" },
      from: { id: userId, is_bot: false, first_name: "u" },
      text: `${updateId} + 1`,
    },
  };
}


const telegram = startFakeTelegram({ latencyMs: LATENCY_MS, sendsPerSecond: SENDS_PER_SECOND });
console.log(
  `bun ${Bun.version}, ${process.platform}, fake Telegram: ${LATENCY_MS} ms per call` +
    (SENDS_PER_SECOND ? `, 429 above ${SENDS_PER_SECOND} sends per second` : ""),
);

const startups: number[] = [];
for (let start = 0; start < STARTS; start++) {
  const { process: bot, startupMs } = await startBot(telegram);
  startups.push(startupMs);
  bot.kill();
  await bot.exited;
}
console.log(
  `start to "Bot started": median ${median(startups).toFixed(0)} ms, min ${Math.min(...startups).toFixed(0)}, max ${Math.max(...startups).toFixed(0)} (${STARTS} starts)`,
);

const { process: bot } = await startBot(telegram);
await sleep(1500);
const idle = memory(bot.pid);
console.log(`idle: bot ${idle.bot.toFixed(0)} MB, sandbox process ${idle.sandbox.toFixed(0)} MB`);

const sends = () => telegram.calls.get("sendMessage") ?? 0;
const deliveredBefore = sends() - telegram.refused.count;
const refusedBefore = telegram.refused.count;
const delivered = () => sends() - telegram.refused.count - deliveredBefore;

const burstStartedAt = performance.now();
for (let n = 0; n < MESSAGES; n++) {
  telegram.push(message(1_000_000 + n, 1_000 + (n % USERS)));
}
// The burst is over when everything has been answered, or nothing has happened for a while.
let lastCount = -1;
let lastChange = performance.now();
let doneAt = burstStartedAt;
while (delivered() < MESSAGES && performance.now() - lastChange < 4_000) {
  await sleep(50);
  const total = sends();
  if (total !== lastCount) {
    lastCount = total;
    lastChange = performance.now();
    doneAt = lastChange;
  }
}
const burstMs = doneAt - burstStartedAt;
console.log(
  `burst of ${MESSAGES} messages from ${USERS} users: ${delivered()} answered, ${telegram.refused.count - refusedBefore} sends refused with 429, last send after ${burstMs.toFixed(0)} ms`,
);

await sleep(1000);
const after = memory(bot.pid);
console.log(`after the burst: bot ${after.bot.toFixed(0)} MB, sandbox process ${after.sandbox.toFixed(0)} MB`);

if (stderrLines > 0) {
  console.log(`the bot wrote ${stderrLines} lines to stderr, for example:\n  ${stderrSample.join("\n  ")}`);
}

bot.kill();
await bot.exited;
telegram.stop();
