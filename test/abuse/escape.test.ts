import { afterAll, describe, expect, test } from "bun:test";

import { type AbuseCase, createPool, expectBounded, expectHealthy, failsWith, result, runCase } from "./support";

// Attempts to reach the host from the guest. Everything the guest can see is
// inside its own QuickJS runtime: none of these should find a Node or Bun host
// object, a module loader, or anything that waits on the host.
const cases: AbuseCase[] = [
  {
    name: "constructor.constructor reaching the global object",
    code: `[].constructor.constructor("return typeof process")()`,
    outcome: result("undefined"),
  },
  {
    name: "Function constructor reaching process",
    code: `Function("return typeof process")()`,
    outcome: result("undefined"),
  },
  {
    name: "Function constructor reaching require, Bun and Deno",
    code: `Function("return typeof require + typeof Bun + typeof Deno")()`,
    outcome: result("undefinedundefinedundefined"),
  },
  {
    name: "indirect eval reaching process",
    code: `eval("typeof process + typeof require")`,
    outcome: result("undefinedundefined"),
  },
  {
    name: "host globals looked up by name",
    code: `[typeof globalThis.process, typeof globalThis.Bun, typeof globalThis.require].join()`,
    outcome: result("undefined,undefined,undefined"),
  },
  {
    name: "dynamic import of a Node module",
    code: `await import("node:fs")`,
    outcome: failsWith(/could not load module 'node:fs'/),
  },
  { name: "require of a Node module", code: `require("fs")`, outcome: failsWith(/require is not defined/) },
  {
    name: "Atomics.wait on a shared buffer",
    code: `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1e9)`,
    outcome: failsWith(/Atomics is not defined/),
  },
  {
    name: "Error.prepareStackTrace that never returns",
    code: `Error.prepareStackTrace = () => { while (true) {} }; new Error("x").stack`,
    outcome: result(/at <eval> \(input\.js:1:/),
  },
  {
    name: "Error.prepareStackTrace that receives frames",
    code: `Error.prepareStackTrace = (e, frames) => frames; typeof new Error("x").stack`,
    outcome: result("string"),
  },
  {
    name: "Symbol.species that returns a plain object",
    code: `class A extends Array { static get [Symbol.species]() { return function () { return {} } } } new A(1, 2).map((x) => x).length`,
    outcome: result("undefined"),
  },
  {
    name: "console.log replaced, console.error still shown",
    code: `console.log = () => {}; console.error("shown"); 1`,
    outcome: result("1"),
  },
  {
    name: "stack overflow inside a replace callback",
    code: `function f() { return "x".replace(/x/, f) } "x".replace(/x/, f)`,
    outcome: failsWith(/Maximum call stack size exceeded/),
  },
  {
    name: "stack overflow inside a toJSON",
    code: `const o = { toJSON() { return JSON.stringify(this) } }; JSON.stringify(o)`,
    outcome: failsWith(/Maximum call stack size exceeded/),
  },
  {
    name: "built-in prototype changed in the same run",
    code: `Object.prototype.hack = 1; ({}).hack`,
    outcome: result("1"),
  },
];

// Changes made to built-ins in one run, and what the next run finds. Each run
// has a runtime of its own, so none of these may show up in the next one.
const pollutions: Array<{ name: string; pollute: string }> = [
  {
    name: "prototypes of Object, Array and Function",
    pollute: `Object.prototype.polluted = 1; Array.prototype.polluted = 2; Function.prototype.polluted = 3; "done"`,
  },
  {
    name: "console and Promise replaced",
    pollute: `console.log = () => {}; globalThis.Promise = function () {}; "done"`,
  },
  {
    name: "Error.prepareStackTrace and the Error prototype",
    pollute: `Error.prepareStackTrace = () => "hacked"; Error.prototype.message = "hacked"; "done"`,
  },
  {
    name: "Symbol.species and the iterator of arrays",
    pollute: `Object.defineProperty(Array, Symbol.species, { get() { return Object } }); Array.prototype[Symbol.iterator] = function* () { yield "hacked" }; "done"`,
  },
  {
    name: "globalThis replaced with an object",
    pollute: `globalThis.Array = null; globalThis.JSON = { stringify() { return "hacked" } }; "done"`,
  },
];

const check = `
  console.log("visible");
  JSON.stringify([
    typeof ({}).polluted,
    typeof [].polluted,
    typeof (() => 0).polluted,
    typeof Promise,
    typeof Error.prepareStackTrace,
    new Error("x").message,
    [...[1]].join(),
    JSON.stringify({ a: 1 }),
    typeof Array,
  ]);
`;

const pool = createPool();

afterAll(() => pool.dispose());

describe("escape attempts", () => {
  for (const abuse of cases) {
    test(abuse.name, () => runCase(pool, abuse), 20_000);
  }
});

describe("built-ins changed in one run", () => {
  for (const { name, pollute } of pollutions) {
    test(`does not reach the next run: ${name}`, async () => {
      const first = await pool.execute(pollute);
      expect(first.ok).toBe(true);
      expectBounded(first);

      const next = await pool.execute(check);
      expectBounded(next);
      expect(next.ok).toBe(true);
      if (next.ok) {
        expect(next.logs).toEqual(["visible"]);
        expect(next.result).toBe(`["undefined","undefined","undefined","function","undefined","x","1","{\\"a\\":1}","function"]`);
      }
      await expectHealthy(pool);
    }, 20_000);
  }
});
