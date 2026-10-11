import { QuickJsSandboxService } from "./quickjsSandbox";
import type { SandboxOptions, SandboxService } from "./types";
import { WorkerSandboxService } from "./workerSandbox";

/**
 * Prefers the worker-backed sandbox, whose deadline cannot be ignored. If a
 * worker cannot be started in this environment, falls back to running QuickJS on
 * the main thread, which still has its interrupt handler and memory cap, and
 * says so.
 */
export async function createSandbox(options: Partial<SandboxOptions>): Promise<SandboxService> {
  const worker = new WorkerSandboxService(options);

  try {
    await worker.warmUp();
    return worker;
  } catch (error) {
    console.error("Sandbox worker is unavailable, running guest code on the main thread:", error);
    worker.dispose();

    const local = new QuickJsSandboxService(options);
    await local.warmUp();
    return local;
  }
}
