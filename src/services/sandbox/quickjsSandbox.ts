import type {
  QuickJSContext,
  QuickJSHandle,
  QuickJSRuntime,
  QuickJSWASMModule,
} from "quickjs-emscripten";

import {
  buildExpressionWrapper,
  buildStatementWrapper,
} from "./executionWrapper";
import type {
  GuestExecutionShape,
  SandboxExecution,
  SandboxOptions,
  SandboxService,
} from "./types";
import { createCappedModule, isHeapExhausted } from "./wasmHeap";

const DEFAULT_OPTIONS: SandboxOptions = {
  timeoutMs: 700,
  memoryLimitBytes: 64 * 1024 * 1024,
  maxStackSizeBytes: 512 * 1024,
  maxLogs: 50,
  maxLogLength: 2_000,
  maxResultLength: 4_000,
};

type AttemptResult =
  | { kind: "ok"; value: GuestExecutionShape }
  | { kind: "syntax-error"; error: string }
  | { kind: "runtime-error"; error: string; timedOut: boolean };

function truncateValue(value: string, maxLength: number): { value: string; truncated: boolean } {
  if (value.length <= maxLength) {
    return { value, truncated: false };
  }

  return {
    value: `${value.slice(0, Math.max(0, maxLength - 3))}...`,
    truncated: true,
  };
}

function normalizeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isSyntaxErrorMessage(message: string): boolean {
  return /syntaxerror|unexpected token|expecting|parse error/i.test(message);
}

function isTimeoutErrorMessage(message: string): boolean {
  return /interrupt|interrupted|timeout/i.test(message);
}

function isMemoryErrorMessage(message: string): boolean {
  return /out of memory|memory/i.test(message);
}

function serializeHostLogArg(arg: unknown): string {
  if (typeof arg === "string") {
    return arg;
  }

  if (arg === undefined) {
    return "undefined";
  }

  if (arg === null) {
    return "null";
  }

  if (typeof arg === "bigint") {
    return `${arg}n`;
  }

  if (typeof arg === "function") {
    return "[Function]";
  }

  if (typeof arg === "symbol") {
    return String(arg);
  }

  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function serializeGuestHandleForLog(context: QuickJSContext, handle: QuickJSHandle): string {
  return serializeHostLogArg(dumpHandle<unknown>(context, handle));
}

function dumpHandle<T>(context: QuickJSContext, handle: QuickJSHandle): T {
  return context.dump(handle) as T;
}

function consumeHandle<T>(context: QuickJSContext, handle: QuickJSHandle): T {
  try {
    return dumpHandle<T>(context, handle);
  } finally {
    handle.dispose();
  }
}

function errorHandleToString(context: QuickJSContext, handle: QuickJSHandle): string {
  try {
    if (context.typeof(handle) === "object") {
      const messageHandle = context.getProp(handle, "message");
      const nameHandle = context.getProp(handle, "name");

      try {
        const message = dumpHandle<unknown>(context, messageHandle);
        const name = dumpHandle<unknown>(context, nameHandle);

        if (typeof message === "string" && typeof name === "string" && name.length > 0) {
          return `${name}: ${message}`;
        }

        if (typeof message === "string" && message.length > 0) {
          return message;
        }
      } finally {
        messageHandle.dispose();
        nameHandle.dispose();
      }
    }

    const dumped = dumpHandle<unknown>(context, handle);

    if (typeof dumped === "string") {
      return dumped;
    }

    if (dumped && typeof dumped === "object") {
      const maybeMessage = "message" in dumped ? dumped.message : undefined;
      if (typeof maybeMessage === "string" && maybeMessage.length > 0) {
        return maybeMessage;
      }
    }

    return String(dumped);
  } finally {
    handle.dispose();
  }
}

function drainPendingJobs(runtime: QuickJSRuntime): void {
  while (runtime.hasPendingJob()) {
    const jobsResult = runtime.executePendingJobs();
    if (jobsResult.error) {
      const message = errorHandleToString(jobsResult.error.context, jobsResult.error);
      throw new Error(message);
    }
  }
}

function resolvePromiseResult(
  context: QuickJSContext,
  promiseHandle: QuickJSHandle,
): GuestExecutionShape {
  try {
    drainPendingJobs(context.runtime);

    const promiseState = context.getPromiseState(promiseHandle);
    if (promiseState.type === "fulfilled") {
      return consumeHandle<GuestExecutionShape>(context, promiseState.value);
    }

    if (promiseState.type === "rejected") {
      return {
        ok: false,
        error: errorHandleToString(context, promiseState.error),
      };
    }

    throw new Error("Sandbox promise did not settle");
  } finally {
    promiseHandle.dispose();
  }
}

function disposeQuietly(dispose: () => void): void {
  try {
    dispose();
  } catch {
    // A runtime that was cut short by an abort can fail its own teardown. Its
    // WebAssembly instance is thrown away either way, so there is nothing to save.
  }
}

export class QuickJsSandboxService implements SandboxService {
  private readonly options: SandboxOptions;
  private spareModule: Promise<QuickJSWASMModule> | undefined;

  constructor(options?: Partial<SandboxOptions>) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
  }

  /** Builds the next WebAssembly instance ahead of time so the first run does not pay for it. */
  async warmUp(): Promise<void> {
    this.prepareSpare();
    await this.spareModule;
  }

  private takeModule(): Promise<QuickJSWASMModule> {
    const module = this.spareModule ?? createCappedModule(this.options.memoryLimitBytes);
    this.spareModule = undefined;

    // After the reply is on its way rather than before the next run starts.
    setTimeout(() => this.prepareSpare(), 0);

    return module;
  }

  private prepareSpare(): void {
    if (this.spareModule) {
      return;
    }

    const spare = createCappedModule(this.options.memoryLimitBytes);
    this.spareModule = spare;
    spare.catch(() => {
      if (this.spareModule === spare) {
        this.spareModule = undefined;
      }
    });
  }

  async execute(code: string): Promise<SandboxExecution> {
    const startedAt = performance.now();
    const logs: string[] = [];
    let timedOut = false;
    let truncated = false;
    let heapExhausted = () => false;

    try {
      // A fresh instance with its own capped memory for every run, so a run that
      // exhausts or corrupts it cannot affect the next one.
      const quickjs = await this.takeModule();
      heapExhausted = () => isHeapExhausted(quickjs, this.options.memoryLimitBytes);
      const runtime = quickjs.newRuntime({
        memoryLimitBytes: this.options.memoryLimitBytes,
        maxStackSizeBytes: this.options.maxStackSizeBytes,
      });
      const context = runtime.newContext();

      try {
        this.installInterruptHandler(runtime, startedAt);
        this.installConsoleBridge(context, logs);

        const expressionAttempt = await this.evaluateWrappedSource(
          context,
          buildExpressionWrapper(code),
        );

        let execution: GuestExecutionShape;

        if (expressionAttempt.kind === "ok") {
          execution = expressionAttempt.value;
        } else if (expressionAttempt.kind === "syntax-error") {
          const statementAttempt = await this.evaluateWrappedSource(
            context,
            buildStatementWrapper(code),
          );

          if (statementAttempt.kind === "ok") {
            execution = statementAttempt.value;
          } else {
            timedOut =
              statementAttempt.kind === "runtime-error"
                ? statementAttempt.timedOut
                : false;
            return this.failureFromAttempt(
              statementAttempt.error,
              logs,
              startedAt,
              timedOut,
              heapExhausted(),
            );
          }
        } else {
          timedOut = expressionAttempt.timedOut;
          return this.failureFromAttempt(
            expressionAttempt.error,
            logs,
            startedAt,
            timedOut,
            heapExhausted(),
          );
        }

        if (!execution.ok) {
          timedOut = isTimeoutErrorMessage(String(execution.error ?? ""));
          return this.failureFromAttempt(
            String(execution.error ?? "Unknown execution error"),
            logs,
            startedAt,
            timedOut,
            heapExhausted(),
          );
        }

        const normalizedResult = truncateValue(
          String(execution.value ?? "undefined"),
          this.options.maxResultLength,
        );
        truncated = truncated || normalizedResult.truncated;

        return {
          ok: true,
          logs,
          result: normalizedResult.value,
          durationMs: Math.round(performance.now() - startedAt),
          timedOut: false,
          truncated,
        };
      } finally {
        disposeQuietly(() => this.teardownConsoleBridge(context));
        disposeQuietly(() => context.dispose());
        disposeQuietly(() => runtime.dispose());
      }
    } catch (error) {
      const message = normalizeUnknownError(error);
      timedOut = timedOut || isTimeoutErrorMessage(message);
      return this.failureFromAttempt(message, logs, startedAt, timedOut, heapExhausted());
    }
  }

  private installInterruptHandler(runtime: QuickJSRuntime, startedAt: number): void {
    runtime.setInterruptHandler(() => {
      const expired = performance.now() - startedAt > this.options.timeoutMs;

      return expired;
    });
  }

  private installConsoleBridge(context: QuickJSContext, logs: string[]): void {
    const logSink = context.newFunction("__hostLog", (...args) => {
      if (logs.length >= this.options.maxLogs) {
        return;
      }

      const serialized = args
        .map((arg) => serializeGuestHandleForLog(context, arg))
        .join(" ");
      const normalized = truncateValue(serialized, this.options.maxLogLength);
      logs.push(normalized.value);
    });

    context.setProp(context.global, "__hostLog", logSink);
    logSink.dispose();
  }

  private teardownConsoleBridge(context: QuickJSContext): void {
    const cleanupResult = context.evalCode(`
      try {
        delete globalThis.console;
        delete globalThis.__hostLog;
      } catch {}
    `);

    if (cleanupResult.error) {
      cleanupResult.error.dispose();
      return;
    }

    cleanupResult.value.dispose();
  }

  private async evaluateWrappedSource(
    context: QuickJSContext,
    source: string,
  ): Promise<AttemptResult> {
    const result = context.evalCode(source);

    if (result.error) {
      const error = errorHandleToString(context, result.error);
      return isSyntaxErrorMessage(error)
        ? { kind: "syntax-error", error }
        : {
            kind: "runtime-error",
            error,
            timedOut: isTimeoutErrorMessage(error),
          };
    }

    try {
      const native = resolvePromiseResult(context, result.value);
      return { kind: "ok", value: native };
    } catch (error) {
      const message = normalizeUnknownError(error);
      return {
        kind: "runtime-error",
        error: message,
        timedOut: isTimeoutErrorMessage(message),
      };
    }
  }

  private failureFromAttempt(
    error: string,
    logs: string[],
    startedAt: number,
    timedOut: boolean,
    heapExhausted: boolean,
  ): SandboxExecution {
    // With the heap used up to the last page QuickJS cannot even allocate its
    // out-of-memory error, so the guest sees a bare null instead of a message.
    const normalized = isMemoryErrorMessage(error) || (heapExhausted && !timedOut)
      ? "Sandbox exceeded its memory limit."
      : timedOut
        ? "Sandbox execution timed out."
        : error;
    const truncatedError = truncateValue(normalized, this.options.maxResultLength);

    return {
      ok: false,
      logs,
      error: truncatedError.value,
      durationMs: Math.round(performance.now() - startedAt),
      timedOut,
      truncated: truncatedError.truncated,
    };
  }
}
