import { fileURLToPath } from "node:url";

import type { ChildRequest, ChildResponse } from "./childProtocol";
import {
  resolveSandboxOptions,
  type SandboxExecution,
  type SandboxOptions,
  type SandboxService,
} from "./types";

// How long past its own timeout a run may take to report back before the
// process is considered stuck. The guest's interrupt handler normally ends a
// run at the timeout; this covers work it cannot interrupt, such as a single
// native call that loops for seconds.
const HARD_KILL_GRACE_MS = 400;

const START_TIMEOUT_MS = 10_000;

const CHILD_ENTRY = fileURLToPath(new URL("./sandboxChild.ts", import.meta.url));

// The only parts of the environment the child gets. In particular it does not
// get the bot token, or anything else the bot was configured with.
const CHILD_ENV_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "USERPROFILE",
  "LANG",
];

export function childEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};

  for (const key of CHILD_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }

  return environment;
}

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

interface Child {
  process: Bun.Subprocess;
  /** Runs that have been sent to this child and not answered yet. */
  pending: Map<number, (execution: SandboxExecution) => void>;
  /** Set when the service ends the process itself, as opposed to it dying. */
  killed: boolean;
}

/**
 * Runs guest code in a child process so a stuck run can be killed. The
 * interrupt handler cannot stop a native call that never returns to the
 * interpreter (joining a 2**28-element array), and a worker thread cannot be
 * taken out of one either. A run that has not reported back shortly after its
 * timeout gets its process killed and a fresh one started.
 *
 * The child also has its own memory and none of the bot's environment. Runs go
 * one at a time, in arrival order.
 */
export class ProcessSandboxService implements SandboxService {
  private child: Promise<Child> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private nextId = 0;

  private readonly options: SandboxOptions;

  constructor(options?: Partial<SandboxOptions>) {
    this.options = resolveSandboxOptions(options);
  }

  warmUp(): Promise<void> {
    return this.ensureChild().then(() => undefined);
  }

  execute(code: string): Promise<SandboxExecution> {
    const run = this.queue.then(() => this.runInChild(code));
    this.queue = run.catch(() => undefined);

    return run;
  }

  async dispose(): Promise<void> {
    const current = this.child;
    this.child = undefined;

    const child = await current?.catch(() => undefined);
    if (child) {
      child.killed = true;
      child.process.kill("SIGKILL");
      await child.process.exited;
    }
  }

  private ensureChild(): Promise<Child> {
    if (!this.child) {
      const starting: Promise<Child> = this.startChild(() => {
        // Whatever the reason, the next run needs a new process.
        if (this.child === starting) {
          this.child = undefined;
        }
      });
      this.child = starting;
      starting.catch(() => {
        if (this.child === starting) {
          this.child = undefined;
        }
      });
    }

    return this.child;
  }

  private startChild(onGone: () => void): Promise<Child> {
    return new Promise((resolve, reject) => {
      const pending = new Map<number, (execution: SandboxExecution) => void>();
      let ready = false;

      const timer = setTimeout(() => {
        child.killed = true;
        child.process.kill("SIGKILL");
        reject(new Error("Sandbox process did not start in time"));
      }, START_TIMEOUT_MS);

      const subprocess = Bun.spawn([process.execPath, "run", CHILD_ENTRY], {
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
        env: childEnvironment(),
        ipc: (message: ChildResponse) => {
          if (message.type === "ready") {
            ready = true;
            clearTimeout(timer);
            resolve(child);
          } else {
            pending.get(message.id)?.(message.execution);
          }
        },
        onExit: (_process, exitCode, signalCode) => {
          clearTimeout(timer);
          onGone();

          if (!ready) {
            reject(new Error(`Sandbox process exited before it was ready (${signalCode ?? exitCode})`));
          }

          // Whatever was still running when it went away has no answer coming.
          if (!child.killed && pending.size > 0) {
            console.error("Sandbox process died while running guest code:", signalCode ?? exitCode);
          }
          for (const answer of [...pending.values()]) {
            answer(failure("The sandbox crashed while running this code.", performance.now(), false));
          }
        },
      });
      const child: Child = { process: subprocess, pending, killed: false };

      const init: ChildRequest = { type: "init", options: this.options };
      subprocess.send(init);
    });
  }

  private async runInChild(code: string): Promise<SandboxExecution> {
    const startedAt = performance.now();
    let child: Child;

    try {
      child = await this.liveChild();
    } catch (error) {
      console.error("Sandbox process could not be started:", error);
      return failure("The sandbox is unavailable. Try again in a moment.", startedAt, false);
    }

    // The child may have been busy being replaced: waiting for it is not the
    // guest's time.
    const runStartedAt = performance.now();
    const id = ++this.nextId;

    return new Promise<SandboxExecution>((resolve) => {
      const settle = (execution: SandboxExecution) => {
        clearTimeout(timer);
        child.pending.delete(id);
        resolve(execution);
      };

      const timer = setTimeout(() => {
        this.replaceChild(child);
        settle(failure("Sandbox execution timed out.", runStartedAt, true));
      }, this.options.timeoutMs + HARD_KILL_GRACE_MS);

      child.pending.set(id, settle);

      const request: ChildRequest = { type: "run", id, code };
      try {
        child.process.send(request);
      } catch (error) {
        // The process went away between being chosen and being written to.
        console.error("Sandbox process could not be reached:", error);
        this.child = undefined;
        settle(failure("The sandbox crashed while running this code.", runStartedAt, false));
      }
    });
  }

  /** The current child, replaced first if it has died since it was started. */
  private async liveChild(): Promise<Child> {
    const child = await this.ensureChild();
    if (child.process.exitCode === null && child.process.signalCode === null) {
      return child;
    }

    this.child = undefined;
    return this.ensureChild();
  }

  /** Kills a child that did not answer in time and starts its replacement. */
  private replaceChild(child: Child): void {
    this.child = undefined;
    child.killed = true;
    child.process.kill("SIGKILL");

    // Start the replacement now so the next run does not wait for it.
    this.ensureChild().catch(() => undefined);
  }
}
