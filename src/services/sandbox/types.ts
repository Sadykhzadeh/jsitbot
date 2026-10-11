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
  /** Gets everything the first run would otherwise pay for out of the way. */
  warmUp?(): Promise<void>;
  /** Releases threads or instances held by the service. */
  dispose?(): void;
}

export interface SandboxOptions {
  timeoutMs: number;
  memoryLimitBytes: number;
  maxStackSizeBytes: number;
  maxLogs: number;
  maxLogLength: number;
  maxResultLength: number;
}

export const DEFAULT_SANDBOX_OPTIONS: SandboxOptions = {
  timeoutMs: 700,
  memoryLimitBytes: 64 * 1024 * 1024,
  maxStackSizeBytes: 512 * 1024,
  maxLogs: 50,
  maxLogLength: 2_000,
  maxResultLength: 4_000,
};

export function resolveSandboxOptions(options?: Partial<SandboxOptions>): SandboxOptions {
  return { ...DEFAULT_SANDBOX_OPTIONS, ...options };
}

export interface GuestExecutionShape {
  ok: boolean;
  value?: unknown;
  error?: unknown;
}
