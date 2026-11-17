import { expect } from "bun:test";

import { ProcessSandboxService } from "../../src/services/sandbox/processSandbox";
import type { SandboxExecution } from "../../src/services/sandbox/types";

export const TIME_LIMIT_MESSAGE = "Sandbox execution timed out.";
export const MEMORY_LIMIT_MESSAGE = "Sandbox exceeded its memory limit.";

/** A benign run after an abusive one, from a pool that may have just replaced a killed process, comes back within this. */
const HEALTHY_WALL_MS = 2_000;

/**
 * What a case should end with. `time` and `memory` are the sandbox's own limits;
 * `limit` accepts either, for a case whose cost is shared between them on a
 * given machine. `result` is a value the run returns, and `error` is a message
 * the run fails with that is neither a limit nor a crash.
 */
export type Outcome =
  | { kind: "result"; value: string | RegExp; truncated?: boolean }
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
export const timeLimit: Outcome = { kind: "time" };
export const memoryLimit: Outcome = { kind: "memory" };
export const eitherLimit: Outcome = { kind: "limit" };
export const failsWith = (message: RegExp): Outcome => ({ kind: "error", message });

/** One sandbox process shared by a file's cases, as the bot shares one. */
export function createPool(): ProcessSandboxService {
  return new ProcessSandboxService();
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
