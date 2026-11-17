import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

describe("timers, immediates and microtasks, checked against Node 26.13", () => {
  test("run in the order Node runs them, across all the kinds at once", async () => {
    const result = await sandbox.execute("(async () => {\nconst log = [];\nconst note = (x) => log.push(x);\nsetTimeout(() => note(\"t20\"), 20);\nsetTimeout(() => note(\"t10\"), 10);\nsetTimeout(() => note(\"t10b\"), 10);\nsetImmediate(() => note(\"imm1\"));\nqueueMicrotask(() => note(\"qm1\"));\nPromise.resolve().then(() => note(\"p1\")).then(() => note(\"p2\"));\nnote(\"sync\");\nsetImmediate(() => {\n  note(\"imm2\");\n  queueMicrotask(() => note(\"qm-in-imm\"));\n  setImmediate(() => note(\"imm-nested\"));\n});\nsetTimeout(() => {\n  note(\"t5\");\n  Promise.resolve().then(() => note(\"p-in-t5\"));\n  queueMicrotask(() => note(\"qm-in-t5\"));\n}, 5);\nlet n = 0;\nconst h = setInterval(() => {\n  note(\"iv\" + ++n);\n  if (n === 3) clearInterval(h);\n}, 7);\n(async () => {\n  note(\"a0\");\n  await null;\n  note(\"a1\");\n  await new Promise((r) => setTimeout(r, 50));\n  note(\"a2\");\n})();\nconst cancelled = setTimeout(() => note(\"never\"), 15);\nclearTimeout(cancelled);\nconst cleared = setImmediate(() => note(\"never-imm\"));\nclearImmediate(cleared);\nconst iv = setInterval(() => note(\"ivx\"), 1000);\nclearInterval(iv);\nsetTimeout(() => {\n  note(\"t30\");\n  queueMicrotask(() => note(\"qm-in-t30\"));\n  setImmediate(() => note(\"imm-in-t30\"));\n  setTimeout(() => note(\"t30-plus-1\"), 1);\n}, 30);\nnew Promise((r) => setTimeout(r, 200)).then(() => {\n  console.log(log.join(\" \"));\n});\n\nawait new Promise((r) => setTimeout(r, 200));\nreturn log.join(\" \");\n})()");

    expect(result.ok ? result.result : result.error).toBe("sync a0 qm1 p1 a1 p2 imm1 imm2 qm-in-imm imm-nested t5 p-in-t5 qm-in-t5 iv1 t10 t10b iv2 t20 iv3 t30 qm-in-t30 imm-in-t30 t30-plus-1 a2");
  });
});
