import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function printed(code: string): Promise<string> {
  const execution = await sandbox.execute(`console.log(${code})`);
  expect(execution.ok).toBe(true);

  return execution.logs.join("\n");
}

// The expected texts are what Node's util.inspect prints.
describe("a promise that is printed", () => {
  const cases: Array<[string, string, string]> = [
    ["shows the value it was fulfilled with", `Promise.resolve(42)`, "Promise { 42 }"],
    ["says when it is pending", `new Promise(() => {})`, "Promise { <pending> }"],
    ["shows an object value inside", `[Promise.resolve({ a: 1 }), new Promise(() => {})]`, "[ Promise { { a: 1 } }, Promise { <pending> } ]"],
    ["shows an array value", `Promise.resolve([1, 2])`, "Promise { [ 1, 2 ] }"],
    ["shows the reason it was rejected for", `(() => { const p = Promise.reject(1); p.catch(() => {}); return p })()`, "Promise { <rejected> 1 }"],
    ["shows a rejected promise inside an array", `(() => { const p = Promise.reject("x"); p.catch(() => {}); return [p] })()`, "[ Promise { <rejected> 'x' } ]"],
    ["names a subclass", `new (class Foo extends Promise {})(() => {})`, "Foo [Promise] { <pending> }"],
    ["shows the value of a promise that was resolved with a promise", `Promise.resolve(Promise.resolve(1))`, "Promise { 1 }"],
    ["shows a promise held by an object", `({ p: Promise.resolve(1) })`, "{ p: Promise { 1 } }"],
  ];

  for (const [name, code, expected] of cases) {
    test(name, async () => {
      expect(await printed(code)).toBe(expected);
    });
  }

  test("is pending until the code has awaited something", async () => {
    const execution = await sandbox.execute(`
      const p = (async () => { await null; return "done" })();
      console.log(p);
      await p;
      console.log(p);
    `);

    expect(execution.logs).toEqual(["Promise { <pending> }", "Promise { 'done' }"]);
  });
});
