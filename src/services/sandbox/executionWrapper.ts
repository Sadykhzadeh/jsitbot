import { readFileSync } from "node:fs";

/** Name the guest sees for the user's code, as it appears in stack traces. */
export const GUEST_FILE = "input.js";

let compactor: Bun.Transpiler | undefined;

/**
 * Drops the comments and the indentation of a source file that is one function
 * expression. The guest runtime is parsed for every run, and QuickJS spends a
 * good part of that on text it throws away. A bare expression would be removed
 * as dead code, so it is given a name for the trip through the transpiler and
 * the brackets that make it an expression are put back. The source is ours, but
 * macros are off like they are everywhere else.
 */
function compact(source: string): string {
  compactor ??= new Bun.Transpiler({ loader: "js", minifyWhitespace: true, macro: false } as unknown as Bun.TranspilerOptions);

  try {
    const named = compactor.transformSync(`var part = ${source}`);
    const text = named.replace(/^var part\s*=\s*/, "").replace(/;\s*$/, "");

    return text.length < source.length && text.startsWith("function") ? `(${text})` : source;
  } catch {
    return source;
  }
}

const read = (path: string) => compact(readFileSync(new URL(path, import.meta.url), "utf8"));

/** Source of the runtime that is installed in every context before user code. */
export const guestRuntimeSource = read("./guest.js");

/**
 * Parts of the guest's environment that most programs never touch. They are not
 * evaluated with the guest runtime: the first time the code reads one of their
 * globals the runtime asks for the source and evaluates it then, so a program
 * that does not use them does not pay for parsing them.
 */
export const guestExtras: Record<string, string> = Object.fromEntries(
  ["clone", "encoding", "url", "crypto"].map((name) => [name, read(`./extras/${name}.js`)]),
);

// The wrappers add nothing but text on the first line, so line numbers in the
// user's code are the same inside the wrapper. The newline before the closing
// bracket keeps a trailing // comment from swallowing it.

/** The code as one expression: `1 + 1`, `await fetchIt()`, `{ a: 1 }`. */
export function wrapAsExpression(code: string): string {
  return `(async () => { return (${code}\n); })()`;
}

/** The code as the body of a function: statements, `return`, top-level `await`. */
export function wrapAsStatements(code: string): string {
  return `(async () => {${code}\n})()`;
}
