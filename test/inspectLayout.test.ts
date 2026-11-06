import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

// The expected text of each case is what Node's util.inspect prints for the
// same value with a depth of 3, which is how deep this sandbox looks.

const sandbox = new QuickJsSandboxService();

async function printed(code: string): Promise<string> {
  const execution = await sandbox.execute(`console.log(${code})`);
  expect(execution.ok).toBe(true);

  return execution.logs.join("\n");
}

describe("how entries are laid out", () => {
  const cases: Array<[string, string, string]> = [
    ["seven short numbers are set out in rows", "[1,2,3,4,5,6,7]", "[\n  1, 2, 3, 4,\n  5, 6, 7\n]"],
    ["numbers of different widths are lined up on the right", "[1.5,-2,300,4000,5,6,7,8,9,10]", "[\n  1.5, -2, 300, 4000,\n    5,  6,   7,    8,\n    9, 10\n]"],
    ["bigints are lined up like numbers", "[1n,2n,3n,4n,5n,6n,7n,8n]", "[\n  1n, 2n, 3n, 4n,\n  5n, 6n, 7n, 8n\n]"],
    ["strings are lined up on the left", "Array.from({length:27},(_, i)=>String.fromCharCode(97+i%26).repeat(1+i%5))", "[\n  'a',     'bb',    'ccc',   'dddd',\n  'eeeee', 'f',     'gg',    'hhh',\n  'iiii',  'jjjjj', 'k',     'll',\n  'mmm',   'nnnn',  'ooooo', 'p',\n  'qq',    'rrr',   'ssss',  'ttttt',\n  'u',     'vv',    'www',   'xxxx',\n  'yyyyy', 'z',     'aa'\n]"],
    ["a mix of numbers and strings is lined up on the left", "[1,2,3,4,5,6,7,\"x\"]", "[\n  1, 2, 3, 4,\n  5, 6, 7, 'x'\n]"],
    ["a hundred items and a note about the rest", "Array.from({length:101},(_, i)=>i)", "[\n   0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11,\n  12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,\n  24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35,\n  36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47,\n  48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59,\n  60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71,\n  72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83,\n  84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95,\n  96, 97, 98, 99,\n  ... 1 more item\n]"],
    ["a typed array is set out in columns", "new Uint8Array(20).map((_, i)=>i*13)", "Uint8Array(20) [\n    0,  13,  26,  39,  52,  65,\n   78,  91, 104, 117, 130, 143,\n  156, 169, 182, 195, 208, 221,\n  234, 247\n]"],
    ["an array inside an object is set out at its own indentation", "{list:Array.from({length:10},(_, i)=>i)}", "{\n  list: [\n    0, 1, 2, 3, 4,\n    5, 6, 7, 8, 9\n  ]\n}"],
    ["objects in a long array are set out in columns", "Array.from({length:8},(_, i)=>({id:i}))", "[\n  { id: 0 }, { id: 1 },\n  { id: 2 }, { id: 3 },\n  { id: 4 }, { id: 5 },\n  { id: 6 }, { id: 7 }\n]"],
    ["an array with a property of its own stays on one line", "Object.assign([1,2,3,4,5,6,7],{extra:1})", "[ 1, 2, 3, 4, 5, 6, 7, extra: 1 ]"],
    ["a set is not set out in columns", "new Set([1,2,3,4,5,6,7,8])", "Set(8) { 1, 2, 3, 4, 5, 6, 7, 8 }"],
    ["a map with many entries goes one entry to a line", "new Map(Array.from({length:8},(_, i)=>[i,i]))", "Map(8) {\n  0 => 0,\n  1 => 1,\n  2 => 2,\n  3 => 3,\n  4 => 4,\n  5 => 5,\n  6 => 6,\n  7 => 7\n}"],
    ["an object with more than three levels in it is not put on one line", "{a:{b:{c:{d:1}}}}", "{\n  a: { b: { c: { d: 1 } } }\n}"],
    ["an empty object does not count as a level", "{a:{b:{c:{}}}}", "{ a: { b: { c: {} } } }"],
    ["the same goes for an array", "[[[[1]]]]", "[\n  [ [ [ 1 ] ] ]\n]"],
    ["only the last entry counts for the levels", "{a:1,b:2,c:[1,2,3],d:{e:{f:{g:1}}}}", "{\n  a: 1,\n  b: 2,\n  c: [ 1, 2, 3 ],\n  d: { e: { f: { g: 1 } } }\n}"],
    ["a function with properties is laid out after its name", "Object.assign(function f(){}, {aaaaaaaaaaaaaaa:1,bbbbbbbbbbbbbbb:2,cccccccccccccc:3,ddddddddddd:4})", "[Function: f] {\n  aaaaaaaaaaaaaaa: 1,\n  bbbbbbbbbbbbbbb: 2,\n  cccccccccccccc: 3,\n  ddddddddddd: 4\n}"],
    ["a class instance keeps its name in front of the lines", "new (class Foo { constructor(){ this.aaaaaaaaaaaaaaa=1; this.bbbbbbbbbbbbbbb=2; this.cccccccccccccc=3; this.dddddddddd=4 } })", "Foo {\n  aaaaaaaaaaaaaaa: 1,\n  bbbbbbbbbbbbbbb: 2,\n  cccccccccccccc: 3,\n  dddddddddd: 4\n}"],
    ["the marker of a cycle counts towards the width of the line", "(()=>{const a={name:'aaaaaa',other:'bbbbb',third:''};a.s=a;return a})()", "<ref *1> { name: 'aaaaaa', other: 'bbbbb', third: '', s: [Circular *1] }"],
    ["one more character puts a marked object on lines", "(()=>{const a={name:'aaaaaa',other:'bbbbb',third:'c'};a.s=a;return a})()", "<ref *1> {\n  name: 'aaaaaa',\n  other: 'bbbbb',\n  third: 'c',\n  s: [Circular *1]\n}"],
    ["a map in an object", "new Map([['k',{a:{b:{c:1}}}]])", "Map(1) {\n  'k' => { a: { b: { c: 1 } } }\n}"],
  ];

  for (const [name, code, expected] of cases) {
    test(name, async () => {
      expect(await printed(code)).toBe(expected);
    });
  }
});
