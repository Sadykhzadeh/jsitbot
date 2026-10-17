export type Stripped =
  | { code: string }
  | { error: { message: string; line: number } };

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
  try {
    const output = transform(code);

    return output.trim() === code.trim() ? undefined : { code: output };
  } catch (error) {
    // A module may not `return`, but a snippet that awaits and returns is a
    // function body. Parse it as one, and run the result straight away.
    if (/return/i.test(errorMessage(error))) {
      try {
        return { code: transform(`(async () => {${code}\n})()`) };
      } catch (wrapped) {
        return failure(wrapped);
      }
    }

    return failure(error);
  }
}

function errorMessage(error: unknown): string {
  // Syntax errors come as BuildMessage objects, which are not Error instances.
  const message = (error as { message?: unknown } | null)?.message;

  return typeof message === "string" ? message : String(error);
}

function failure(error: unknown): Stripped | undefined {
  const line = (error as { position?: { line?: unknown } } | null)?.position?.line;

  return typeof line === "number"
    ? { error: { message: errorMessage(error), line } }
    : undefined;
}
