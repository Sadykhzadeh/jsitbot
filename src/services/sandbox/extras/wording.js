// The names Node gives to some errors that the engine words without them: the callee
// of a call that is not a function or a constructor, the value that is not iterable,
// the constant of an assignment to a const, and the null or undefined given to
// Object.keys and the like. Evaluated the first time such an error is printed; see
// wordingOf in guest.js. The names are read from the line of the code the error was
// thrown from, which the host gave the guest. Where the line does not say which name
// it is, the engine's wording stays.
(function (register, seed, host) {
  "use strict";

  // Helpers the guest captured before any program ran, so that a program that
  // changes String or RegExp methods cannot change what is named.
  const indexOf = host.indexOf;
  const slice = host.slice;
  const exec = host.exec;
  const characters = host.characters;

  const NOT_A_FUNCTION = "not a function";
  const NOT_A_CONSTRUCTOR = " is not a constructor";
  const NOT_ITERABLE = "value is not iterable";
  const NOT_ITERABLE_READ = "cannot read property 'Symbol.iterator' of ";
  const NOT_CONVERTIBLE = "cannot convert to object";
  const READ_ONLY = "' is read-only";
  const CALLEE_TEXT = /^[A-Za-z_$][\w$]*(?:\(\.\.\.\))?(?:\.[A-Za-z_$][\w$]*(?:\(\.\.\.\))?)*$/;
  const KEYWORD = /^(?:await|yield|return|typeof|void|delete|new|throw|in|of|instanceof)$/;
  const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
  const CALLEE_CHARACTER = /[\w$.]/;
  const NAME_CHARACTER = /[\w$]/;
  const TOKEN = /[A-Za-z_$][\w$]*/g;
  const DECLARATION_BEFORE = /(?:^|[^\w$.])(?:const|let|var)\s+$/;
  // What follows a name that is assigned to: an update, or an assignment that is not a comparison.
  const ASSIGNED_AFTER = /^\s*(?:\+\+|--|(?:\*\*|<<|>>>|>>|&&|\|\||\?\?|[-+*/%&|^])?=(?!=))/;
  const OBJECT_CALL = /\bObject\.\w+\s*\(/;
  const DESTRUCTURING = /\{[^{}]*\}\s*=(?!=)|\(\s*\{/;
  // What a line iterates: the object of a for-of loop, a spread in an array literal, and the
  // value of an array pattern in a declaration or an assignment.
  const ITERATED = [
    /\bfor\s*(?:await\s*)?\([^)]*?\bof\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\)/g,
    /\[(?:[^\]]*,)?\s*\.\.\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*[,\]]/g,
    /\]\s*=\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?![\w$.(\[])/g,
  ];

  function matches(pattern, text) {
    return exec(pattern, text) !== null;
  }

  function countOf(text, search) {
    let count = 0;
    let at = indexOf(text, search, 0);
    while (at !== -1) {
      count++;
      at = indexOf(text, search, at + search.length);
    }
    return count;
  }

  function lineOf(text, number) {
    let start = 0;
    for (let i = 1; i < number; i++) {
      const next = indexOf(text, "\n", start);
      if (next === -1) return undefined;
      start = next + 1;
    }
    const end = indexOf(text, "\n", start);
    return end === -1 ? slice(text, start) : slice(text, start, end);
  }

  // The code line an error was thrown from, and the column it was thrown at (0 when
  // the stack does not give one). Undefined when the stack does not say.
  function codeLine(error) {
    const where = host.where(error);
    const colon = indexOf(where, ":");
    const line = +(colon === -1 ? where : slice(where, 0, colon));
    if (!(line >= 1)) return undefined;

    const text = lineOf(host.source(), line);
    if (text === undefined) return undefined;
    return { text, column: colon === -1 ? 0 : +slice(where, colon + 1) };
  }

  // codeLine for an error that a program's own code threw: one a built-in threw has its
  // frame first, and the place it was thrown from is not in the program.
  function thrownFrom(error) {
    const stack = error.stack;
    if (typeof stack !== "string") return undefined;
    const end = indexOf(stack, "\n");
    if (indexOf(end === -1 ? stack : slice(stack, 0, end), "(native)") !== -1) return undefined;
    return codeLine(error);
  }

  // A line with no quotes and no comment, where every name is code.
  function isPlainCode(text) {
    return indexOf(text, "'") === -1 && indexOf(text, '"') === -1 && indexOf(text, "`") === -1 && indexOf(text, "//") === -1 && indexOf(text, "/*") === -1;
  }

  // The first segment of a callee text, as in "f" for "f(...).go".
  function keywordHead(text) {
    let end = 0;
    while (end < text.length && text[end] !== "." && text[end] !== "(") end++;
    return matches(KEYWORD, slice(text, 0, end));
  }

  // The text of the expression that ends at index end, as Node writes a callee: each
  // call in it shows its arguments as (...). Undefined when the text is not one.
  function calleeText(chars, end) {
    let text = "";
    let at = end;
    while (at > 0) {
      const character = chars[at - 1];
      if (character === ")") {
        let depth = 0;
        let open = at - 1;
        for (; open >= 0; open--) {
          if (chars[open] === ")") depth++;
          else if (chars[open] === "(" && --depth === 0) break;
        }
        if (open < 0) return undefined;
        text = "(...)" + text;
        at = open;
      } else if (matches(CALLEE_CHARACTER, character)) {
        let start = at;
        while (start > 0 && matches(CALLEE_CHARACTER, chars[start - 1])) start--;
        let name = "";
        for (let i = start; i < at; i++) name += chars[i];
        text = name + text;
        at = start;
      } else {
        break;
      }
    }
    return matches(CALLEE_TEXT, text) && !keywordHead(text) ? text : undefined;
  }

  // What a call tried to call, as Node names it: "obj.run is not a function", "f(...)
  // is not a function" for a call of a result, or "obj.Run is not a constructor" after
  // new. The name is read from the code at the place the call was thrown from: a "("
  // after an expression that is a plain name, a chain of them, or calls of those.
  function calleeWording(error) {
    const from = thrownFrom(error);
    if (from === undefined || !(from.column >= 1)) return undefined;
    const chars = characters(from.text);
    const at = from.column - 1;
    if (chars[at] !== "(") return undefined;

    const callee = calleeText(chars, at);
    if (callee === undefined) return undefined;

    let start = at;
    while (start > 0 && (matches(CALLEE_CHARACTER, chars[start - 1]) || chars[start - 1] === ")")) start--;
    let before = start;
    while (before > 0 && chars[before - 1] === " ") before--;
    const constructs = before >= 3 && chars[before - 3] + chars[before - 2] + chars[before - 1] === "new" && (before === 3 || !matches(CALLEE_CHARACTER, chars[before - 4]));
    if (constructs && indexOf(callee, "(...)") !== -1) return undefined;

    return callee + (constructs ? NOT_A_CONSTRUCTOR : " is not a function");
  }

  // The engine names an assignment to a const as a read-only name, which a frozen
  // property gives too in strict code. The name is a constant only when the line is
  // plain code and assigns it exactly once as a bare name, and nothing on the line
  // reads or writes a property of that name or declares another one.
  function isConstAssignment(error, name) {
    const from = thrownFrom(error);
    if (from === undefined || !isPlainCode(from.text)) return false;
    const text = from.text;
    let count = 0;
    let other = false;
    TOKEN.lastIndex = 0;
    let token;
    while ((token = exec(TOKEN, text)) !== null) {
      if (token[0] !== name) continue;
      const at = token.index;
      const before = at > 0 ? text[at - 1] : "";
      if (before === ".") {
        other = true;
        continue;
      }
      if (before !== "" && matches(NAME_CHARACTER, before)) continue;
      if (matches(DECLARATION_BEFORE, slice(text, 0, at))) continue;
      if (matches(ASSIGNED_AFTER, slice(text, at + name.length))) count++;
    }
    return count === 1 && !other;
  }

  // The name a "'name' is read-only" message gives, or undefined for any other message.
  function readOnlyName(message) {
    if (message[0] !== "'" || slice(message, message.length - READ_ONLY.length) !== READ_ONLY) return undefined;
    const name = slice(message, 1, message.length - READ_ONLY.length);
    return matches(IDENTIFIER, name) ? name : undefined;
  }

  // What the line of an error iterates, when it has exactly one such place over a name or a
  // chain of names: "obj" for for (const x of obj), for [...obj] and const [a] = obj. A line
  // with more than one spread is not named, since the place it failed at is not known.
  function iteratedName(error) {
    const from = thrownFrom(error);
    if (from === undefined || !isPlainCode(from.text) || countOf(from.text, "...") > 1) return undefined;
    let count = 0;
    let found;
    for (let i = 0; i < ITERATED.length; i++) {
      const pattern = ITERATED[i];
      pattern.lastIndex = 0;
      let match;
      while ((match = exec(pattern, from.text)) !== null) {
        count++;
        found = match[1];
      }
    }
    return count === 1 ? found : undefined;
  }

  // The message Node gives an error that the engine words without the name, or
  // undefined when there is no such rule for it or the line does not say which name.
  return function codeWording(error, message) {
    try {
      if (message === NOT_A_FUNCTION || message === NOT_A_CONSTRUCTOR) {
        const named = calleeWording(error);
        if (named !== undefined) return named;
        if (message === NOT_A_CONSTRUCTOR) return "(intermediate value)" + message;
        return undefined;
      }
      if (message === NOT_ITERABLE || indexOf(message, NOT_ITERABLE_READ) === 0) {
        const iterated = iteratedName(error);
        if (iterated !== undefined) return iterated + " is not iterable";
        return message === NOT_ITERABLE ? undefined : slice(message, NOT_ITERABLE_READ.length) + " is not iterable";
      }
      if (message === NOT_CONVERTIBLE) {
        // Only a call of Object.keys and the like on the line, and no destructuring there:
        // Node words a destructuring by the property it reads.
        const line = codeLine(error);
        return line !== undefined && matches(OBJECT_CALL, line.text) && !matches(DESTRUCTURING, line.text) ? "Cannot convert undefined or null to object" : undefined;
      }
      const constant = readOnlyName(message);
      return constant !== undefined && isConstAssignment(error, constant) ? "Assignment to constant variable." : undefined;
    } catch (ignored) {
      return undefined;
    }
  };
})
