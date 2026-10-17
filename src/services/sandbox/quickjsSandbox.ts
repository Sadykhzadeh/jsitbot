import type {
  QuickJSContext,
  QuickJSHandle,
  QuickJSRuntime,
  QuickJSWASMModule,
} from "quickjs-emscripten";

import {
  GUEST_FILE,
  guestExtras,
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
import { truncateText } from "../../utils/markdownV2";
import { stripTypes } from "./typescript";
import { createCappedModule, isHeapExhausted, isHeapGrown } from "./wasmHeap";

const MEMORY_LIMIT_MESSAGE = "Sandbox exceeded its memory limit.";
const TIMEOUT_MESSAGE = "Sandbox execution timed out.";
const NEVER_SETTLES_MESSAGE = "The code is waiting on a promise that can never settle.";
const UNREADABLE_MESSAGE = "The sandbox returned a result it could not read.";

// Jobs are run in batches so the deadline is checked between them as well as
// by the interrupt handler inside them.
const JOB_BATCH_SIZE = 1_000;

const WARM_UP_PROGRAMS = [
  "0",
  `const rows = [1, 2, 3].map((n) => ({ n, label: "row " + n })); console.log(rows); rows`,
  `return { ok: true, items: new Map([["a", [1, 2]]]) }`,
  `const total: number = 1; null.missing`,
];

// A run that left this much more of the process resident than it found is
// followed by a garbage collection.
const HEAVY_RUN_BYTES = 8 * 1024 * 1024;

const FLAG_RESULT_CUT = 1;
const FLAG_LOGS_CUT = 2;

/** What the guest runtime hands back: a status, some flags and the text to show. */
interface Packed {
  ok: boolean;
  text: string;
  /** Line of the user's code an error came from. */
  line?: number;
  truncated: boolean;
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
  const thirdBreak = raw.indexOf("\n", secondBreak + 1);
  if (firstBreak < 1 || secondBreak < 0 || thirdBreak < 0) {
    return undefined;
  }

  const status = raw.slice(0, firstBreak);
  const line = Number(raw.slice(firstBreak + 1, secondBreak));
  const flags = Number(raw.slice(secondBreak + 1, thirdBreak));
  if ((status !== "o" && status !== "e") || !Number.isInteger(line) || !Number.isInteger(flags)) {
    return undefined;
  }

  return {
    ok: status === "o",
    text: raw.slice(thirdBreak + 1),
    line: line > 0 ? line : undefined,
    truncated: (flags & (FLAG_RESULT_CUT | FLAG_LOGS_CUT)) !== 0,
  };
}

type Attempt =
  | { settled: true; packed: Packed | undefined }
  | { settled: false; parseError: Packed };

interface Guest {
  finish: QuickJSHandle;
  tick: QuickJSHandle;
  fail: QuickJSHandle;
}

/**
 * A WebAssembly instance with a runtime and context in it that already carry
 * the guest runtime, and that no user code has touched yet. Building one takes
 * longer than running most programs, so one is made while the sandbox is idle.
 */
interface Prepared {
  module: QuickJSWASMModule;
  runtime: QuickJSRuntime;
  context: QuickJSContext;
  guest: Guest;
  /** Where the guest's console output goes; set once per run. */
  logs: string[];
}

function isSyntaxError(packed: Packed): boolean {
  return !packed.ok && packed.text.startsWith("SyntaxError");
}

function readString(context: QuickJSContext, handle: QuickJSHandle): string | undefined {
  return context.typeof(handle) === "string" ? context.getString(handle) : undefined;
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
  private spare: Promise<Prepared> | undefined;

  constructor(options?: Partial<SandboxOptions>) {
    this.options = resolveSandboxOptions(options);
  }

  /**
   * Pays for the first instance and warms up the paths a real run takes (the
   * three readings of the code, objects, console output, errors) so that the
   * first message is not slower than the thousandth.
   */
  async warmUp(): Promise<void> {
    for (const code of WARM_UP_PROGRAMS) {
      await this.execute(code);
    }
    this.prepareSpare();
    await this.spare;
  }

  private takePrepared(): Promise<Prepared> {
    const prepared = this.spare ?? this.prepare();
    this.spare = undefined;

    // After the reply is on its way rather than before the next run starts.
    setTimeout(() => this.prepareSpare(), 0);

    return prepared;
  }

  private prepareSpare(): void {
    if (this.spare) {
      return;
    }

    const spare = this.prepare();
    this.spare = spare;
    spare.catch(() => {
      if (this.spare === spare) {
        this.spare = undefined;
      }
    });
  }

  private async prepare(): Promise<Prepared> {
    const module = await createCappedModule(this.options.memoryLimitBytes);
    const runtime = module.newRuntime({
      memoryLimitBytes: this.options.memoryLimitBytes,
      maxStackSizeBytes: this.options.maxStackSizeBytes,
    });
    const context = runtime.newContext();
    const logs: string[] = [];
    const prepared = { module, runtime, context, logs } as Prepared;
    prepared.guest = this.installGuest(context, prepared);

    return prepared;
  }

  /** `onStart` is called when the guest's clock starts, just before its code does. */
  async execute(code: string, onStart?: () => void): Promise<SandboxExecution> {
    let startedAt = performance.now();
    let logs: string[] = [];
    let interrupted = false;
    let heapExhausted = () => false;
    let heavy = () => false;

    const failure = (
      error: string,
      details: { timedOut?: boolean; truncated?: boolean; line?: number } = {},
    ): SandboxExecution => {
      const timedOut = details.timedOut ?? interrupted;
      // With the heap used up to the last page QuickJS cannot even allocate its
      // out-of-memory error, so the guest sees a bare null instead of a message.
      const outOfMemory = error === "InternalError: out of memory" || (heapExhausted() && !timedOut);
      const message = timedOut ? TIMEOUT_MESSAGE : outOfMemory ? MEMORY_LIMIT_MESSAGE : error;
      const bounded = truncateText(message, this.options.maxResultLength);

      const ownError = !timedOut && !outOfMemory;

      return {
        ok: false,
        logs,
        error: bounded.value,
        ...(ownError && details.line ? { line: details.line } : {}),
        durationMs: Math.round(performance.now() - startedAt),
        timedOut,
        truncated: bounded.truncated || Boolean(details.truncated),
      };
    };

    try {
      // A fresh instance with its own capped memory for every run, so a run that
      // exhausts or corrupts it cannot affect the next one. It is never torn
      // down: the whole instance is dropped, and freeing a runtime that died of
      // a stack overflow or an exhausted heap trips an assertion in QuickJS.
      const { module, runtime, context, guest, logs: sink } = await this.takePrepared();
      logs = sink;
      heapExhausted = () => isHeapExhausted(module, this.options.memoryLimitBytes);
      const residentBefore = process.memoryUsage.rss();
      heavy = () => isHeapGrown(module) || process.memoryUsage.rss() - residentBefore > HEAVY_RUN_BYTES;

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

      onStart?.();
      const packed = this.evaluate(context, runtime, guest, code, () => interrupted);

      if (interrupted) {
        return failure(TIMEOUT_MESSAGE, { timedOut: true });
      }
      if (!packed) {
        return failure(UNREADABLE_MESSAGE);
      }
      if (!packed.ok) {
        return failure(packed.text, { truncated: packed.truncated, line: packed.line });
      }

      const result = truncateText(packed.text, this.options.maxResultLength);

      return {
        ok: true,
        logs,
        result: result.value,
        durationMs: Math.round(performance.now() - startedAt),
        timedOut: false,
        truncated: packed.truncated || result.truncated,
      };
    } catch (error) {
      return failure(normalizeUnknownError(error));
    } finally {
      if (heavy()) {
        // A dropped instance is only freed when the collector gets to it, and
        // it counts as 16 MB however much of it was used, so the collector waits
        // for a dozen of them. Instances that each held tens of megabytes would
        // pile up to hundreds, and several such runs in a row could take the
        // machine's memory. Do it once the reply is on its way.
        setTimeout(() => Bun.gc(true), 0);
      }
    }
  }

  /**
   * Runs the code, as plain JavaScript if it parses as that and as TypeScript
   * with the types removed if it does not. A TypeScript run has no meaningful
   * line numbers, since the stripped code is laid out differently, and a
   * failure of both is reported as the JavaScript error the user would expect.
   */
  private evaluate(
    context: QuickJSContext,
    runtime: QuickJSRuntime,
    guest: Guest,
    code: string,
    expired: () => boolean,
  ): Packed | undefined {
    const direct = this.readCode(context, runtime, guest, code, expired);
    if (direct.settled) {
      return direct.packed;
    }

    const stripped = stripTypes(code);
    if (stripped && "code" in stripped) {
      const typed = this.readCode(context, runtime, guest, stripped.code, expired);
      if (typed.settled) {
        return typed.packed && { ...typed.packed, line: undefined };
      }
    }

    // Both failed. The JavaScript parser stops at the first type annotation, so
    // when the TypeScript parser got further, its error is the one that matters.
    if (stripped && "error" in stripped && stripped.error.line > (direct.parseError.line ?? 0)) {
      return {
        ok: false,
        text: `SyntaxError: ${stripped.error.message}`,
        line: stripped.error.line,
        truncated: false,
      };
    }

    return direct.parseError;
  }

  /**
   * Finds the reading of the code that parses, in this order: one expression
   * (`1 + 1`, `{ a: 1 }`), a script whose last statement is the result
   * (`const a = 1; a + 1`), the body of a function (`return`, top-level `await`).
   *
   * The first and last are wrapped in an async function, so evaluating them can
   * only throw a parse error. A script can throw anything, so it is compiled
   * without running first: a SyntaxError from `JSON.parse` must not send the
   * code round again.
   */
  private readCode(
    context: QuickJSContext,
    runtime: QuickJSRuntime,
    guest: Guest,
    code: string,
    expired: () => boolean,
  ): Attempt {
    const attempts: Array<() => Attempt> = [
      () => this.attemptWrapped(context, runtime, guest, wrapAsExpression(code), expired),
      () => this.attemptScript(context, runtime, guest, code, expired),
      () => this.attemptWrapped(context, runtime, guest, wrapAsStatements(code), expired),
    ];
    let outcome = attempts[0]();
    for (let next = 1; !outcome.settled && next < attempts.length; next++) {
      outcome = attempts[next]();
    }

    return outcome;
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

    return { settled: true, packed: this.settle(context, runtime, guest, evaluated.value, expired) };
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
      : this.settle(context, runtime, guest, evaluated.value, expired);

    return { settled: true, packed };
  }

  /** A parse error means "try the next reading"; anything else is the answer. */
  private afterParseFailure(packed: Packed | undefined): Attempt {
    return packed && isSyntaxError(packed)
      ? { settled: false, parseError: packed }
      : { settled: true, packed };
  }

  /** Evaluates the guest runtime in the context and returns the entry points it hands back. */
  private installGuest(context: QuickJSContext, prepared: Prepared): Guest {
    const { maxLogs, maxLogLength, maxResultLength } = this.options;

    const setup = context.unwrapResult(context.evalCode(guestRuntimeSource, "guest.js"));
    const hostLog = context.newFunction("hostLog", (line) => {
      const text = readString(context, line);
      if (text !== undefined && prepared.logs.length < maxLogs) {
        prepared.logs.push(truncateText(text, maxLogLength).value);
      }
    });
    // Hands the guest the source of a part it asked for by name. Nothing else
    // crosses: the names are fixed in the guest runtime and the sources are ours.
    // Where the guest's random numbers start from. It goes in; nothing comes out.
    const seed = Array.from(crypto.getRandomValues(new Uint32Array(4)));
    const loadExtra = context.newFunction("loadExtra", (name) => {
      const source = guestExtras[readString(context, name) ?? ""];
      return context.newString(source ?? "");
    });
    const api = context.unwrapResult(
      context.callFunction(
        setup,
        context.undefined,
        hostLog,
        loadExtra,
        context.newNumber(maxLogs),
        context.newNumber(maxLogLength),
        context.newNumber(maxResultLength),
        ...seed.map((word) => context.newNumber(word)),
      ),
    );

    return {
      finish: context.getProp(api, "finish"),
      tick: context.getProp(api, "tick"),
      fail: context.getProp(api, "fail"),
    };
  }

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

  /**
   * Runs the promise jobs, then fires the guest's timers one at a time, earliest
   * first, running the jobs each one leaves behind, until no timer is left. A
   * timer whose callback throws ends the run with that error.
   */
  private runTimers(
    context: QuickJSContext,
    runtime: QuickJSRuntime,
    guest: Guest,
    expired: () => boolean,
  ): Packed | undefined {
    for (;;) {
      drainPendingJobs(runtime, expired);
      if (expired()) {
        throw new Error("InternalError: interrupted");
      }

      const ticked = context.callFunction(guest.tick, context.undefined);
      if (ticked.error) {
        return this.packFailure(context, guest.fail, ticked.error) ?? { ok: false, text: UNREADABLE_MESSAGE, truncated: false };
      }

      const fired = context.dump(ticked.value) === true;
      ticked.value.dispose();
      if (!fired) {
        return undefined;
      }
    }
  }

  /** Lets the code's promise run to completion, then reads what the guest packed. */
  private settle(
    context: QuickJSContext,
    runtime: QuickJSRuntime,
    guest: Guest,
    pending: QuickJSHandle,
    expired: () => boolean,
  ): Packed | undefined {
    const called = context.callFunction(guest.finish, context.undefined, pending);
    pending.dispose();

    if (called.error) {
      called.error.dispose();
      return undefined;
    }

    const settled = called.value;
    try {
      const timerFailure = this.runTimers(context, runtime, guest, expired);
      if (timerFailure) {
        return timerFailure;
      }

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
