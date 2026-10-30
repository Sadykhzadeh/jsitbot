import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function show(code: string): Promise<string> {
  const execution = await sandbox.execute(code);

  return execution.ok ? execution.result : `error: ${execution.error}`;
}

async function logged(code: string): Promise<string[]> {
  const execution = await sandbox.execute(code);

  return execution.logs;
}

describe("result formatting", () => {
  const cases: Array<[string, string, string]> = [
    ["a string is shown as it is", `"hello"`, "hello"],
    ["numbers", `[1, -0, NaN, Infinity, 1.5, 5e21, 1e-7]`, "[ 1, -0, NaN, Infinity, 1.5, 5e+21, 1e-7 ]"],
    ["bigint", `[10n, -3n]`, "[ 10n, -3n ]"],
    ["undefined, null and booleans", `[undefined, null, true, false]`, "[ undefined, null, true, false ]"],
    ["strings are quoted inside containers", `["a", 'it\\'s', "say \\"hi\\"", "tab\\there", "two\\nlines"]`, `[ 'a', "it's", 'say "hi"', 'tab\\there', 'two\\nlines' ]`],
    ["symbols", `[Symbol("tag"), Symbol()]`, "[ Symbol(tag), Symbol() ]"],
    ["empty array and object", `[[], {}]`, "[ [], {} ]"],
    ["objects", `({ a: 1, b: "x", c: [1, 2], d: { e: null } })`, "{ a: 1, b: 'x', c: [ 1, 2 ], d: { e: null } }"],
    ["keys that are not identifiers are quoted", `({ "a-b": 1, 2: 3, valid_id: 4 })`, "{ '2': 3, 'a-b': 1, valid_id: 4 }"],
    ["symbol keys", `({ [Symbol("k")]: 1 })`, "{ [Symbol(k)]: 1 }"],
    ["array holes", `[1, , 3, , , 6]`, "[ 1, <1 empty item>, 3, <2 empty items>, 6 ]"],
    ["a sparse array", `new Array(5)`, "[ <5 empty items> ]"],
    ["maps", `new Map([["a", 1], ["b", { c: 2 }]])`, "Map(2) { 'a' => 1, 'b' => { c: 2 } }"],
    ["sets", `new Set([1, "two", [3]])`, "Set(3) { 1, 'two', [ 3 ] }"],
    ["empty collections", `[new Map(), new Set()]`, "[ Map(0) {}, Set(0) {} ]"],
    ["dates", `[new Date(0), new Date(NaN)]`, "[ 1970-01-01T00:00:00.000Z, Invalid Date ]"],
    ["regular expressions", `/ab+c/gi`, "/ab+c/gi"],
    ["typed arrays", `new Uint8Array([1, 2, 3])`, "Uint8Array(3) [ 1, 2, 3 ]"],
    ["array buffers", `new ArrayBuffer(8)`, "ArrayBuffer { byteLength: 8 }"],
    ["boxed primitives", `[new Number(3), new String("s"), new Boolean(false)]`, "[ [Number: 3], [String: 's'], [Boolean: false] ]"],
    ["weak collections", `[new WeakMap(), new WeakSet()]`, "[ WeakMap { <items unknown> }, WeakSet { <items unknown> } ]"],
    ["functions", `[function f() {}, () => 1, async () => {}]`, "[ [Function: f], [Function (anonymous)], [AsyncFunction (anonymous)] ]"],
    ["a method whose name starts with class is not a class", `({ classify() {} })`, "{ classify: [Function: classify] }"],
    ["generator functions", `[function* g() {}, async function* h() {}]`, "[ [GeneratorFunction: g], [AsyncGeneratorFunction: h] ]"],
    ["classes and their instances", `class A {} class B extends A { constructor() { super(); this.x = 1 } } return [A, B, new B()]`, "[ [class A], [class B extends A], B { x: 1 } ]"],
    ["accessors are not invoked", `({ get a() { throw new Error("no") }, set b(v) {}, get c() { return 1 }, set c(v) {} })`, "{ a: [Getter], b: [Setter], c: [Getter/Setter] }"],
    ["objects without a prototype", `Object.assign(Object.create(null), { a: 1 })`, "[Object: null prototype] { a: 1 }"],
    ["inherited properties are left out", `Object.create({ inherited: 1 })`, "{}"],
    ["built-in namespaces", `[Math, JSON]`, "[ Object [Math] {}, Object [JSON] {} ]"],
    ["a promise's value, once it settled", `Promise.resolve({ ok: true })`, "{ ok: true }"],
    ["errors inside containers", `({ e: new TypeError("bad") })`, "{ e: [TypeError: bad] }"],
    ["an error on its own", `new RangeError("out")`, "RangeError: out"],
    ["the properties added to an error", `Object.assign(new Error("bad"), { code: 42 })`, "Error: bad { code: 42 }"],
    ["the properties of an error inside a container", `[Object.assign(new Error("bad"), { code: 42 })]`, "[ [Error: bad] { code: 42 } ]"],
    ["the name of an error set by its class is not repeated", `new (class HttpError extends Error { constructor(m) { super(m); this.name = "HttpError"; this.status = 404 } })("gone")`, "HttpError: gone { status: 404 }"],
    ["the cause of an error", `[new Error("outer", { cause: "inner" })]`, "[ [Error: outer] { [cause]: 'inner' } ]"],
    ["a thenable is awaited", `({ then(resolve) { resolve("from thenable") } })`, "from thenable"],
    ["self references", `const o = { name: "o" }; o.self = o; return o`, "{ name: 'o', self: [Circular] }"],
    ["self references in arrays and maps", `const a = [1]; a.push(a); const m = new Map(); m.set("k", m); return [a, m]`, "[ [ 1, [Circular] ], Map(1) { 'k' => [Circular] } ]"],
    ["depth is limited", `({ a: { b: { c: { d: { e: 1 } } } } })`, "{ a: { b: { c: { d: [Object] } } } }"],
    ["deep arrays are limited too", `[[[[[1]]]]]`, "[ [ [ [ [Array] ] ] ] ]"],
    ["a long list of numbers is packed into rows", `Array.from({ length: 30 }, (_, i) => i * 1000)`, [
      "[",
      "  0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000,",
      "  12000, 13000, 14000, 15000, 16000, 17000, 18000, 19000, 20000, 21000,",
      "  22000, 23000, 24000, 25000, 26000, 27000, 28000, 29000",
      "]",
    ].join("\n")],
    ["a list of objects gets a line each", `Array.from({ length: 3 }, (_, i) => ({ id: i, name: "user" + i, tags: ["a", "b", "c"] }))`, [
      "[",
      "  { id: 0, name: 'user0', tags: [ 'a', 'b', 'c' ] },",
      "  { id: 1, name: 'user1', tags: [ 'a', 'b', 'c' ] },",
      "  { id: 2, name: 'user2', tags: [ 'a', 'b', 'c' ] }",
      "]",
    ].join("\n")],
    ["long properties go on their own lines", `({ first: "x".repeat(40), second: "y".repeat(40) })`, [
      "{",
      `  first: '${"x".repeat(40)}',`,
      `  second: '${"y".repeat(40)}'`,
      "}",
    ].join("\n")],
    ["more than a hundred items are summarised", `Array.from({ length: 120 }, (_, i) => i)`, "... 20 more items"],
    ["the match of a regular expression keeps its index and input", `/(\\d)/.exec("a1")`, "[ '1', '1', index: 1, input: 'a1', groups: undefined ]"],
    ["properties added to a function", `function f() {} f.calls = 2; f`, "[Function: f] { calls: 2 }"],
    ["properties added to a class", `class A { static count = 1 } A`, "[class A] { count: 1 }"],
    ["properties added to an array", `Object.assign([1, 2], { label: "x" })`, "[ 1, 2, label: 'x' ]"],
    ["properties added to a map and a set", `[Object.assign(new Map([[1, 2]]), { a: 1 }), Object.assign(new Set([1]), { b: 2 })]`, "[ Map(1) { 1 => 2, a: 1 }, Set(1) { 1, b: 2 } ]"],
    ["properties added to a date and a regular expression", `[Object.assign(new Date(0), { a: 1 }), Object.assign(/x/, { b: 2 })]`, "[ 1970-01-01T00:00:00.000Z { a: 1 }, /x/ { b: 2 } ]"],
    ["a subclass of Array", `class Stack extends Array {} Stack.from([1, 2])`, "Stack(2) [ 1, 2 ]"],
    ["an empty subclass of Array", `class Stack extends Array {} new Stack()`, "Stack(0) []"],
    ["subclasses of Map and Set", `class Registry extends Map {} class Tags extends Set {} [new Registry([[1, 2]]), new Tags([3])]`, "[ Registry(1) [Map] { 1 => 2 }, Tags(1) [Set] { 3 } ]"],
    ["a function that holds itself", `const f = () => {}; f.self = f; f`, "[Function: f] { self: [Circular] }"],
  ];

  for (const [name, code, expected] of cases) {
    test(name, async () => {
      const text = await show(code);

      if (expected.startsWith("... ")) {
        expect(text).toContain(expected);
      } else {
        expect(text).toBe(expected);
      }
    });
  }
});

describe("thrown values", () => {
  const cases: Array<[string, string, string]> = [
    ["an error", `throw new Error("thrown")`, "error: Error: thrown"],
    ["a subclass keeps its name", `throw new (class MyError extends Error { constructor(m) { super(m); this.name = "MyError" } })("custom")`, "error: MyError: custom"],
    ["an error without a message", `const e = new Error("x"); e.message = ""; throw e`, "error: Error"],
    ["a string", `throw "oops"`, "error: Uncaught 'oops'"],
    ["an object", `throw { code: 42, reason: "no" }`, "error: Uncaught { code: 42, reason: 'no' }"],
    ["null", `throw null`, "error: Uncaught null"],
    ["undefined", `throw undefined`, "error: Uncaught undefined"],
    ["a number", `throw 404`, "error: Uncaught 404"],
    ["a rejected promise", `await Promise.reject(new TypeError("rejected"))`, "error: TypeError: rejected"],
    ["an error from a function", `function fail() { throw new RangeError("deep") } fail()`, "error: RangeError: deep"],
  ];

  for (const [name, code, expected] of cases) {
    test(name, async () => {
      expect(await show(code)).toBe(expected);
    });
  }
});

describe("console", () => {
  test("formats objects the same way results are formatted", async () => {
    expect(await logged(`console.log({ a: [1, 2] }, new Map([[1, 2]]), "plain", 5)`)).toEqual([
      "{ a: [ 1, 2 ] } Map(1) { 1 => 2 } plain 5",
    ]);
  });

  test("info, warn, error, debug and dir work too", async () => {
    expect(await logged(`
      console.info("info"); console.warn("warn"); console.error("error");
      console.debug("debug"); console.dir({ x: 1 });
    `)).toEqual(["info", "warn", "error", "debug", "{ x: 1 }"]);
  });

  test("logging nothing gives an empty line", async () => {
    expect(await logged(`console.log()`)).toEqual([""]);
  });

  test("keeps the order of calls across awaits", async () => {
    expect(await logged(`
      console.log(1);
      await Promise.resolve();
      console.log(2);
      await null;
      console.log(3);
    `)).toEqual(["1", "2", "3"]);
  });

  test("survives values that cannot be printed", async () => {
    expect(await logged(`
      console.log(new Proxy({}, { ownKeys() { throw new Error("trap") } }));
      console.log({ get a() { throw new Error("getter") } });
      console.log("after");
    `)).toEqual(["[Unformattable object]", "{ a: [Getter] }", "after"]);
  });
});
