import { expect } from "bun:test";

import { ProcessSandboxService } from "../../src/services/sandbox/processSandbox";
import type { SandboxExecution, SandboxOptions } from "../../src/services/sandbox/types";

export const TIME_LIMIT_MESSAGE = "Sandbox execution timed out.";
export const MEMORY_LIMIT_MESSAGE = "Sandbox exceeded its memory limit.";

/**
 * A benign run after an abusive one comes back within this, counting the start
 * of a replacement process after a kill. On a busy machine that start can take
 * seconds, so this only catches a pool that is stuck; a slow guest is caught by
 * the run's own duration below.
 */
const HEALTHY_WALL_MS = 5_000;
/**
 * The guest part of a benign run takes about a millisecond. A poisoned pool, such as one
 * still collecting garbage or timers from an abusive run, is seconds slow; a few hundred
 * milliseconds is the machine, which a full suite run under other builds can take away.
 */
const HEALTHY_GUEST_MS = 1_000;

/**
 * What a case should end with. `time` and `memory` are the sandbox's own limits;
 * `limit` accepts either, for a case whose cost is shared between them on a
 * given machine. `result` is a value the run returns, and `error` is a message
 * the run fails with that is neither a limit nor a crash.
 */
export type Outcome =
  | { kind: "result"; value: string | RegExp; truncated?: boolean }
  | { kind: "result-or-time"; value: string | RegExp; truncated?: boolean }
  | { kind: "time" }
  | { kind: "memory" }
  | { kind: "limit" }
  | { kind: "error"; message: RegExp };

export interface AbuseCase {
  name: string;
  code: string;
  outcome: Outcome;
}

export const result = (value: string | RegExp, truncated?: boolean): Outcome => ({ kind: "result", value, truncated });
/** A run that prints a lot may also reach the time limit on a loaded machine: either ending is within the limits. */
export const resultOrTime = (value: string | RegExp, truncated?: boolean): Outcome => ({ kind: "result-or-time", value, truncated });
export const timeLimit: Outcome = { kind: "time" };
export const memoryLimit: Outcome = { kind: "memory" };
export const eitherLimit: Outcome = { kind: "limit" };
export const failsWith = (message: RegExp): Outcome => ({ kind: "error", message });

/** One sandbox process shared by a file's cases, as the bot shares one. */
export function createPool(options?: Partial<SandboxOptions>): ProcessSandboxService {
  return new ProcessSandboxService(options);
}

/** The output limits every run keeps to, whatever the code did. */
export function expectBounded(execution: SandboxExecution): void {
  expect(execution.logs.length).toBeLessThanOrEqual(50);
  for (const line of execution.logs) {
    expect(line.length).toBeLessThanOrEqual(2_000);
  }
  if (execution.ok) {
    expect(execution.result.length).toBeLessThanOrEqual(4_000);
  } else {
    expect(execution.error.length).toBeLessThanOrEqual(4_000);
  }
}

export function expectOutcome(execution: SandboxExecution, outcome: Outcome): void {
  switch (outcome.kind) {
    case "result": {
      expect(execution.ok).toBe(true);
      if (!execution.ok) return;
      if (typeof outcome.value === "string") {
        expect(execution.result).toBe(outcome.value);
      } else {
        expect(execution.result).toMatch(outcome.value);
      }
      if (outcome.truncated !== undefined) {
        expect(execution.truncated).toBe(outcome.truncated);
      }
      return;
    }
    case "result-or-time": {
      if (!execution.ok && execution.timedOut) {
        expectOutcome(execution, timeLimit);
        return;
      }
      expectOutcome(execution, { kind: "result", value: outcome.value, truncated: outcome.truncated });
      return;
    }
    case "time": {
      expect(execution.ok).toBe(false);
      if (execution.ok) return;
      expect(execution.timedOut).toBe(true);
      expect(execution.error).toBe(TIME_LIMIT_MESSAGE);
      return;
    }
    case "memory": {
      expect(execution.ok).toBe(false);
      if (execution.ok) return;
      expect(execution.timedOut).toBe(false);
      expect(execution.error).toBe(MEMORY_LIMIT_MESSAGE);
      return;
    }
    case "limit": {
      expect(execution.ok).toBe(false);
      if (execution.ok) return;
      expect([TIME_LIMIT_MESSAGE, MEMORY_LIMIT_MESSAGE]).toContain(execution.error);
      return;
    }
    case "error": {
      expect(execution.ok).toBe(false);
      if (execution.ok) return;
      expect(execution.timedOut).toBe(false);
      expect(execution.error).toMatch(outcome.message);
      return;
    }
  }
}

/** The next benign run gets the right answer, quickly, from the same pool. */
export async function expectHealthy(pool: ProcessSandboxService): Promise<void> {
  const started = performance.now();
  const next = await pool.execute("6 * 7");
  const wallMs = performance.now() - started;

  expect(next.ok).toBe(true);
  if (next.ok) {
    expect(next.result).toBe("42");
    expect(next.timedOut).toBe(false);
    expect(next.durationMs).toBeLessThan(HEALTHY_GUEST_MS);
  }
  expect(wallMs).toBeLessThan(HEALTHY_WALL_MS);
}

/** Runs one case, then checks what it left behind: bounded output and a healthy pool. */
export async function runCase(pool: ProcessSandboxService, abuse: AbuseCase): Promise<void> {
  const execution = await pool.execute(abuse.code);

  expectBounded(execution);
  expectOutcome(execution, abuse.outcome);
  await expectHealthy(pool);
}
