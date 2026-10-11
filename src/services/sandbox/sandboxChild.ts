// Entry point of the process that runs guest code. It is started by
// ProcessSandboxService, talks to it over the IPC channel, and exits when that
// channel closes, so it cannot outlive the bot.
import type { ChildRequest, ChildResponse } from "./childProtocol";
import { QuickJsSandboxService } from "./quickjsSandbox";

let sandbox: QuickJsSandboxService | undefined;

function reply(message: ChildResponse): void {
  process.send?.(message);
}

process.on("disconnect", () => process.exit(0));

process.on("message", async (message: ChildRequest) => {
  if (message.type === "init") {
    sandbox = new QuickJsSandboxService(message.options);
    await sandbox.warmUp();
    reply({ type: "ready" });
    return;
  }

  if (!sandbox) {
    throw new Error("Sandbox process received code before it was initialised");
  }

  const execution = await sandbox.execute(message.code);
  reply({ type: "result", id: message.id, execution });
});
