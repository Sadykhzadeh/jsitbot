import {
  resolveSandboxOptions,
  type SandboxExecution,
  type SandboxOptions,
  type SandboxService,
} from "./types";
import type { WorkerRequest, WorkerResponse } from "./workerProtocol";

// How long past its own timeout a run may take to report back before the
// worker is considered stuck. The guest's interrupt handler normally ends a
// run at the timeout; this covers work it cannot interrupt, such as a single
// native call that loops for seconds.
const HARD_KILL_GRACE_MS = 400;

const START_TIMEOUT_MS = 10_000;

function failure(error: string, startedAt: number, timedOut: boolean): SandboxExecution {
  return {
    ok: false,
    logs: [],
    error,
    durationMs: Math.round(performance.now() - startedAt),
    timedOut,
    truncated: false,
  };
}

/**
 * Runs guest code on a separate thread that can be killed.
 *
 * QuickJS stops runaway JavaScript through its interrupt handler, but a native
 * call that never returns to the interpreter (joining a 2**28-element array,
 * for instance) ignores it and would freeze the whole bot for seconds. Here the
 * deadline is enforced from outside: a run that has not reported back shortly
 * after its timeout gets its thread terminated and a fresh one started.
 *
 * Runs are executed one at a time, in the order they arrive.
 */
export class WorkerSandboxService implements SandboxService {
  private worker: Promise<Worker> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private nextId = 0;

  private readonly options: SandboxOptions;

  constructor(options?: Partial<SandboxOptions>) {
    this.options = resolveSandboxOptions(options);
  }

  warmUp(): Promise<void> {
    return this.ensureWorker().then(() => undefined);
  }

  execute(code: string): Promise<SandboxExecution> {
    const run = this.queue.then(() => this.runOnWorker(code));
    this.queue = run.catch(() => undefined);

    return run;
  }

  dispose(): void {
    const current = this.worker;
    this.worker = undefined;
    current?.then((worker) => worker.terminate(), () => undefined);
  }

  private ensureWorker(): Promise<Worker> {
    if (!this.worker) {
      const starting = this.startWorker();
      this.worker = starting;
      starting.catch(() => {
        if (this.worker === starting) {
          this.worker = undefined;
        }
      });
    }

    return this.worker;
  }

  private startWorker(): Promise<Worker> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
      const abandon = (reason: string) => {
        clearTimeout(timer);
        worker.terminate();
        reject(new Error(reason));
      };
      const timer = setTimeout(() => abandon("Sandbox worker did not start in time"), START_TIMEOUT_MS);

      // The worker must not keep the process alive on its own.
      (worker as Worker & { unref(): void }).unref();
      worker.onerror = (event) => abandon(`Sandbox worker failed to start: ${event.message}`);
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type !== "ready") {
          return;
        }

        clearTimeout(timer);
        worker.onerror = null;
        worker.onmessage = null;
        resolve(worker);
      };

      const init: WorkerRequest = { type: "init", options: this.options };
      worker.postMessage(init);
    });
  }

  private async runOnWorker(code: string): Promise<SandboxExecution> {
    const startedAt = performance.now();
    let worker: Worker;

    try {
      worker = await this.ensureWorker();
    } catch (error) {
      console.error("Sandbox worker could not be started:", error);
      return failure("The sandbox is unavailable. Try again in a moment.", startedAt, false);
    }

    // The worker may have been busy being replaced: waiting for it is not the
    // guest's time.
    const runStartedAt = performance.now();
    const id = ++this.nextId;

    return new Promise<SandboxExecution>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const settle = (execution: SandboxExecution) => {
        clearTimeout(timer);
        worker.onmessage = null;
        worker.onerror = null;
        resolve(execution);
      };
      const replaceWorker = () => {
        if (this.worker) {
          this.worker = undefined;
        }

        worker.terminate();
        // Start the replacement now so the next run does not wait for it.
        this.ensureWorker().catch(() => undefined);
      };

      timer = setTimeout(() => {
        replaceWorker();
        settle(failure("Sandbox execution timed out.", runStartedAt, true));
      }, this.options.timeoutMs + HARD_KILL_GRACE_MS);

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === "result" && event.data.id === id) {
          settle(event.data.execution);
        }
      };
      worker.onerror = (event) => {
        console.error("Sandbox worker crashed:", event.message);
        replaceWorker();
        settle(failure("The sandbox crashed while running this code.", runStartedAt, false));
      };

      const request: WorkerRequest = { type: "run", id, code };
      worker.postMessage(request);
    });
  }
}
