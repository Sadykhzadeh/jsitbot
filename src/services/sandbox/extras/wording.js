// The names Node gives to three errors the engine words without them: the callee
// of a call that is not a function, the object of a for-of loop that is not
// iterable, and the constant of an assignment to a const. Evaluated the first time
// such an error is printed; see wordingOf in guest.js. The names are read from the
// line of the code the error was thrown from, which the host gave the guest.
(function (register, seed, host) {
  "use strict";

  const NOT_A_FUNCTION = "not a function";
  const NOT_A_CONSTRUCTOR = " is not a constructor";
  const NOT_ITERABLE = "value is not iterable";
  const READ_ONLY = "' is read-only";
  const CALLEE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
  const KEYWORD = /^(?:await|yield|return|typeof|void|delete|new|throw|in|of|instanceof)$/;
  const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
  const CALLEE_CHARACTER = /[\w$.]/;
  const LOOP_OF = /\bfor\s*(?:await\s*)?\([^)]*?\bof\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\)/g;

  function lineOf(text, number) {
    let start = 0;
    for (let i = 1; i < number; i++) {
      const next = text.indexOf("\n", start);
      if (next === -1) return undefined;
      start = next + 1;
    }
    const end = text.indexOf("\n", start);
    return end === -1 ? text.slice(start) : text.slice(start, end);
  }

  // The code line an error was thrown from, and the column it was thrown at (0 when
  // the stack does not give one). Undefined when the stack does not say, or when a
  // built-in threw the error, since its frame comes first.
  function thrownFrom(error) {
    const stack = error.stack;
    if (typeof stack !== "string") return undefined;
    const end = stack.indexOf("\n");
    if ((end === -1 ? stack : stack.slice(0, end)).indexOf("(native)") !== -1) return undefined;

    const where = host.where(error);
    const colon = where.indexOf(":");
    const line = +(colon === -1 ? where : where.slice(0, colon));
    if (!(line >= 1)) return undefined;

    const text = lineOf(host.source(), line);
    if (text === undefined) return undefined;
    return { text, column: colon === -1 ? 0 : +where.slice(colon + 1) };
  }

  // What a call tried to call, as Node names it: "obj.run is not a function", or
  // "obj.Run is not a constructor" after new. The name is read from the code at the
  // place the call was thrown from: a "(" after a plain name or a chain of them.
  function calleeWording(error) {
    const from = thrownFrom(error);
    if (from === undefined || !(from.column >= 1)) return undefined;
    const characters = Array.from(from.text);
    const at = from.column - 1;
    if (characters[at] !== "(") return undefined;

    let start = at;
    while (start > 0 && CALLEE_CHARACTER.test(characters[start - 1])) start--;
    let callee = "";
    for (let i = start; i < at; i++) callee += characters[i];
    if (!CALLEE.test(callee) || KEYWORD.test(callee)) return undefined;

    let before = start;
    while (before > 0 && characters[before - 1] === " ") before--;
    const constructs = before >= 3 && characters[before - 3] + characters[before - 2] + characters[before - 1] === "new" && (before === 3 || !CALLEE_CHARACTER.test(characters[before - 4]));

    return callee + (constructs ? NOT_A_CONSTRUCTOR : " is not a function");
  }

  // The engine names an assignment to a const as a read-only name, which a frozen
  // property gives too in strict code. The name is a constant when the line the error
  // was thrown from assigns it, and it is not a property of something.
  function isConstAssignment(error, name) {
    const from = thrownFrom(error);
    if (from === undefined) return false;
    return new RegExp("(?:^|[^\\w$.])" + name.split("$").join("\\$") + "\\s*(?:\\+\\+|--|(?:\\*\\*|<<|>>>|>>|&&|\\|\\||\\?\\?|[-+*/%&|^])?=(?!=))").test(from.text);
  }

  // The name a "'name' is read-only" message gives, or undefined for any other message.
  function readOnlyName(message) {
    if (message[0] !== "'" || message.slice(-READ_ONLY.length) !== READ_ONLY) return undefined;
    const name = message.slice(1, message.length - READ_ONLY.length);
    return IDENTIFIER.test(name) ? name : undefined;
  }

  // What a for-of loop on the line of an error iterates, when the line has one such loop
  // over a name or a chain of names: "obj" for for (const x of obj).
  function iteratedName(error) {
    const from = thrownFrom(error);
    if (from === undefined) return undefined;
    const loops = [...from.text.matchAll(LOOP_OF)];
    return loops.length === 1 ? loops[0][1] : undefined;
  }

  // The message Node gives an error that the engine words without the name, or
  // undefined when there is no such rule for it.
  return function codeWording(error, message) {
    try {
      if (message === NOT_A_FUNCTION || message === NOT_A_CONSTRUCTOR) {
        const named = calleeWording(error);
        if (named !== undefined) return named;
        if (message === NOT_A_CONSTRUCTOR) return "(intermediate value)" + message;
        return undefined;
      }
      if (message === NOT_ITERABLE) {
        const iterated = iteratedName(error);
        return iterated === undefined ? undefined : iterated + " is not iterable";
      }
      const constant = readOnlyName(message);
      return constant !== undefined && isConstAssignment(error, constant) ? "Assignment to constant variable." : undefined;
    } catch (ignored) {
      return undefined;
    }
  };
})
