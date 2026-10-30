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
  ["clone", "encoding", "url", "crypto", "collate"].map((name) => [name, read(`./extras/${name}.js`)]),
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

let reader: Bun.Transpiler | undefined;

/** What the transpiler's REPL mode makes of the code, or undefined when it cannot be parsed. */
function readAsRepl(code: string): string | undefined {
  // The same options as everywhere else a transpiler reads the user's code: no macros.
  reader ??= new Bun.Transpiler({ loader: "js", replMode: true, macro: false } as unknown as Bun.TranspilerOptions);

  try {
    return reader.transformSync(code);
  } catch {
    return undefined;
  }
}

// Only the mode that returns the value of the last expression writes this.
const RETURNS_LAST_VALUE = "__proto__: null";
// How far back from the end to look for where the last statement begins.
const MAX_STATEMENT_STARTS = 200;

/**
 * Like wrapAsStatements, but the last statement is returned when it is an
 * expression: a script has the value of its last statement and a function body
 * does not, so `const a = await f(); a + 1` had no result. Returns undefined
 * when the code has no such statement.
 *
 * The start of the last statement is looked for after each semicolon, line
 * break and closing brace, from the end. It is taken when the transpiler reads
 * the code the same with a semicolon put there, and each part is a program of
 * its own: so the statement does not go on from the line before (`x = 1\n+ 2`),
 * does not end before the line after, and does not begin inside a block. The
 * code stays where it is, so line numbers are the same.
 */
export function wrapAsStatementsWithValue(code: string): string | undefined {
  const whole = readAsRepl(code);
  if (whole === undefined || !whole.includes(RETURNS_LAST_VALUE)) {
    return undefined;
  }

  let tried = 0;
  for (let start = code.length - 1; start >= 0 && tried < MAX_STATEMENT_STARTS; start--) {
    const before = code[start - 1];
    if (start > 0 && before !== ";" && before !== "\n" && before !== "}") {
      continue;
    }
    tried++;

    // Whitespace stays with what comes before, since a line break after
    // return would end the statement there.
    const rest = code.slice(start);
    const last = rest.trimStart();
    const from = start + (rest.length - last.length);
    if (last === "" || last.startsWith("//") || last.startsWith("/*")) {
      continue;
    }

    // Each part must be a program of its own, or the semicolon may have landed inside a block.
    const first = code.slice(0, from);
    if (
      readAsRepl(`${first}\n;${last}`) === whole &&
      readAsRepl(first) !== undefined &&
      readAsRepl(last) !== undefined
    ) {
      return wrapAsStatements(`${first}return ${last}`);
    }
  }

  return undefined;
}
