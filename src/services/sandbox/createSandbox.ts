import { ProcessSandboxService } from "./processSandbox";
import { QuickJsSandboxService } from "./quickjsSandbox";
import type { SandboxOptions, SandboxService } from "./types";

/**
 * Prefers the sandbox that runs in a separate process, whose deadline cannot be
 * ignored. If a process cannot be started in this environment, falls back to
 * running QuickJS inside the bot, which still has its interrupt handler and
 * memory cap, and says so.
 */
export async function createSandbox(options: Partial<SandboxOptions>): Promise<SandboxService> {
  const isolated = new ProcessSandboxService(options);

  try {
    await isolated.warmUp();
    return isolated;
  } catch (error) {
    console.error("Sandbox process is unavailable, running guest code inside the bot:", error);
    await isolated.dispose();

    const local = new QuickJsSandboxService(options);
    await local.warmUp();
    return local;
  }
}
