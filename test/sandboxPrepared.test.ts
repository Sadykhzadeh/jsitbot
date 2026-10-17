import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

// Runtimes are built before they are needed. These tests run programs one right
// after the other, which is when a runtime that was built early could still
// carry something from the program before it.
const sandbox = new QuickJsSandboxService();

describe("runtimes built ahead of time", () => {
  test("console state does not carry from one run to the next", async () => {
    await sandbox.execute(`
      console.count();
      console.count();
      console.group("outer");
      console.log("first run");
    `);
    const second = await sandbox.execute(`console.count(); console.log("second run")`);

    expect(second.logs).toEqual(["default: 1", "second run"]);
  });

  test("a timer left behind does not fire in the next run", async () => {
    await sandbox.execute(`setTimeout(() => console.log("late"), 10); 1`);
    const second = await sandbox.execute(`
      const id = setTimeout(() => {}, 1);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return id;
    `);

    expect(second.logs).toEqual([]);
    expect(second.ok && second.result).toBe("1");
  });

  test("the logs of two runs started together stay apart", async () => {
    const [first, second] = await Promise.all([
      sandbox.execute(`console.log("one"); 1`),
      sandbox.execute(`console.log("two"); 2`),
    ]);

    expect(first.logs).toEqual(["one"]);
    expect(second.logs).toEqual(["two"]);
  });

  test("a run that overflowed the stack or ran out of memory leaves the next one working", async () => {
    await sandbox.execute(`(function f() { return f() + 1 })()`);
    await sandbox.execute(`const kept = []; while (true) kept.push("x".repeat(1024 * 1024))`);
    const after = await sandbox.execute(`[1, 2, 3].map((n) => n * 2)`);

    expect(after.ok && after.result).toBe("[ 2, 4, 6 ]");
  });
});
