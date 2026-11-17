import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

// The sandbox's answer as one string: the result, or the error with its prefix.
async function answer(code: string): Promise<string> {
  const execution = await sandbox.execute(code);

  return execution.ok ? execution.result : `error: ${execution.error}`;
}

// Each row is a snippet, what the sandbox prints for it, and the value Node 26
// prints for the same program when Node runs it (where Node accepts it).
const TYPE_ONLY: Array<[string, string, string]> = [
  ["annotations", "const x: number = 5;\nx * 2", "10"],
  ["function signature", "const add = (a: number, b: number): number => a + b;\nadd(2, 3)", "5"],
  ["generic function", "function id<T>(v: T): T { return v; }\nid<number>(4)", "4"],
  ["generic class", "class Box<T> { constructor(private value: T) {} get(): T { return this.value; } }\nnew Box<string>('s').get()", "s"],
  ["interface and alias", "interface P { x: number }\ntype Q = P | null;\nconst p: Q = { x: 2 };\np", "{ x: 2 }"],
  ["as const", "const a = [1, 2] as const;\na", "[ 1, 2 ]"],
  ["satisfies", "const o = { k: 1 } satisfies Record<string, number>;\no", "{ k: 1 }"],
  ["non-null", "const m: Map<string, number> = new Map();\nm.set('a', 1);\nm.get('a')! + 1", "2"],
  ["definite assignment", "let v!: number;\nv = 3;\nv", "3"],
  ["optional parameter", "function f(a: number, b?: number) { return a + (b ?? 0); }\nf(1)", "1"],
  ["overload signatures", "function g(a: string): string;\nfunction g(a: number): number;\nfunction g(a: any): any { return a; }\ng(2)", "2"],
  ["declare", "declare const env: { n: number };\nconst w = 3;\nw", "3"],
  ["abstract class", "abstract class Shape { abstract area(): number; name(): string { return 'shape'; } }\nclass Sq extends Shape { area(): number { return 4; } }\nnew Sq().area()", "4"],
  ["index signature", "interface Dict { [k: string]: number }\nconst d: Dict = { a: 1 };\nd.a", "1"],
  ["unique symbol", "const tag: unique symbol = Symbol('t');\ntypeof tag", "symbol"],
  ["asserts", "function assertStr(v: unknown): asserts v is string { if (typeof v !== 'string') throw new Error('no'); }\nconst s: unknown = 'ok';\nassertStr(s);\ns", "ok"],
  ["infer", "type Elem<T> = T extends (infer U)[] ? U : never;\nconst e: Elem<number[]> = 3;\ne", "3"],
  ["template literal type", "type Greet = `hi ${string}`;\nconst g: Greet = 'hi there';\ng", "hi there"],
  ["arrow generic", "(<T,>(x: T) => x)(3)", "3"],
  ["angle-bracket cast", "const q: unknown = 5;\n<number>q + 1", "6"],
  ["this parameter", "function who(this: { n: number }) { return this.n; }\nwho.call({ n: 9 })", "9"],
  ["typed getter and setter", "class G { private _v = 0; get v(): number { return this._v; } set v(x: number) { this._v = x; } }\nconst g = new G();\ng.v = 5;\ng.v", "5"],
  ["implements, override, readonly", "interface I { go(): number }\nclass A implements I { readonly k: number = 1; go(): number { return this.k; } }\nclass B extends A { override go(): number { return 2; } }\nnew B().go()", "2"],
  ["#private field", "class H { #x = 1; get x() { return this.#x; } }\nnew H().x", "1"],
  ["optional chain with non-null", "const o: { b?: { c: number } } = { b: { c: 4 } };\no?.b!.c", "4"],
  ["regular enum", "enum E { A, B }\nE.B", "1"],
  ["string enum", "enum S { A = 'a', B = 'b' }\nS.A", "a"],
  ["const enum", "const enum K { X = 1, Y = 2 }\nK.Y", "2"],
  ["enum reverse mapping", "enum R { A }\nR[0]", "A"],
  ["enum computed member", "enum Q { A = 1 << 2, B }\nQ.B", "5"],
  ["enum object", "enum E2 { A }\nE2", "{ '0': 'A', A: 0 }"],
  ["namespace", "namespace N { export const v = 2; }\nN.v", "2"],
  ["parameter properties", "class Pt { constructor(public x: number, private y: number) {} }\nnew Pt(3, 4)", "Pt { x: 3, y: 4 }"],
  ["class instance name", "class K { a: number = 1; }\nnew K()", "K { a: 1 }"],
  ["top-level await", "const v: number = await Promise.resolve(3);\nv", "3"],
  ["types are not checked", "const n: number = 'a';\nn", "a"],
];

// The transpiler lowers enums, namespaces and parameter properties to plain
// code, as tsc does, so they run. Accessors, decorators and `using` are lowered
// to calls of helpers the sandbox does not have, so they are refused with one
// line. Module statements that exist only for types are refused like the
// module statements they are, since the sandbox runs scripts.
const REFUSED: Array<[string, string, string]> = [
  ["accessor", "class C { accessor n = 1; }\nnew C().n", "error: SyntaxError: decorators, accessor and using are not supported"],
  ["decorator", "function dec(t: any) { return t; }\n@dec class D {}\nnew D()", "error: SyntaxError: decorators, accessor and using are not supported"],
  ["using", "const r = { [Symbol.dispose]() {} };\n{ using h = r; }\n1", "error: SyntaxError: decorators, accessor and using are not supported"],
  ["import type", "import type { X } from './x';\nconst y = 1;\ny", "error: SyntaxError: unsupported keyword: import"],
  ["export type", "export type T = number;\n1", "error: SyntaxError: unsupported keyword: export"],
];

describe("type-only syntax disappears", () => {
  for (const [name, code, expected] of TYPE_ONLY) {
    test(name, async () => {
      expect(await answer(code)).toBe(expected);
    });
  }
});

describe("syntax the sandbox refuses", () => {
  for (const [name, code, expected] of REFUSED) {
    test(name, async () => {
      expect(await answer(code)).toBe(expected);
    });
  }
});
