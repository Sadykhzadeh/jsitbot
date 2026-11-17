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
    ["a key with a dollar sign is quoted, as Node quotes it", `({ $a: 1, _a1: 2 })`, "{ '$a': 1, _a1: 2 }"],
    ["an own __proto__ key is bracketed, not taken for the prototype", `JSON.parse('{"__proto__": 1, "a": 2}')`, "{ ['__proto__']: 1, a: 2 }"],
    ["symbol keys", `({ [Symbol("k")]: 1 })`, "{ Symbol(k): 1 }"],
    ["a property added to a typed array is shown after its items", `Object.assign(new Uint8Array(2), { tag: "x" })`, "Uint8Array(2) [ 0, 0, tag: 'x' ]"],
    ["a SharedArrayBuffer shows its bytes, as an ArrayBuffer does", `new SharedArrayBuffer(3)`, "SharedArrayBuffer { [Uint8Contents]: <00 00 00>, [byteLength]: 3 }"],
    ["an empty SharedArrayBuffer", `new SharedArrayBuffer(0)`, "SharedArrayBuffer { [Uint8Contents]: <>, [byteLength]: 0 }"],
    ["a quote, backslash or newline in a symbol key is escaped, as Node escapes it", `({ [Symbol("a'b")]: 1, [Symbol("a\\\\b")]: 2, [Symbol("a\\nb")]: 3 })`, "{ Symbol(a\\'b): 1, Symbol(a\\\\b): 2, Symbol(a\\nb): 3 }"],
    ["arguments are shown under their own name", `(function () { return arguments })(1, "a")`, "[Arguments] { '0': 1, '1': 'a' }"],
    ["empty arguments", `(function () { return arguments })()`, "[Arguments] {}"],
    ["a null-prototype array says so", `Object.setPrototypeOf([1, 2], null)`, "[Array(2): null prototype] [ 1, 2 ]"],
    ["an empty null-prototype array", `Object.setPrototypeOf([], null)`, "[Array(0): null prototype] []"],
    ["a null-prototype map", `Object.setPrototypeOf(new Map([[1, 2]]), null)`, "[Map(1): null prototype] { 1 => 2 }"],
    ["an empty null-prototype map", `Object.setPrototypeOf(new Map(), null)`, "[Map(0): null prototype] {}"],
    ["a null-prototype set", `Object.setPrototypeOf(new Set([1]), null)`, "[Set(1): null prototype] { 1 }"],
    ["a null-prototype typed array", `Object.setPrototypeOf(new Uint8Array(2), null)`, "[Uint8Array(2): null prototype] [ 0, 0 ]"],
    ["a null-prototype date", `Object.setPrototypeOf(new Date(0), null)`, "[Date: null prototype] 1970-01-01T00:00:00.000Z"],
    ["a null-prototype object", `Object.setPrototypeOf({ a: 1 }, null)`, "[Object: null prototype] { a: 1 }"],
    ["a null-prototype object past the depth limit", `({ a: { b: { c: { d: Object.setPrototypeOf({ q: 1 }, null) } } } })`, "{\n  a: { b: { c: { d: [Object: null prototype] } } }\n}"],
    ["a null-prototype array past the depth limit", `({ a: { b: { c: { d: Object.setPrototypeOf([1], null) } } } })`, "{\n  a: { b: { c: { d: [Array: null prototype] } } }\n}"],
    ["array holes", `[1, , 3, , , 6]`, "[ 1, <1 empty item>, 3, <2 empty items>, 6 ]"],
    ["a sparse array", `new Array(5)`, "[ <5 empty items> ]"],
    ["maps", `new Map([["a", 1], ["b", { c: 2 }]])`, "Map(2) { 'a' => 1, 'b' => { c: 2 } }"],
    ["sets", `new Set([1, "two", [3]])`, "Set(3) { 1, 'two', [ 3 ] }"],
    ["empty collections", `[new Map(), new Set()]`, "[ Map(0) {}, Set(0) {} ]"],
    ["dates", `[new Date(0), new Date(NaN)]`, "[ 1970-01-01T00:00:00.000Z, Invalid Date ]"],
    ["regular expressions", `/ab+c/gi`, "/ab+c/gi"],
    ["typed arrays", `new Uint8Array([1, 2, 3])`, "Uint8Array(3) [ 1, 2, 3 ]"],
    ["array buffers show their bytes", `[new ArrayBuffer(0), new Uint8Array([1, 2, 255]).buffer]`, "[\n  ArrayBuffer { [Uint8Contents]: <>, [byteLength]: 0 },\n  ArrayBuffer { [Uint8Contents]: <01 02 ff>, [byteLength]: 3 }\n]"],
    ["an array buffer of more than a hundred bytes is cut", `new ArrayBuffer(105)`, `ArrayBuffer {\n  [Uint8Contents]: <${"00 ".repeat(100)}... 5 more bytes>,\n  [byteLength]: 105\n}`],
    ["a subclass of ArrayBuffer and the properties added to one", `class Bytes extends ArrayBuffer {} [new Bytes(1), Object.assign(new ArrayBuffer(1), { a: 1 })]`, "[\n  Bytes [ArrayBuffer] { [Uint8Contents]: <00>, [byteLength]: 1 },\n  ArrayBuffer { [Uint8Contents]: <00>, [byteLength]: 1, a: 1 }\n]"],
    ["an array buffer too deep is named only", `({ a: { b: { c: { d: new ArrayBuffer(2) } } } })`, "{\n  a: { b: { c: { d: [ArrayBuffer] } } }\n}"],
    ["a data view and the bytes it looks at", `new DataView(new ArrayBuffer(4), 1, 2)`, "DataView {\n  [byteLength]: 2,\n  [byteOffset]: 1,\n  [buffer]: ArrayBuffer { [Uint8Contents]: <00 00 00 00>, [byteLength]: 4 }\n}"],
    ["boxed primitives", `[new Number(3), new String("s"), new Boolean(false)]`, "[ [Number: 3], [String: 's'], [Boolean: false] ]"],
    ["boxed primitives with properties of their own", `[Object.assign(new Number(3), { a: 1 }), Object.assign(new String("ab"), { b: 2 })]`, "[ [Number: 3] { a: 1 }, [String: 'ab'] { b: 2 } ]"],
    ["the iterators of a map and a set, whose items cannot be read without taking them", `[new Map([[1, 2]]).entries(), new Map().keys(), new Set([1]).values(), new Set([1]).entries()]`, "[\n  [Map Iterator] { <items unknown> },\n  [Map Iterator] { <items unknown> },\n  [Set Iterator] { <items unknown> },\n  [Set Iterator] { <items unknown> }\n]"],
    ["the other iterators hold no items to show", `[[][Symbol.iterator](), [1].entries(), "ab"[Symbol.iterator](), "a".matchAll(/a/g)]`, "[\n  Object [Array Iterator] {},\n  Object [Array Iterator] {},\n  Object [String Iterator] {},\n  Object [RegExp String Iterator] {}\n]"],
    ["weak collections", `[new WeakMap(), new WeakSet()]`, "[ WeakMap { <items unknown> }, WeakSet { <items unknown> } ]"],
    ["functions", `[function f() {}, () => 1, async () => {}]`, "[ [Function: f], [Function (anonymous)], [AsyncFunction (anonymous)] ]"],
    ["a method whose name starts with class is not a class", `({ classify() {} })`, "{ classify: [Function: classify] }"],
    ["generator functions", `[function* g() {}, async function* h() {}]`, "[ [GeneratorFunction: g], [AsyncGeneratorFunction: h] ]"],
    ["classes and their instances", `class A {} class B extends A { constructor() { super(); this.x = 1 } } return [A, B, new B()]`, "[ [class A], [class B extends A], B { x: 1 } ]"],
    ["a class whose superclass is an expression is shown as a function", `class Anon extends (class Par {}) {} Anon`, "[Function: Anon]"],
    ["a class that extends a call is shown as a function", `function make() { return class Base {} } class Z extends make() {} Z`, "[Function: Z]"],
    ["a class whose superclass is an unnamed class is shown as a function", `class Named extends (class {}) {} Named`, "[Function: Named]"],
    ["a class with an arrow function in its heritage is shown as a function", `class Lp extends ((a) => Array)(1) {} Lp`, "[Function: Lp]"],
    ["a comment in the head of a class does not hide it", `const K = class /* note */ Keep { }; K`, "[class Keep]"],
    ["the tag of a class instance is shown after its class", `class A { get [Symbol.toStringTag]() { return "X" } } return [new A()]`, "[ A [X] {} ]"],
    ["a tag equal to the class name is not repeated", `class A { get [Symbol.toStringTag]() { return "A" } } return new A()`, "A {}"],
    ["an own tag is a property, not a prefix", `({ [Symbol.toStringTag]: "X", a: 1 })`, "{ a: 1, Symbol(Symbol.toStringTag): 'X' }"],
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
    ["a subclass of Error that does not set a name shows its class when that holds the name", `class ValidationError extends Error {} [new ValidationError("bad")]`, "[ [ValidationError: bad] ]"],
    ["a subclass of Error whose class name does not hold the name shows both", `class Foo extends Error {} class HttpError extends TypeError {} [new Foo("a"), new HttpError("b")]`, "[ [Foo [Error]: a], [HttpError [TypeError]: b] ]"],
    ["an error of a class with a name of its own is not renamed twice", `class Named extends Error { name = "Named" } class Other extends Error { constructor(m) { super(m); this.name = "Custom" } } [new Named("a"), new Other("b"), new (class extends Error {})("c")]`, "[ [Named: a], [Custom: b], [Error: c] ]"],
    ["a DOMException is shown with the name it was given", `[new DOMException("m", "AbortError"), AbortSignal.abort().reason]`, "[\n  [DOMException [AbortError]: m],\n  [DOMException [AbortError]: This operation was aborted]\n]"],
    ["a plain object with a message is shown as the object it is", `throw { name: "TypeError", message: "plain" }`, "error: Uncaught { name: 'TypeError', message: 'plain' }"],
    ["a plain object with only a message", `throw { message: "m" }`, "error: Uncaught { message: 'm' }"],
    ["a rejection with a plain object", `await Promise.reject({ message: "later" })`, "error: Uncaught { message: 'later' }"],
    ["an object made from the prototype of Error is an error", `throw Object.create(Error.prototype, { message: { value: "made" } })`, "error: Error: made"],
    ["a stack overflow stays a RangeError", `(function f() { f() })()`, "error: RangeError: Maximum call stack size exceeded"],
    ["the cause of an error", `[new Error("outer", { cause: "inner" })]`, "[ [Error: outer] { [cause]: 'inner' } ]"],
    ["the errors an AggregateError holds", `[new AggregateError([1, new Error("e")], "several")]`, "[ [AggregateError: several] { [errors]: [ 1, [Error: e] ] } ]"],
    ["an AggregateError with nothing in it", `[new AggregateError([], "none")]`, "[ [AggregateError: none] { [errors]: [] } ]"],
    ["the errors of a rejected Promise.any", `await Promise.any([Promise.reject(1), Promise.reject("two")]).catch((e) => [e])`, "[\n  [AggregateError: All promises were rejected] {\n    [errors]: [ 1, 'two' ]\n  }\n]"],
    ["errors the program set on an error is a property like any other", `[Object.assign(new Error("x"), { errors: [1] })]`, "[ [Error: x] { errors: [ 1 ] } ]"],
    ["a thenable is awaited", `({ then(resolve) { resolve("from thenable") } })`, "from thenable"],
    ["self references", `const o = { name: "o" }; o.self = o; return o`, "<ref *1> { name: 'o', self: [Circular *1] }"],
    ["each cycle gets its own number", `const a = {}; a.a = a; const b = {}; b.b = b; return { a, b }`, "{ a: <ref *1> { a: [Circular *1] }, b: <ref *2> { b: [Circular *2] } }"],
    ["the marker goes on the object that is looped back to", `const a = { n: 1 }; a.b = { a }; return a`, "<ref *1> { n: 1, b: { a: [Circular *1] } }"],
    ["self references in arrays and maps", `const a = [1]; a.push(a); const m = new Map(); m.set("k", m); return [a, m]`, "[\n  <ref *1> [ 1, [Circular *1] ],\n  <ref *2> Map(1) { 'k' => [Circular *2] }\n]"],
    ["depth is limited", `({ a: { b: { c: { d: { e: 1 } } } } })`, "{\n  a: { b: { c: { d: [Object] } } }\n}"],
    ["deep arrays are limited too", `[[[[[1]]]]]`, "[\n  [ [ [ [Array] ] ] ]\n]"],
    ["empty containers past the depth limit are shown as they are", `({ a: { b: { c: { d: {} } } } })`, "{\n  a: { b: { c: { d: {} } } }\n}"],
    ["an empty array past the depth limit", `[[[[[]]]]]`, "[\n  [ [ [ [] ] ] ]\n]"],
    ["an empty map and set past the depth limit", `[{ a: { b: { c: new Map() } } }, [[[new Set()]]]]`, "[\n  { a: { b: { c: Map(0) {} } } },\n  [ [ [ Set(0) {} ] ] ]\n]"],
    ["an empty typed array past the depth limit", `({ a: { b: { c: { d: new Uint8Array(0) } } } })`, "{\n  a: { b: { c: { d: Uint8Array(0) [] } } }\n}"],
    ["an empty instance and an empty null-prototype object past the depth limit", `({ a: { b: { c: { d: new (class Foo {})(), e: Object.create(null) } } } })`, "{\n  a: { b: { c: { d: Foo {}, e: [Object: null prototype] {} } } }\n}"],
    ["an empty subclass of Array past the depth limit", `({ a: { b: { c: { d: new (class Bar extends Array {})() } } } })`, "{\n  a: { b: { c: { d: Bar(0) [] } } }\n}"],
    ["a container with something in it is still cut past the depth limit", `({ a: { b: { c: { d: [1], e: 2 } } } })`, "{\n  a: { b: { c: { d: [Array], e: 2 } } }\n}"],
    ["a map with something in it is still cut", `({ a: { b: { c: { d: new Map([[1, 2]]) } } } })`, "{\n  a: { b: { c: { d: [Map] } } }\n}"],
    ["a long list of numbers is set out in columns, lined up on the right", `Array.from({ length: 30 }, (_, i) => i * 1000)`, [
      "[",
      "      0,  1000,  2000,  3000,  4000,",
      "   5000,  6000,  7000,  8000,  9000,",
      "  10000, 11000, 12000, 13000, 14000,",
      "  15000, 16000, 17000, 18000, 19000,",
      "  20000, 21000, 22000, 23000, 24000,",
      "  25000, 26000, 27000, 28000, 29000",
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
    ["properties of a long typed array are listed after its more items line", `Object.assign(new Uint8Array(101), { tag: "x" })`, [
      "Uint8Array(101) [",
      ...Array.from({ length: 25 }, () => "  0,               0, 0, 0,"),
      "  ... 1 more item,",
      "  tag: 'x'",
      "]",
    ].join("\n")],
    ["the match of a regular expression keeps its index and input", `/(\\d)/.exec("a1")`, "[ '1', '1', index: 1, input: 'a1', groups: undefined ]"],
    ["properties added to a function", `function f() {} f.calls = 2; f`, "[Function: f] { calls: 2 }"],
    ["properties added to a class", `class A { static count = 1 } A`, "[class A] { count: 1 }"],
    ["properties added to an array", `Object.assign([1, 2], { label: "x" })`, "[ 1, 2, label: 'x' ]"],
    ["properties added to a map and a set", `[Object.assign(new Map([[1, 2]]), { a: 1 }), Object.assign(new Set([1]), { b: 2 })]`, "[ Map(1) { 1 => 2, a: 1 }, Set(1) { 1, b: 2 } ]"],
    ["properties added to a date and a regular expression", `[Object.assign(new Date(0), { a: 1 }), Object.assign(/x/, { b: 2 })]`, "[ 1970-01-01T00:00:00.000Z { a: 1 }, /x/ { b: 2 } ]"],
    ["a subclass of Array", `class Stack extends Array {} Stack.from([1, 2])`, "Stack(2) [ 1, 2 ]"],
    ["an empty subclass of Array", `class Stack extends Array {} new Stack()`, "Stack(0) []"],
    ["subclasses of Date and RegExp keep their name", `class MyDate extends Date {} class MyRe extends RegExp {} [new MyDate(0), new MyRe("ab", "g")]`, "[ MyDate 1970-01-01T00:00:00.000Z, MyRe /ab/g ]"],
    ["a subclass of Date that is invalid", `class MyDate extends Date {} Object.assign(new MyDate(NaN), { a: 1 })`, "MyDate Invalid Date { a: 1 }"],
    ["a prototype swapped onto a regular expression names the class", `class MyRe extends RegExp {} Object.setPrototypeOf(/ab/, MyRe.prototype)`, "MyRe /ab/"],
    ["a date with a tag of its own shows the tag after its name", `class Stamp extends Date { get [Symbol.toStringTag]() { return "T" } } new Stamp(0)`, "Stamp [T] 1970-01-01T00:00:00.000Z"],
    ["subclasses of typed arrays keep their name and show the array type", `class Bar2 extends Uint8Array {} [new Bar2(2), new Bar2([1, 2, 3]), new (class Empty extends Uint8Array {})(0)]`, "[\n  Bar2(2) [Uint8Array] [ 0, 0 ],\n  Bar2(3) [Uint8Array] [ 1, 2, 3 ],\n  Empty(0) [Uint8Array] []\n]"],
    ["a regular expression without a prototype", `Object.setPrototypeOf(/x/, null)`, "[RegExp: null prototype] /x/"],
    ["a typed array given another prototype shows both names", `Object.setPrototypeOf(new Uint8Array(2), Uint16Array.prototype)`, "Uint16Array(2) [Uint8Array] [ 0, 0 ]"],
    ["built-in prototypes are shown by their tag, not as collections", `[Map.prototype, Set.prototype, Promise.prototype, WeakMap.prototype]`, "[\n  Object [Map] {},\n  Object [Set] {},\n  Object [Promise] {},\n  Object [WeakMap] {}\n]"],
    ["the prototypes of binary data and of primitives", `[ArrayBuffer.prototype, DataView.prototype, Symbol.prototype, BigInt.prototype]`, "[\n  Object [ArrayBuffer] {},\n  Object [DataView] {},\n  Object [Symbol] {},\n  Object [BigInt] {}\n]"],
    ["the prototypes of the wrappers of primitives are plain objects", `[Number.prototype, String.prototype, Boolean.prototype]`, "[ {}, {}, {} ]"],
    ["objects made from a collection prototype are named after it", `[Object.create(Map.prototype), Object.create(Set.prototype), Object.create(WeakMap.prototype)]`, "[ Map {}, Set {}, WeakMap {} ]"],
    ["objects made from other prototypes of built-ins are named after them", `[Object.create(Promise.prototype), Object.create(ArrayBuffer.prototype), Object.create(Symbol.prototype), Object.create(Number.prototype)]`, "[ Promise {}, ArrayBuffer {}, Symbol {}, Number {} ]"],
    ["an object with a tag of a collection is not one", `({ [Symbol.toStringTag]: "Map" })`, "{ Symbol(Symbol.toStringTag): 'Map' }"],
    ["a class instance with a tag of a collection shows the tag", `class Fake { get [Symbol.toStringTag]() { return "Map" } } new Fake()`, "Fake [Map] {}"],
    ["an object without a prototype is named by its own tag", `Object.setPrototypeOf({ [Symbol.toStringTag]: "Map" }, null)`, "[Map: null prototype] { Symbol(Symbol.toStringTag): 'Map' }"],
    ["an object with a tag of an error is not an error", `({ [Symbol.toStringTag]: "Error" })`, "{ Symbol(Symbol.toStringTag): 'Error' }"],
    ["subclasses of Map and Set",`class Registry extends Map {} class Tags extends Set {} [new Registry([[1, 2]]), new Tags([3])]`, "[ Registry(1) [Map] { 1 => 2 }, Tags(1) [Set] { 3 } ]"],
    ["a function that holds itself", `const f = () => {}; f.self = f; f`, "<ref *1> [Function: f] { self: [Circular *1] }"],
  ];

  test("properties of a long array are listed after its more items line, as Node does", async () => {
    const long = await show(`Object.assign(Array.from({ length: 150 }, (_, i) => i), { tag: "x" })`);
    expect(long).toContain("96, 97, 98, 99,\n  ... 50 more items,\n  tag: 'x'\n]");
    const hundred = await show(`Object.assign(Array.from({ length: 100 }, (_, i) => i), { tag: "x" })`);
    expect(hundred).toContain("\n  96, 97, 98, 99,\n  tag: 'x'\n]");
    const hundredAndOne = await show(`Object.assign(Array.from({ length: 101 }, (_, i) => i), { tag: "x" })`);
    expect(hundredAndOne).toContain("\n  96,              97, 98, 99,\n  ... 1 more item,\n  tag: 'x'\n]");
    const subclass = await show(`class Stack extends Array {} const s = Stack.from(Array.from({ length: 105 }, (_, i) => i)); s.tag = 1; s`);
    expect(subclass).toContain("\n  ... 5 more items,\n  tag: 1\n]");
    const sparse = await show(`const a = [1, , 3]; a[200] = 9; a.tag = "s"; a`);
    expect(sparse).toBe("[ 1, <1 empty item>, 3, <197 empty items>, 9, tag: 's' ]");
    for (const text of [long, hundredAndOne, subclass]) expect(text).not.toContain("more propert");
  });

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
    ["a subclass that sets no name is named by its class", `class ValidationError extends Error {} throw new ValidationError("bad input")`, "error: ValidationError: bad input"],
    ["a subclass whose class name has no Error in it", `class Foo extends Error {} throw new Foo("bad input")`, "error: Foo [Error]: bad input"],
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

  test("a promise, a weak reference and a lazily installed global format in one run", async () => {
    expect(await logged(`console.log(Promise.resolve(1), new WeakRef({ a: 1 }).deref(), typeof structuredClone)`)).toEqual([
      "Promise { 1 } { a: 1 } function",
    ]);
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
      console.log(Object.create(new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("trap") } })));
      console.log({ get a() { throw new Error("getter") } });
      console.log("after");
    `)).toEqual(["[Unformattable object]", "{ a: [Getter] }", "after"]);
  });
});

describe("escapes in quoted strings", () => {
  test("are written the way Node writes them", async () => {
    expect(await show(String.raw`["\b", "\f", "\v", "\x01", "\x1f"]`)).toBe(String.raw`[ '\b', '\f', '\x0B', '\x01', '\x1F' ]`);
    expect(await show(String.raw`["\x7f", "\x85", "\x9f"]`)).toBe(String.raw`[ '\x7F', '\x85', '\x9F' ]`);
  });

  test("show half of a surrogate pair as its code unit", async () => {
    expect(await show(String.raw`["\ud83d", "\ude00x", "a\udc00"]`)).toBe(String.raw`[ '\ud83d', '\ude00x', 'a\udc00' ]`);
    expect(await show(String.raw`"😀".split("")`)).toBe(String.raw`[ '\ud83d', '\ude00' ]`);
    expect(await show(String.raw`({ "\ud83d": 1 })`)).toBe(String.raw`{ '\ud83d': 1 }`);
  });

  test("leave a whole pair alone", async () => {
    expect(await show(`["😀", "a😀b"]`)).toBe("[ '😀', 'a😀b' ]");
  });
});
