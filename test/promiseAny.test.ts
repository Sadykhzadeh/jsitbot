import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function logs(code: string): Promise<string[]> {
  const execution = await sandbox.execute(code);

  expect(execution.ok).toBe(true);
  return execution.logs;
}

describe("Promise.any", () => {
  test("rejects with the message Node gives", async () => {
    expect(
      await logs(`
        await Promise.any([Promise.reject(1), Promise.reject(2)]).catch((e) => {
          console.log(e instanceof AggregateError, e.name, e.message, e.errors);
        });
      `),
    ).toEqual(["true AggregateError All promises were rejected [ 1, 2 ]"]);
  });

  test("says so when nothing is left uncaught", async () => {
    const execution = await sandbox.execute(`await Promise.any([])`);

    expect(execution.ok).toBe(false);
    expect(execution.ok ? "" : execution.error).toBe("AggregateError: All promises were rejected");
  });

  test("still resolves with the first value", async () => {
    expect(await logs(`console.log(await Promise.any([Promise.reject(1), 2, new Promise(() => {})]))`)).toEqual(["2"]);
  });

  test("keeps its name and length", async () => {
    expect(await logs(`console.log(Promise.any.name, Promise.any.length, Object.keys(Promise).length)`)).toEqual(["any 1 0"]);
  });

  test("leaves an AggregateError of the program's own alone", async () => {
    expect(await logs(`console.log(JSON.stringify(new AggregateError([], "mine").message), JSON.stringify(new AggregateError([]).message))`)).toEqual([
      '"mine" ""',
    ]);
  });
});
