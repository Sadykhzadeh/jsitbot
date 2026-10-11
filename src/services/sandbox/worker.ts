import { QuickJsSandboxService } from "./quickjsSandbox";
import type { WorkerRequest, WorkerResponse } from "./workerProtocol";

declare const self: {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

let sandbox: QuickJsSandboxService | undefined;

self.onmessage = async (event) => {
  const message = event.data;

  if (message.type === "init") {
    sandbox = new QuickJsSandboxService(message.options);
    await sandbox.warmUp();
    self.postMessage({ type: "ready" });
    return;
  }

  if (!sandbox) {
    throw new Error("Sandbox worker received code before it was initialised");
  }

  const execution = await sandbox.execute(message.code);
  self.postMessage({ type: "result", id: message.id, execution });
};
