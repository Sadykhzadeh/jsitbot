// JSON.parse, for the guest: the engine's parser, with the messages V8 and Node give for
// bad input. The engine's parser runs first, and only when it throws is the text
// checked again by a parser of the same grammar that reports the position the way Node
// does: where the text is expected to go on, what it found instead, and a snippet of
// the text around it for long inputs. Evaluated the first time JSON.parse is called; see
// lazyMethod in guest.js.
(function (original, owner, zoneInfo, builtins) {
  "use strict";

  const SPECIAL = ["NaN", "Infinity", "undefined", "[object Object]"];
  const CONTEXT = 10;
  const LONG = CONTEXT * 2 + 1;

  // Thrown by the checking parser: `kind` is "end" (the input stopped where a value
  // was wanted), "token" (a character that cannot start what was expected), or a
  // message that names the place, with the position it is at.
  function Failure(kind, position, message) {
    this.kind = kind;
    this.position = position;
    this.message = message;
  }

  function fail(kind, position, message) {
    throw new Failure(kind, position, message);
  }

  function isSpace(char) {
    return char === " " || char === "\t" || char === "\n" || char === "\r";
  }

  function isDigit(char) {
    return char !== undefined && char >= "0" && char <= "9";
  }

  function isHex(char) {
    return char !== undefined && /^[0-9a-fA-F]$/.test(char);
  }

  function parseText(text) {
    const len = text.length;
    let at = 0;

    function skip() {
      while (at < len && isSpace(text[at])) at++;
    }

    function atPlace(message) {
      return new Failure("place", at, message);
    }

    function literal(word) {
      for (let i = 0; i < word.length; i++) {
        if (at + i >= len) fail("end", at + i);
        if (text[at + i] !== word[i]) fail("token", at + i);
      }
      at += word.length;
    }

    function string() {
      at++;
      while (true) {
        if (at >= len) fail("place", len, "Unterminated string");
        const char = text[at];
        if (char === '"') {
          at++;
          return;
        }
        if (char < " ") fail("place", at, "Bad control character in string literal");
        if (char === "\\") {
          at++;
          const escape = text[at];
          if (escape === undefined) fail("place", len, "Unterminated string");
          if (escape === "u") {
            for (let i = 1; i <= 4; i++) {
              if (!isHex(text[at + i])) fail("place", at + i, "Bad Unicode escape");
            }
            at += 5;
          } else if ('"\\/bfnrt'.indexOf(escape) === -1) {
            fail("place", at, "Bad escaped character");
          } else {
            at++;
          }
          continue;
        }
        at++;
      }
    }

    function number() {
      if (text[at] === "-") {
        at++;
        if (!isDigit(text[at])) fail("place", at, "No number after minus sign");
      }
      if (text[at] === "0") {
        at++;
        if (isDigit(text[at])) fail("place", at, "Unexpected number");
      } else {
        while (isDigit(text[at])) at++;
      }
      if (text[at] === ".") {
        at++;
        if (!isDigit(text[at])) fail("place", at, "Unterminated fractional number");
        while (isDigit(text[at])) at++;
      }
      if (text[at] === "e" || text[at] === "E") {
        at++;
        if (text[at] === "+" || text[at] === "-") at++;
        if (!isDigit(text[at])) fail("place", at, "Exponent part is missing a number");
        while (isDigit(text[at])) at++;
      }
    }

    function value() {
      skip();
      if (at >= len) fail("end", at);
      const char = text[at];
      if (char === "{") return object();
      if (char === "[") return array();
      if (char === '"') return string();
      if (char === "-" || isDigit(char)) return number();
      if (char === "t") return literal("true");
      if (char === "f") return literal("false");
      if (char === "n") return literal("null");
      fail("token", at);
    }

    function object() {
      at++;
      skip();
      if (text[at] === "}") {
        at++;
        return;
      }
      if (text[at] !== '"') throw atPlace("Expected property name or '}'");
      while (true) {
        string();
        skip();
        if (text[at] !== ":") throw atPlace("Expected ':' after property name");
        at++;
        value();
        skip();
        if (text[at] === "}") {
          at++;
          return;
        }
        if (text[at] !== ",") throw atPlace("Expected ',' or '}' after property value");
        at++;
        skip();
        if (text[at] !== '"') throw atPlace("Expected double-quoted property name");
      }
    }

    function array() {
      at++;
      skip();
      if (text[at] === "]") {
        at++;
        return;
      }
      while (true) {
        value();
        skip();
        if (text[at] === "]") {
          at++;
          return;
        }
        if (text[at] !== ",") throw atPlace("Expected ',' or ']' after array element");
        at++;
      }
    }

    value();
    skip();
    if (at < len) throw atPlace("Unexpected non-whitespace character after JSON");
  }

  // The position as Node writes it: the offset, then the line and column.
  function located(prefix, text, position) {
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < position; i++) {
      if (text[i] === "\n") {
        line++;
        lineStart = i + 1;
      }
    }
    // The end-of-text message reads "after JSON"; the others name JSON before the position.
    const named = prefix.indexOf("after JSON") !== -1 ? prefix : prefix + " in JSON";
    return named + " at position " + position + " (line " + line + " column " + (position - lineStart + 1) + ")";
  }

  // What the engine's parser would not accept, in Node's words.
  function messageFor(text, failure) {
    if (failure.kind === "end") return "Unexpected end of JSON input";
    if (failure.kind === "place") return located(failure.message, text, failure.position);
    if (SPECIAL.indexOf(text) !== -1) return '"' + text + '" is not valid JSON';
    const token = text[failure.position];
    if (text.length < LONG) return "Unexpected token '" + token + "', \"" + text + '" is not valid JSON';
    const start = Math.max(0, failure.position - CONTEXT);
    const end = Math.min(text.length, failure.position + CONTEXT);
    const before = start > 0 ? "..." : "";
    const after = end < text.length ? "..." : "";
    return "Unexpected token '" + token + "', " + before + '"' + text.slice(start, end) + '"' + after + " is not valid JSON";
  }

  function parse(text, reviver) {
    const source = builtins.string(text);
    try {
      return builtins.apply(original, this, [source, reviver]);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      let failure = null;
      try {
        parseText(source);
      } catch (found) {
        if (!(found instanceof Failure)) throw found;
        failure = found;
      }
      if (failure === null) throw error;
      throw new SyntaxError(messageFor(source, failure));
    }
  }

  Object.defineProperty(parse, "name", { value: "parse", configurable: true });
  Object.defineProperty(parse, "length", { value: 2, configurable: true });
  return { parse };
})
