import type {
  QuickJSContext,
  QuickJSHandle,
  QuickJSRuntime,
  QuickJSWASMModule,
} from "quickjs-emscripten";

import {
  GUEST_FILE,
  guestRuntimeSource,
  wrapAsExpression,
  wrapAsStatements,
} from "./executionWrapper";
import {
  resolveSandboxOptions,
  type SandboxExecution,
  type SandboxOptions,
  type SandboxService,
} from "./types";
import { createCappedModule, isHeapExhausted } from "./wasmHeap";

const MEMORY_LIMIT_MESSAGE = "Sandbox exceeded its memory limit.";
const TIMEOUT_MESSAGE = "Sandbox execution timed out.";
const NEVER_SETTLES_MESSAGE = "The code is waiting on a promise that can never settle.";
const UNREADABLE_MESSAGE = "The sandbox returned a result it could not read.";

// Jobs are run in batches so the deadline is checked between them as well as
// by the interrupt handler inside them.
const JOB_BATCH_SIZE = 1_000;

const FLAG_RESULT_CUT = 1;
const FLAG_LOGS_CUT = 2;

/** What the guest runtime hands back: a status, some flags and the text to show. */
interface Packed {
  ok: boolean;
  text: string;
  truncated: boolean;
}

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

function unpack(raw: string): Packed | undefined {
  const firstBreak = raw.indexOf("\n");
  const secondBreak = raw.indexOf("\n", firstBreak + 1);
  if (firstBreak < 1 || secondBreak < 0) {
    return undefined;
  }

  const status = raw.slice(0, firstBreak);
  const flags = Number(raw.slice(firstBreak + 1, secondBreak));
  if ((status !== "o" && status !== "e") || !Number.isInteger(flags)) {
    return undefined;
  }

  return {
    ok: status === "o",
    text: raw.slice(secondBreak + 1),
    truncated: (flags & (FLAG_RESULT_CUT | FLAG_LOGS_CUT)) !== 0,
  };
}

type Attempt =
  | { settled: true; packed: Packed | undefined }
  | { settled: false; parseError: Packed };

interface Guest {
  finish: QuickJSHandle;
  fail: QuickJSHandle;
}

function isSyntaxError(packed: Packed): boolean {
  return !packed.ok && packed.text.startsWith("SyntaxError");
}

function readString(context: QuickJSContext, handle: QuickJSHandle): string | undefined {
  return context.typeof(handle) === "string" ? context.getString(handle) : undefined;
}

function disposeQuietly(dispose: () => void): void {
  try {
    dispose();
  } catch {
    // A runtime that was cut short can fail its own teardown. Its WebAssembly
    // instance is thrown away either way, so there is nothing to save.
  }
}

/** Handles must be released before their context; this keeps track of them. */
class HandleBin {
  private readonly handles: QuickJSHandle[] = [];

  add<T extends QuickJSHandle>(handle: T): T {
    this.handles.push(handle);
    return handle;
  }

  disposeAll(): void {
    for (const handle of this.handles.reverse()) {
      disposeQuietly(() => handle.dispose());
    }
    this.handles.length = 0;
  }
}

function drainPendingJobs(runtime: QuickJSRuntime, expired: () => boolean): void {
  while (runtime.hasPendingJob()) {
    if (expired()) {
      throw new Error("InternalError: interrupted");
    }

    const result = runtime.executePendingJobs(JOB_BATCH_SIZE);
    if (result.error) {
      const dumped = result.error.context.dump(result.error) as { name?: unknown; message?: unknown } | null;
      result.error.dispose();
      throw new Error(`${dumped?.name ?? "Error"}: ${dumped?.message ?? "unknown error"}`);
    }
  }
}

export class QuickJsSandboxService implements SandboxService {
  private readonly options: SandboxOptions;
  private spareModule: Promise<QuickJSWASMModule> | undefined;

  constructor(options?: Partial<SandboxOptions>) {
    this.options = resolveSandboxOptions(options);
  }

  /** Pays for the first instance and warms up the interpreter before a real run needs them. */
  async warmUp(): Promise<void> {
    await this.execute("0");
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
    let startedAt = performance.now();
    const logs: string[] = [];
    let interrupted = false;
    let heapExhausted = () => false;

    const failure = (error: string, timedOut = interrupted, cut = false): SandboxExecution => {
      // With the heap used up to the last page QuickJS cannot even allocate its
      // out-of-memory error, so the guest sees a bare null instead of a message.
      const outOfMemory = error === "InternalError: out of memory" || (heapExhausted() && !timedOut);
      const message = timedOut ? TIMEOUT_MESSAGE : outOfMemory ? MEMORY_LIMIT_MESSAGE : error;
      const bounded = truncateValue(message, this.options.maxResultLength);

      return {
        ok: false,
        logs,
        error: bounded.value,
        durationMs: Math.round(performance.now() - startedAt),
        timedOut,
        truncated: bounded.truncated || cut,
      };
    };

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
      const handles = new HandleBin();

      try {
        // The clock starts when the guest does: time spent waiting for an
        // instance or behind another run is not the guest's to pay for.
        startedAt = performance.now();
        runtime.setInterruptHandler(() => {
          if (performance.now() - startedAt <= this.options.timeoutMs) {
            return false;
          }

          interrupted = true;
          return true;
        });

        const packed = this.evaluate(context, runtime, code, logs, handles, () => interrupted);

        if (interrupted) {
          return failure(TIMEOUT_MESSAGE, true);
        }
        if (!packed) {
          return failure(UNREADABLE_MESSAGE);
        }
        if (!packed.ok) {
          return failure(packed.text, interrupted, packed.truncated);
        }

        const result = truncateValue(packed.text, this.options.maxResultLength);

        return {
          ok: true,
          logs,
          result: result.value,
          durationMs: Math.round(performance.now() - startedAt),
          timedOut: false,
          truncated: packed.truncated || result.truncated,
        };
      } finally {
        // A runtime that died of an exhausted heap trips an assertion when it is
        // freed. The whole instance is dropped right after, so skip the teardown.
        if (!heapExhausted()) {
          handles.disposeAll();
          disposeQuietly(() => context.dispose());
          disposeQuietly(() => runtime.dispose());
        }
      }
    } catch (error) {
      return failure(normalizeUnknownError(error));
    }
  }

  /**
   * Finds the reading of the code that parses, in this order:
   *
   * 1. one expression (`1 + 1`, `{ a: 1 }`, `await load()`), whose value is the result;
   * 2. a script (`const a = 1; a + 1`), whose result is the value of its last
   *    statement, as in a REPL;
   * 3. the body of a function (`return`, top-level `await` next to statements).
   *
   * The first and last are wrapped in an async function, so the only thing that
   * can throw while evaluating them is a parse error, never the code itself. A
   * script can throw anything, so it is compiled without running first: a
   * SyntaxError from `JSON.parse` must not send the code round again.
   */
  private evaluate(
    context: QuickJSContext,
    runtime: QuickJSRuntime,
    code: string,
    logs: string[],
    handles: HandleBin,
    expired: () => boolean,
  ): Packed | undefined {
    const guest = this.installGuest(context, logs, handles);
    const attempts: Array<() => Attempt> = [
      () => this.attemptWrapped(context, runtime, guest, wrapAsExpression(code), expired),
      () => this.attemptScript(context, runtime, guest, code, expired),
      () => this.attemptWrapped(context, runtime, guest, wrapAsStatements(code), expired),
    ];
    let parseError: Packed | undefined;

    for (const attempt of attempts) {
      const outcome = attempt();
      if (outcome.settled) {
        return outcome.packed;
      }

      parseError = outcome.parseError;
    }

    return parseError;
  }

  private attemptWrapped(
    context: QuickJSContext,
    runtime: QuickJSRuntime,
    guest: Guest,
    source: string,
    expired: () => boolean,
  ): Attempt {
    const evaluated = context.evalCode(source, GUEST_FILE);

    if (evaluated.error) {
      return this.afterParseFailure(this.packFailure(context, guest.fail, evaluated.error));
    }

    return { settled: true, packed: this.settle(context, runtime, guest.finish, evaluated.value, expired) };
  }

  private attemptScript(
    context: QuickJSContext,
    runtime: QuickJSRuntime,
    guest: Guest,
    code: string,
    expired: () => boolean,
  ): Attempt {
    const compiled = context.evalCode(code, GUEST_FILE, { compileOnly: true });

    if (compiled.error) {
      return this.afterParseFailure(this.packFailure(context, guest.fail, compiled.error));
    }
    compiled.value.dispose();

    // It parses, so whatever happens from here on is the code's own doing.
    const evaluated = context.evalCode(code, GUEST_FILE);
    const packed = evaluated.error
      ? this.packFailure(context, guest.fail, evaluated.error)
      : this.settle(context, runtime, guest.finish, evaluated.value, expired);

    return { settled: true, packed };
  }

  /** A parse error means "try the next reading"; anything else is the answer. */
  private afterParseFailure(packed: Packed | undefined): Attempt {
    return packed && isSyntaxError(packed)
      ? { settled: false, parseError: packed }
      : { settled: true, packed };
  }

  private installGuest(
    context: QuickJSContext,
    logs: string[],
    handles: HandleBin,
  ): Guest {
    const { maxLogs, maxLogLength, maxResultLength } = this.options;

    const setup = handles.add(context.unwrapResult(context.evalCode(guestRuntimeSource, "guest.js")));
    const hostLog = handles.add(
      context.newFunction("hostLog", (line) => {
        const text = readString(context, line);
        if (text !== undefined && logs.length < maxLogs) {
          logs.push(truncateValue(text, maxLogLength).value);
        }
      }),
    );
    const api = handles.add(
      context.unwrapResult(
        context.callFunction(
          setup,
          context.undefined,
          hostLog,
          handles.add(context.newNumber(maxLogs)),
          handles.add(context.newNumber(maxLogLength)),
          handles.add(context.newNumber(maxResultLength)),
        ),
      ),
    );

    return {
      finish: handles.add(context.getProp(api, "finish")),
      fail: handles.add(context.getProp(api, "fail")),
    };
  }

  /** Turns a value the code threw (before it ever started running) into a packed result. */
  private packFailure(
    context: QuickJSContext,
    fail: QuickJSHandle,
    error: QuickJSHandle,
  ): Packed | undefined {
    const called = context.callFunction(fail, context.undefined, error);
    error.dispose();

    if (called.error) {
      called.error.dispose();
      return undefined;
    }

    const raw = readString(context, called.value);
    called.value.dispose();

    return raw === undefined ? undefined : unpack(raw);
  }

  /** Lets the code's promise run to completion, then reads what the guest packed. */
  private settle(
    context: QuickJSContext,
    runtime: QuickJSRuntime,
    finish: QuickJSHandle,
    pending: QuickJSHandle,
    expired: () => boolean,
  ): Packed | undefined {
    const called = context.callFunction(finish, context.undefined, pending);
    pending.dispose();

    if (called.error) {
      called.error.dispose();
      return undefined;
    }

    const settled = called.value;
    try {
      drainPendingJobs(runtime, expired);

      const state = context.getPromiseState(settled);
      if (state.type === "pending") {
        return { ok: false, text: NEVER_SETTLES_MESSAGE, truncated: false };
      }
      if (state.type === "rejected") {
        state.error.dispose();
        return undefined;
      }

      const raw = readString(context, state.value);
      state.value.dispose();

      return raw === undefined ? undefined : unpack(raw);
    } finally {
      settled.dispose();
    }
  }
}
