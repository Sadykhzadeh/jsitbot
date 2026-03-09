export interface SandboxExecutionSuccess {
  ok: true;
  logs: string[];
  result: string;
  durationMs: number;
  timedOut: false;
  truncated: boolean;
}

export interface SandboxExecutionFailure {
  ok: false;
  logs: string[];
  error: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

export type SandboxExecution = SandboxExecutionSuccess | SandboxExecutionFailure;

export interface SandboxService {
  execute(code: string): Promise<SandboxExecution>;
}

export interface SandboxOptions {
  timeoutMs: number;
  memoryLimitBytes: number;
  maxStackSizeBytes: number;
  maxLogs: number;
  maxLogLength: number;
  maxResultLength: number;
}

export interface GuestExecutionShape {
  ok: boolean;
  value?: unknown;
  error?: unknown;
}
