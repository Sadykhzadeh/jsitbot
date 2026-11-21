import { afterAll, describe, test } from "bun:test";

import { type AbuseCase, createPool, eitherLimit, failsWith, memoryLimit, result, runCase } from "./support";

// Code that tries to use up the guest's memory. Each run has a heap capped at
// 64 MB, so every case ends at the memory limit or with an error from the
// engine that refuses the allocation, and the next run starts from nothing.
// Cases that fill the heap slowly may end at the time limit on a busy machine
// instead; those accept either ending.
const cases: AbuseCase[] = [
  {
    name: "array doubled until it fails",
    code: `let a = [1]; while (true) a = a.concat(a); a.length`,
    outcome: eitherLimit,
  },
  {
    name: "string doubled until it fails",
    code: `let s = "x"; while (true) s += s; s.length`,
    outcome: memoryLimit,
  },
  {
    name: "ArrayBuffer of 2^31 bytes",
    code: `new ArrayBuffer(2 ** 31).byteLength`,
    outcome: failsWith(/invalid array buffer length/),
  },
  {
    name: "Map with ten million entries",
    code: `const m = new Map(); for (let i = 0; i < 1e7; i++) m.set(i, i); m.size`,
    outcome: eitherLimit,
  },
  {
    name: "closures that keep a string alive",
    code: `const fs = []; const s = "x".repeat(1e6); while (true) fs.push(() => s + fs.length)`,
    outcome: eitherLimit,
  },
  {
    name: "typed array doubled until it fails",
    code: `let t = new Uint8Array(1); while (true) t = new Uint8Array(t.length * 2); t.length`,
    outcome: eitherLimit,
  },
  {
    name: "an array of a hundred million strings",
    code: `new Array(1e8).fill("x").length`,
    outcome: memoryLimit,
  },
  {
    name: "a string split into characters",
    code: `"x".repeat(2 ** 26).split("").length`,
    outcome: eitherLimit,
  },
  {
    name: "an object with a million keys",
    code: `const o = {}; for (let i = 0; i < 1e6; i++) o["k" + i] = i; Object.keys(o).length`,
    outcome: eitherLimit,
  },
  {
    name: "WebAssembly memory",
    code: `new WebAssembly.Memory({ initial: 65536 }).buffer.byteLength`,
    outcome: failsWith(/WebAssembly is not defined/),
  },
  {
    name: "WebAssembly module from bytes",
    code: `new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])) && "ok"`,
    outcome: failsWith(/WebAssembly is not defined/),
  },
  {
    name: "sparse array with the largest length",
    code: `const a = []; a[2 ** 32 - 2] = 1; a.length`,
    outcome: result("4294967295"),
  },
];

// A clock that a loaded machine does not run out of first, so a case that
// fills the heap ends on the memory cap. The time limit has its own cases.
const pool = createPool({ timeoutMs: 10_000 });

afterAll(() => pool.dispose());

describe("memory abuse", () => {
  for (const abuse of cases) {
    test(abuse.name, () => runCase(pool, abuse), 20_000);
  }
});
