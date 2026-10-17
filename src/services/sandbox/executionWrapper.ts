import { readFileSync } from "node:fs";

/** Name the guest sees for the user's code, as it appears in stack traces. */
export const GUEST_FILE = "input.js";

/** Source of the runtime that is installed in every context before user code. */
export const guestRuntimeSource = readFileSync(new URL("./guest.js", import.meta.url), "utf8");

/**
 * Parts of the guest's environment that most programs never touch. They are not
 * evaluated with the guest runtime: the first time the code reads one of their
 * globals the runtime asks for the source and evaluates it then, so a program
 * that does not use them does not pay for parsing them.
 */
export const guestExtras: Record<string, string> = Object.fromEntries(
  ["clone", "encoding"].map((name) => [name, readFileSync(new URL(`./extras/${name}.js`, import.meta.url), "utf8")]),
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
