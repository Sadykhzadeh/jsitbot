import type { SandboxExecution, SandboxOptions } from "./types";

export type ChildRequest =
  | { type: "init"; options: SandboxOptions }
  | { type: "run"; id: number; code: string };

export type ChildResponse =
  | { type: "ready" }
  | { type: "result"; id: number; execution: SandboxExecution };
