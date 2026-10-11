import type { SandboxExecution, SandboxOptions } from "./types";

export type WorkerRequest =
  | { type: "init"; options: SandboxOptions }
  | { type: "run"; id: number; code: string };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "result"; id: number; execution: SandboxExecution };
