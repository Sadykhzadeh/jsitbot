import type { SandboxExecution, SandboxOptions } from "./types";

export type ChildRequest =
  | { type: "init"; options: SandboxOptions }
  | { type: "run"; id: number; code: string };

export type ChildResponse =
  | { type: "ready" }
  // The guest's clock has started: from here the run has its timeout to finish.
  | { type: "started"; id: number }
  | { type: "result"; id: number; execution: SandboxExecution };
