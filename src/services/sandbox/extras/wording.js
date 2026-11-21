// The names Node gives to some errors that the engine words without them: the callee
// of a call that is not a function or a constructor, the value that is not iterable,
// the constant of an assignment to a const, and the null or undefined given to
// Object.keys and the like. Evaluated the first time such an error is printed; see
// wordingOf in guest.js. The names are read from the line of the code the error was
// thrown from, which the host gave the guest.
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
  const NAME = "([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)";
  // What a line iterates: the object of a for-of loop, a spread in an array literal, and the
  // value of an array pattern in a declaration or an assignment.
  const ITERATED = [
    new RegExp("\\bfor\\s*(?:await\\s*)?\\([^)]*?\\bof\\s+" + NAME + "\\s*\\)", "g"),
    new RegExp("\\[(?:[^\\]]*,)?\\s*\\.\\.\\." + NAME + "\\s*[,\\]]", "g"),
    new RegExp("\\]\\s*=\\s*" + NAME + "(?![\\w$.(\\[])", "g"),
  ];
  const NOT_ITERABLE_READ = "cannot read property 'Symbol.iterator' of ";
  const NOT_CONVERTIBLE = "cannot convert to object";
  const OBJECT_CALL = /\bObject\.\w+\s*\(/;
  const DESTRUCTURING = /\{[^{}]*\}\s*=(?!=)|\(\s*\{/;

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
  // the stack does not give one). Undefined when the stack does not say.
  function codeLine(error) {
    const where = host.where(error);
    const colon = where.indexOf(":");
    const line = +(colon === -1 ? where : where.slice(0, colon));
    if (!(line >= 1)) return undefined;

    const text = lineOf(host.source(), line);
    if (text === undefined) return undefined;
    return { text, column: colon === -1 ? 0 : +where.slice(colon + 1) };
  }

  // codeLine for an error that a program's own code threw: one a built-in threw has its
  // frame first, and the place it was thrown from is not in the program.
  function thrownFrom(error) {
    const stack = error.stack;
    if (typeof stack !== "string") return undefined;
    const end = stack.indexOf("\n");
    if ((end === -1 ? stack : stack.slice(0, end)).indexOf("(native)") !== -1) return undefined;
    return codeLine(error);
  }

  // The text of the expression that ends at index end, as Node writes a callee: each
  // call in it shows its arguments as (...). Undefined when the text is not one.
  function calleeText(characters, end) {
    let text = "";
    let at = end;
    while (at > 0) {
      const character = characters[at - 1];
      if (character === ")") {
        let depth = 0;
        let open = at - 1;
        for (; open >= 0; open--) {
          if (characters[open] === ")") depth++;
          else if (characters[open] === "(" && --depth === 0) break;
        }
        if (open < 0) return undefined;
        text = "(...)" + text;
        at = open;
      } else if (CALLEE_CHARACTER.test(character)) {
        let start = at;
        while (start > 0 && CALLEE_CHARACTER.test(characters[start - 1])) start--;
        let name = "";
        for (let i = start; i < at; i++) name += characters[i];
        text = name + text;
        at = start;
      } else {
        break;
      }
    }
    return CALLEE.test(text.replace(/\(\.\.\.\)/g, "")) && !KEYWORD.test(text.split(/[.(]/)[0]) ? text : undefined;
  }

  // What a call tried to call, as Node names it: "obj.run is not a function", "f(...)
  // is not a function" for a call of a result, or "obj.Run is not a constructor" after
  // new. The name is read from the code at the place the call was thrown from: a "("
  // after an expression that is a plain name, a chain of them, or calls of those.
  function calleeWording(error) {
    const from = thrownFrom(error);
    if (from === undefined || !(from.column >= 1)) return undefined;
    const characters = Array.from(from.text);
    const at = from.column - 1;
    if (characters[at] !== "(") return undefined;

    const callee = calleeText(characters, at);
    if (callee === undefined) return undefined;

    let start = at;
    while (start > 0 && (CALLEE_CHARACTER.test(characters[start - 1]) || characters[start - 1] === ")")) start--;
    let before = start;
    while (before > 0 && characters[before - 1] === " ") before--;
    const constructs = before >= 3 && characters[before - 3] + characters[before - 2] + characters[before - 1] === "new" && (before === 3 || !CALLEE_CHARACTER.test(characters[before - 4]));
    if (constructs && callee.indexOf("(...)") !== -1) return undefined;

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

  // What the line of an error iterates, when it has exactly one such place over a name or a
  // chain of names: "obj" for for (const x of obj), or for [...obj] and const [a] = obj.
  function iteratedName(error) {
    const from = thrownFrom(error);
    if (from === undefined) return undefined;
    let found;
    let count = 0;
    for (const pattern of ITERATED) {
      for (const match of from.text.matchAll(pattern)) {
        found = match[1];
        count++;
      }
    }
    return count === 1 ? found : undefined;
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
      if (message === NOT_ITERABLE || message.indexOf(NOT_ITERABLE_READ) === 0) {
        const iterated = iteratedName(error);
        if (iterated !== undefined) return iterated + " is not iterable";
        return message === NOT_ITERABLE ? undefined : message.slice(NOT_ITERABLE_READ.length) + " is not iterable";
      }
      if (message === NOT_CONVERTIBLE) {
        // Only a call of Object.keys and the like on the line, and no destructuring there:
        // Node words a destructuring by the property it reads.
        const line = codeLine(error);
        return line !== undefined && OBJECT_CALL.test(line.text) && !DESTRUCTURING.test(line.text) ? "Cannot convert undefined or null to object" : undefined;
      }
      const constant = readOnlyName(message);
      return constant !== undefined && isConstAssignment(error, constant) ? "Assignment to constant variable." : undefined;
    } catch (ignored) {
      return undefined;
    }
  };
})
