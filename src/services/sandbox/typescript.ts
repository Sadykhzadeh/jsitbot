export interface SourceError {
  message: string;
  /** Line of the user's code, from 1. */
  line?: number;
  /** Column of the user's code, counted in code points from 1. */
  column?: number;
}

export type Stripped =
  /** The code with its types removed, as plain JavaScript. */
  | { code: string }
  /** The transpiler could not read the code as TypeScript either. */
  | { error: SourceError }
  /** Code the sandbox does not run, although the transpiler could make JavaScript of it. */
  | { refusal: SourceError };

let transpiler: Bun.Transpiler | undefined;

function transform(source: string): string {
  // Macros are off: an `import ... with { type: "macro" }` is run by the
  // transpiler itself, in the process that holds the host's modules and files,
  // and its return value is pasted into the output. Guest code must never get
  // to run anything there. The runtime takes `false`; the typings do not list it.
  transpiler ??= new Bun.Transpiler({
    loader: "ts",
    deadCodeElimination: false,
    macro: false,
  } as unknown as Bun.TranspilerOptions);

  return transpiler.transformSync(source);
}

// The head of the function a snippet that returns is wrapped in.
const FUNCTION_HEAD = "(async () => {";

// Where the transpiler puts a helper it needs for these. The helpers are
// imported from a module the script does not have, so they are refused.
const NEEDS_HELPERS = 'from "bun:wrap"';
const HELPERS_REFUSAL = "SyntaxError: decorators, accessor and using are not supported";

// An import or an export that only exists for types is erased by the
// transpiler, so the code would run. It is refused as the module statement it is.
const TYPE_ONLY_MODULE = /^[ \t]*(import|export)[ \t]+type\b/m;

/**
 * Removes TypeScript syntax (annotations, interfaces, generics, enums...) and
 * returns plain JavaScript. If the code is not valid TypeScript either, says
 * where the parser gave up. Returns undefined when there is nothing to strip.
 *
 * Dead-code elimination is off on purpose: it would drop a trailing bare
 * expression such as the `v` in `const v: string = "a"; v`, which is the value
 * the user wants back.
 */
export function stripTypes(code: string): Stripped | undefined {
  const moduleStatement = TYPE_ONLY_MODULE.exec(code);
  if (moduleStatement) {
    const keywordAt = moduleStatement.index + moduleStatement[0].length - moduleStatement[0].trimStart().length;
    return {
      refusal: {
        message: `SyntaxError: unsupported keyword: ${moduleStatement[1]}`,
        ...position(code, keywordAt),
      },
    };
  }

  // A module may not `return`, but a snippet that awaits and returns is a
  // function body. It is parsed as one, and the result runs straight away.
  let output: string;
  try {
    output = transform(code);
  } catch (error) {
    if (!/return/i.test(errorMessage(error))) {
      return failure(error, code);
    }

    const wrapped = `${FUNCTION_HEAD}${code}\n})()`;
    try {
      output = transform(wrapped);
    } catch (wrappedError) {
      return failure(wrappedError, wrapped, FUNCTION_HEAD);
    }
  }

  if (output.includes(NEEDS_HELPERS)) {
    return { refusal: { message: HELPERS_REFUSAL } };
  }

  return output.trim() === code.trim() ? undefined : { code: output };
}

/**
 * The line of the user's code that line `outputLine` of its transpiled text
 * came from, or undefined when there is no such line. The transpiler does not
 * keep line numbers, so the code is read again one more line at a time: where
 * a prefix of the code reads as a program of its own, the lines its transpiled
 * text has so far are the lines of the code up to there. Within a stretch of
 * code that spans lines, the transpiled lines are paired with the code's lines
 * when there are as many of each; otherwise the code line whose text is the
 * transpiled line's text, or the one that shares most of it, is taken. It runs
 * only for an error, so the cost is paid rarely.
 */
export function sourceLine(code: string, outputLine: number): number | undefined {
  const wrapped = needsFunctionBody(code);
  const lines = code.split("\n");
  let before = { source: 0, output: 0 };

  for (let source = 1; source <= lines.length; source++) {
    const text = transpilePrefix(lines.slice(0, source).join("\n"), wrapped);
    if (text === undefined) {
      continue;
    }

    const output = outputLines(text);
    if (output.length >= outputLine) {
      const stretch = lines.slice(before.source, source);
      if (stretch.length === output.length - before.output) {
        return before.source + (outputLine - before.output);
      }

      return matchingLine(stretch, before.source + 1, output[outputLine - 1]);
    }
    before = { source, output: output.length };
  }

  return undefined;
}

/** The line of a stretch of code (numbered from `first`) whose text matches an output line best. */
function matchingLine(stretch: string[], first: number, outputText: string): number {
  const wanted = squash(outputText);
  let best = first + stretch.length - 1;
  let bestScore = 0;

  for (let i = 0; i < stretch.length; i++) {
    const own = squash(stretch[i]);
    if (own === "") {
      continue;
    }
    if (own === wanted) {
      return first + i;
    }

    const score = own.includes(wanted) ? wanted.length : wanted.includes(own) ? own.length : 0;
    if (score > bestScore) {
      best = first + i;
      bestScore = score;
    }
  }

  return best;
}

/** A line of code without its spaces, semicolons and commas, which the transpiler moves or adds. */
function squash(line: string): string {
  return line.replace(/[\s;,]/g, "");
}

function needsFunctionBody(code: string): boolean {
  try {
    transform(code);
    return false;
  } catch (error) {
    return /return/i.test(errorMessage(error));
  }
}

function transpilePrefix(prefix: string, wrapped: boolean): string | undefined {
  try {
    return transform(wrapped ? `(async () => {${prefix}\n})()` : prefix);
  } catch {
    return undefined;
  }
}

function outputLines(text: string): string[] {
  return text.trim() === "" ? [] : text.replace(/\n+$/, "").split("\n");
}

function errorMessage(error: unknown): string {
  // Syntax errors come as BuildMessage objects, which are not Error instances.
  const message = (error as { message?: unknown } | null)?.message;

  return typeof message === "string" ? message : String(error);
}

/** The line and the column, in code points from 1, of an index in the code. */
function position(code: string, index: number): { line: number; column: number } {
  const lineStart = code.lastIndexOf("\n", index - 1) + 1;
  const line = code.slice(0, index).split("\n").length;
  const column = Array.from(code.slice(lineStart, index)).length + 1;

  return { line, column };
}

/**
 * A syntax error of the transpiler, with its column counted in code points
 * from 1. Bun 1.4.4 counts UTF-16 code units and 1.3.14 counts code points, so
 * the unit is found once with a probe, and a column in units is converted with
 * the text of the line. `source` is the text that was transpiled, and `head`
 * the wrapper put in front of the code, which is not the user's.
 */
function failure(error: unknown, source: string, head = ""): Stripped | undefined {
  const at = (error as { position?: { line?: unknown; column?: unknown } } | null)?.position;
  if (!at || typeof at.line !== "number") {
    return undefined;
  }

  let column = typeof at.column === "number" ? at.column : undefined;
  if (column !== undefined) {
    const text = source.split("\n")[at.line - 1] ?? "";
    if (columnsCountUnits()) {
      column = Array.from(text.slice(0, column - 1)).length + 1;
    }
    if (at.line === 1) {
      column = Math.max(1, column - Array.from(head).length);
    }
  }

  return { error: { message: errorMessage(error), line: at.line, column } };
}

let columnsInUnits: boolean | undefined;

/** Whether the transpiler's columns count UTF-16 code units, which is how Bun 1.4.4 counts them. */
function columnsCountUnits(): boolean {
  if (columnsInUnits === undefined) {
    const probe = "let s = '\u{1F600}'; let c = ;";
    const before = probe.slice(0, probe.lastIndexOf(";"));
    let column: unknown;
    try {
      transform(probe);
    } catch (error) {
      column = (error as { position?: { column?: unknown } } | null)?.position?.column;
    }
    columnsInUnits = column === before.length + 1;
  }

  return columnsInUnits;
}
