import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSandbox } from "../src/services/sandbox/createSandbox";
import { ProcessSandboxService, childCommand, childEnvironment } from "../src/services/sandbox/processSandbox";

const options = {
  timeoutMs: 300,
  memoryLimitBytes: 64 * 1024 * 1024,
};
const sandbox = new ProcessSandboxService(options);

afterAll(() => sandbox.dispose());

/** Longest stretch the event loop of this thread went without getting a turn. */
function watchEventLoop(): { stop(): number } {
  let longest = 0;
  let last = performance.now();
  const interval = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last - 5);
    last = now;
  }, 5);

  return {
    stop() {
      clearInterval(interval);
      // A stall that is still going on when we stop has not been counted yet.
      return Math.max(longest, performance.now() - last - 5);
    },
  };
}

describe("ProcessSandboxService", () => {
  test("runs code in the child process and returns the result with its logs", async () => {
    const result = await sandbox.execute(`
      console.log("from the child");
      return [1, 2, 3].map((n) => n * 2).join(",");
    `);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe("2,4,6");
      expect(result.logs).toEqual(["from the child"]);
    }
  });

  test("answers requests that arrive together, in order", async () => {
    const results = await Promise.all([
      sandbox.execute("1"),
      sandbox.execute("2"),
      sandbox.execute("3"),
      sandbox.execute("while (true) {}"),
      sandbox.execute("4"),
    ]);

    expect(results.map((r) => (r.ok ? r.result : r.error))).toEqual([
      "1",
      "2",
      "3",
      "Sandbox execution timed out.",
      "4",
    ]);
  });

  test("keeps the limits that hold in-process", async () => {
    const loop = await sandbox.execute("while (true) {}");
    expect(loop.ok).toBe(false);
    expect(loop.timedOut).toBe(true);

    const bomb = await sandbox.execute(`
      const kept = [];
      while (true) kept.push("x".repeat(1024 * 1024));
    `);
    expect(bomb.ok).toBe(false);
    if (!bomb.ok) {
      expect(bomb.error).toBe("Sandbox exceeded its memory limit.");
    }
  });

  test("does not freeze the bot while guest code spins", async () => {
    const watcher = watchEventLoop();
    const result = await sandbox.execute("while (true) {}");
    const longestStall = watcher.stop();

    expect(result.timedOut).toBe(true);
    expect(longestStall).toBeLessThan(150);
  });

  test("kills a native call that ignores the interrupt handler, then recovers", async () => {
    // One native loop of 2**28 iterations: QuickJS never gets a chance to
    // interrupt it, and on its own it holds the thread for several seconds.
    const watcher = watchEventLoop();
    const startedAt = performance.now();
    const result = await sandbox.execute(`new Array(2 ** 28).join("ab").length`);
    const wallMs = performance.now() - startedAt;
    const longestStall = watcher.stop();

    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    if (!result.ok) {
      expect(result.error).toBe("Sandbox execution timed out.");
    }
    expect(wallMs).toBeLessThan(1_500);
    expect(longestStall).toBeLessThan(150);

    const next = await sandbox.execute("21 * 2");
    expect(next.ok).toBe(true);
    if (next.ok) {
      expect(next.result).toBe("42");
    }
  });

  test("gives up on a stuck native call soon after the guest's clock ran out", async () => {
    // The child says when the guest's clock starts, so the wait after the
    // timeout is short. Waiting from the moment the run was sent took the
    // timeout plus 400 ms.
    const startedAt = performance.now();
    const result = await sandbox.execute(`new Array(2 ** 28).join("ab").length`);
    const wallMs = performance.now() - startedAt;

    expect(result.timedOut).toBe(true);
    expect(wallMs).toBeGreaterThanOrEqual(options.timeoutMs);
    expect(wallMs).toBeLessThan(options.timeoutMs + 300);
  });

  test("a killed run does not eat into the budget of the next one", async () => {
    const killed = sandbox.execute(`new Array(2 ** 28).join("ab").length`);
    const next = sandbox.execute(`
      let total = 0;
      for (let i = 0; i < 200000; i++) total += i;
      return total;
    `);

    expect((await killed).timedOut).toBe(true);
    const result = await next;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe("19999900000");
    }
  });
});

describe("createSandbox", () => {
  test("hands back a process-backed sandbox that is ready to answer", async () => {
    const created = await createSandbox(options);

    try {
      expect(created).toBeInstanceOf(ProcessSandboxService);

      const result = await created.execute("1 + 1");
      expect(result.ok).toBe(true);
    } finally {
      await created.dispose?.();
    }
  });
});

describe("the child process", () => {
  async function childOf(service: ProcessSandboxService): Promise<{ process: Bun.Subprocess }> {
    return (service as unknown as { child: Promise<{ process: Bun.Subprocess }> }).child as Promise<{
      process: Bun.Subprocess;
    }>;
  }

  test("is a separate process that goes away when the service is disposed", async () => {
    const service = new ProcessSandboxService(options);
    await service.warmUp();
    const { process: child } = await childOf(service);

    expect(child.pid).not.toBe(process.pid);
    expect(child.killed).toBe(false);

    await service.dispose();
    expect(child.killed).toBe(true);
  });

  test("reports a crash and recovers", async () => {
    const service = new ProcessSandboxService(options);
    await service.warmUp();
    const { process: child } = await childOf(service);

    const running = service.execute("while (true) {}");
    await new Promise((resolve) => setTimeout(resolve, 100));
    child.kill("SIGKILL");
    const crashed = await running;

    expect(crashed.ok).toBe(false);
    expect(crashed.timedOut).toBe(false);
    if (!crashed.ok) {
      expect(crashed.error).toBe("The sandbox crashed while running this code.");
    }

    const next = await service.execute("20 + 22");
    expect(next.ok && next.result).toBe("42");
    await service.dispose();
  });

  test("is started again if it died while idle", async () => {
    const service = new ProcessSandboxService(options);
    await service.warmUp();
    const { process: child } = await childOf(service);

    child.kill("SIGKILL");
    await child.exited;

    const result = await service.execute("1 + 1");
    expect(result.ok && result.result).toBe("2");
    await service.dispose();
  });

  test("gets none of the bot's configuration", () => {
    const original = { token: process.env.BOT_TOKEN, other: process.env.SOME_SECRET };
    process.env.BOT_TOKEN = "123:secret";
    process.env.SOME_SECRET = "hunter2";

    try {
      const environment = childEnvironment();

      expect(Object.keys(environment)).not.toContain("BOT_TOKEN");
      expect(Object.keys(environment)).not.toContain("SOME_SECRET");
      expect(Object.values(environment).join(" ")).not.toContain("secret");
      expect(environment.PATH).toBe(process.env.PATH as string);
    } finally {
      if (original.token === undefined) delete process.env.BOT_TOKEN;
      else process.env.BOT_TOKEN = original.token;
      if (original.other === undefined) delete process.env.SOME_SECRET;
      else process.env.SOME_SECRET = original.other;
    }
  });

  test("a .env file in the working directory does not reach the child", async () => {
    const directory = mkdtempSync(join(tmpdir(), "jsitbot-env-"));

    try {
      writeFileSync(join(directory, ".env"), "BOT_TOKEN=from-dotenv\n");
      writeFileSync(join(directory, "probe.ts"), "console.log(JSON.stringify(Bun.env.BOT_TOKEN ?? null));\n");

      const probe = Bun.spawn(childCommand(join(directory, "probe.ts")), {
        cwd: directory,
        env: childEnvironment(),
        stdout: "pipe",
        stderr: "ignore",
      });

      expect((await new Response(probe.stdout).text()).trim()).toBe("null");
      await probe.exited;
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("a killed native loop leaves nothing behind to eat the memory", async () => {
    const service = new ProcessSandboxService(options);
    await service.warmUp();
    const exits: Array<Promise<number>> = [];

    for (let round = 0; round < 3; round++) {
      const { process: child } = await childOf(service);
      exits.push(child.exited);

      const result = await service.execute(`new Array(2 ** 28).join("ab").length`);
      expect(result.timedOut).toBe(true);
    }

    // Each killed process is gone as soon as it is killed, not seconds later.
    const settled = await Promise.race([
      Promise.all(exits).then(() => "exited"),
      new Promise((resolve) => setTimeout(() => resolve("still running"), 500)),
    ]);
    expect(settled).toBe("exited");
    await service.dispose();
  });
});
