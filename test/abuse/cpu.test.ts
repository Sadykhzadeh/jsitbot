import { afterAll, describe, test } from "bun:test";

import {
  type AbuseCase,
  createPool,
  eitherLimit,
  failsWith,
  result,
  runCase,
  timeLimit,
} from "./support";

// Code that keeps the processor busy: each one ends at the time limit, in a
// clean error, or with a result, and never takes the sandbox down with it.
const cases: AbuseCase[] = [
  { name: "infinite loop", code: "while (true) {}", outcome: timeLimit },
  {
    name: "deep recursion",
    code: "function f(n) { return f(n + 1) + 1; } f(0)",
    outcome: failsWith(/Maximum call stack size exceeded/),
  },
  {
    name: "catastrophic regex backtracking",
    code: `/(a+)+$/.test("a".repeat(30) + "b")`,
    outcome: timeLimit,
  },
  { name: "huge Array join", code: `Array(1e9).join("x").length`, outcome: timeLimit },
  { name: "string repeated to 2^30", code: `"x".repeat(2 ** 30).length`, outcome: failsWith(/invalid string length/i) },
  {
    name: "BigInt power tower",
    code: `(2n ** (2n ** 30n)).toString().length`,
    outcome: failsWith(/BigInt is too large/),
  },
  { name: "sort with a looping comparator", code: `[3, 1, 2].sort(() => { while (true) {} })`, outcome: timeLimit },
  {
    name: "sort with a throwing comparator",
    code: `[3, 1, 2].sort(() => { throw new Error("boom") })`,
    outcome: failsWith(/boom/),
  },
  {
    name: "JSON.stringify of a million levels",
    code: `let o = {}; for (let i = 0; i < 1e6; i++) o = { o }; JSON.stringify(o).length`,
    outcome: eitherLimit,
  },
  {
    name: "generator that never ends, spread",
    code: `function* g() { while (true) yield 1; } [...g()].length`,
    outcome: eitherLimit,
  },
  {
    name: "proxy trap that calls itself",
    code: `const p = new Proxy({}, { get(t, k, r) { return r[k]; } }); p.x`,
    outcome: failsWith(/Maximum call stack size exceeded/),
  },
  {
    name: "getter that calls itself, printed",
    code: `const o = { get a() { return this.a; } }; console.log(o); 1`,
    outcome: result("1"),
  },
  {
    name: "toString that loops, printed",
    code: `console.log({ toString() { while (true) {} } }); 1`,
    outcome: result("1"),
  },
  {
    name: "toString that throws, in a %s",
    code: `console.log("%s", { toString() { throw new Error("x") } }); 1`,
    outcome: result("1"),
  },
  {
    name: "Symbol.toPrimitive that loops",
    code: `const o = { [Symbol.toPrimitive]() { while (true) {} } }; console.log(String(o)); 1`,
    outcome: timeLimit,
  },
  { name: "async loop that awaits forever", code: `for (;;) await 0`, outcome: timeLimit },
  { name: "flood of promises", code: `for (let i = 0; i < 1e6; i++) Promise.resolve(i); 1`, outcome: eitherLimit },
  {
    name: "setTimeout chain of a million",
    code: `let n = 0; function t() { if (++n < 1e6) setTimeout(t, 0); } t(); await new Promise(() => {})`,
    outcome: timeLimit,
  },
  { name: "setInterval with no delay", code: `setInterval(() => {}, 0); 1`, outcome: timeLimit },
];

const pool = createPool();

afterAll(() => pool.dispose());

describe("cpu abuse", () => {
  for (const abuse of cases) {
    test(abuse.name, () => runCase(pool, abuse), 20_000);
  }
});
