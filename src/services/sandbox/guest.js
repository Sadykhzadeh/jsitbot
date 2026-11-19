// Runs inside the QuickJS context before any user code. It owns everything that
// has to cross the sandbox boundary: console output and the final result are
// turned into short, bounded strings here, so the host never receives (or has
// to walk) a structure the guest controls.
//
// Everything the formatter relies on is captured up front, so user code that
// replaces Array.prototype.push, Object.keys, JSON and the like cannot change
// how its own output is produced or make the formatter throw.
//
// Returns { finish, fail }. Both produce a packed string:
//   <status: o|e> \n <line> \n <flags> \n <text>
// where line is the line of the user's code an error came from (0 if unknown)
// and flags is a bit set: 1 = result was cut short, 2 = console output was.
(function setup(hostLog, loadExtra, maxLogs, maxLogLength, maxResultLength, seed0, seed1, seed2, seed3, promiseState, zoneInfo) {
  "use strict";

  const FILE = "input.js";
  // What the engine says when the code recurses too deep.
  const STACK_OVERFLOW = "stack overflow";
  const MAX_DEPTH = 3;
  // What objects are shown down to: MAX_DEPTH, except during console.dir with a depth.
  let depthLimit = MAX_DEPTH;
  // Whether non-enumerable properties are shown in brackets, as %o shows them.
  let showHidden = false;
  // Whether a string given to write on its own is quoted, as console.dir shows it.
  let quoteStrings = false;
  const MAX_ENTRIES = 100;
  const MAX_SCAN = 100000;
  const MAX_TYPED_KEYS = 100000;
  const LINE_WIDTH = 80;
  // Objects with more levels than this in them are not put on one line.
  const COMPACT = 3;
  const ARRAY = 1;
  const BASE = 2;
  const MAX_TIMER_DELAY = 2147483647;
  const MAX_TABLE_ROWS = 50;
  const MAX_TABLE_COLUMNS = 8;
  const TABLE_CELL_WIDTH = 24;

  const uncurry = Function.prototype.call.bind.bind(Function.prototype.call);
  const toText = String;

  const getPrototypeOf = Object.getPrototypeOf;
  const getOwnPropertyNames = Object.getOwnPropertyNames;
  const getOwnPropertySymbols = Object.getOwnPropertySymbols;
  const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const isArray = Array.isArray;
  const freeze = Object.freeze;
  const functionPrototype = Function.prototype;
  const getKeys = Object.keys;
  const reflectApply = Reflect.apply;
  const mathSqrt = Math.sqrt;
  const mathRound = Math.round;
  const mathFloor = Math.floor;
  const mathMin = Math.min;
  const mathMax = Math.max;

  const arraySplice = uncurry(Array.prototype.splice);
  const objectToString = uncurry(Object.prototype.toString);
  const hasOwn = uncurry(Object.prototype.hasOwnProperty);
  const isEnumerable = uncurry(Object.prototype.propertyIsEnumerable);
  const stringSlice = uncurry(String.prototype.slice);
  const stringToUpper = uncurry(String.prototype.toUpperCase);
  const stringIndexOf = uncurry(String.prototype.indexOf);
  const stringCharCodeAt = uncurry(String.prototype.charCodeAt);
  const numberToString = uncurry(Number.prototype.toString);
  const numberToFixed = uncurry(Number.prototype.toFixed);
  const functionToString = uncurry(Function.prototype.toString);
  const symbolToString = uncurry(Symbol.prototype.toString);
  const bigintToString = uncurry(BigInt.prototype.toString);
  const dateToISOString = uncurry(Date.prototype.toISOString);
  const regExpToString = uncurry(RegExp.prototype.toString);
  const mapForEach = uncurry(Map.prototype.forEach);
  const mapGet = uncurry(Map.prototype.get);
  const mapSet = uncurry(Map.prototype.set);
  const weakMapGet = uncurry(WeakMap.prototype.get);
  const weakMapHas = uncurry(WeakMap.prototype.has);
  const weakMapSet = uncurry(WeakMap.prototype.set);
  const setForEach = uncurry(Set.prototype.forEach);
  const mapSize = uncurry(getOwnPropertyDescriptor(Map.prototype, "size").get);
  const setSize = uncurry(getOwnPropertyDescriptor(Set.prototype, "size").get);
  const errorPrototype = Error.prototype;
  const arrayBufferPrototype = ArrayBuffer.prototype;
  const dataViewPrototype = DataView.prototype;
  const mapIteratorPrototype = getPrototypeOf(new Map().keys());
  const setIteratorPrototype = getPrototypeOf(new Set().values());
  const TypedArray = getPrototypeOf(Uint8Array);
  const typedArrayLength = uncurry(getOwnPropertyDescriptor(TypedArray.prototype, "length").get);
  const typedArrayByteLength = uncurry(getOwnPropertyDescriptor(TypedArray.prototype, "byteLength").get);
  const typedArrayByteOffset = uncurry(getOwnPropertyDescriptor(TypedArray.prototype, "byteOffset").get);
  const typedArrayBuffer = uncurry(getOwnPropertyDescriptor(TypedArray.prototype, "buffer").get);
  const arrayBufferLength = uncurry(getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get);
  const sharedArrayBufferLength = uncurry(getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "byteLength").get);
  const dataViewLength = uncurry(getOwnPropertyDescriptor(DataView.prototype, "byteLength").get);
  const dataViewOffset = uncurry(getOwnPropertyDescriptor(DataView.prototype, "byteOffset").get);
  const dataViewBuffer = uncurry(getOwnPropertyDescriptor(DataView.prototype, "buffer").get);
  const NativeUint8Array = Uint8Array;
  const NativeRegExp = RegExp;
  const regExpPrototype = RegExp.prototype;
  const regExpSourceOf = uncurry(getOwnPropertyDescriptor(RegExp.prototype, "source").get);
  const numberValueOf = uncurry(Number.prototype.valueOf);
  const stringValueOf = uncurry(String.prototype.valueOf);
  const booleanValueOf = uncurry(Boolean.prototype.valueOf);
  const bigintValueOf = uncurry(BigInt.prototype.valueOf);
  const symbolValueOf = uncurry(Symbol.prototype.valueOf);

  // The tag of an object whose prototype was taken away is only Object, though
  // what it is still shows in its internal slots: each of these throws for
  // anything else.
  const mapSizeOf = uncurry(getOwnPropertyDescriptor(Map.prototype, "size").get);
  const setSizeOf = uncurry(getOwnPropertyDescriptor(Set.prototype, "size").get);
  const dateTimeOf = uncurry(Date.prototype.getTime);
  const typedArrayNameOf = uncurry(getOwnPropertyDescriptor(getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag).get);

  const TYPED_ARRAYS = [
    "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
    "Int32Array", "Uint32Array", "Float32Array", "Float64Array",
    "BigInt64Array", "BigUint64Array",
  ];

  // What the internal slots of a value say it is, for the tags that name one.
  // A program can give any object a tag, so the tag alone is not trusted: each
  // of these reads a slot and throws for anything else. The prototypes of the
  // wrappers have the slots and are not counted, as Node does not count them.
  const knownTags = new Map();
  const knownNames = ["Object", "Map", "Set", "WeakMap", "WeakSet", "Promise", "Array", "Function", "Error", "Arguments",
    "Number", "String", "Boolean", "BigInt", "Symbol", "ArrayBuffer", "SharedArrayBuffer", "DataView"].concat(TYPED_ARRAYS);
  for (let i = 0; i < knownNames.length; i++) mapSet(knownTags, "[object " + knownNames[i] + "]", true);
  const numberPrototype = Number.prototype;
  const stringPrototype = String.prototype;
  const booleanPrototype = Boolean.prototype;
  const weakSetHas = uncurry(WeakSet.prototype.has);
  const isPrototypeOfObject = uncurry(Object.prototype.isPrototypeOf);
  const brandProbe = {};

  function hasSlotsOf(value, tag) {
    try {
      switch (tag) {
        case "[object Map]": mapSizeOf(value); return true;
        case "[object Set]": setSizeOf(value); return true;
        case "[object WeakMap]": weakMapHas(value, brandProbe); return true;
        case "[object WeakSet]": weakSetHas(value, brandProbe); return true;
        case "[object Date]": dateTimeOf(value); return true;
        case "[object RegExp]": regExpSourceOf(value); return value !== regExpPrototype;
        case "[object Error]": return isPrototypeOfObject(errorPrototype, value);
        case "[object Number]": numberValueOf(value); return value !== numberPrototype;
        case "[object String]": stringValueOf(value); return value !== stringPrototype;
        case "[object Boolean]": booleanValueOf(value); return value !== booleanPrototype;
        case "[object BigInt]": bigintValueOf(value); return true;
        case "[object Symbol]": symbolValueOf(value); return true;
        case "[object ArrayBuffer]": arrayBufferLength(value); return true;
        case "[object SharedArrayBuffer]": sharedArrayBufferLength(value); return true;
        case "[object DataView]": dataViewLength(value); return true;
        case "[object Promise]": {
          // The host reports a value that is not a promise as settled with itself.
          const settled = promiseState(value);
          return !(settled[0] === "fulfilled" && settled[1] === value);
        }
      }
      for (let i = 0; i < TYPED_ARRAYS.length; i++) {
        if (tag === "[object " + TYPED_ARRAYS[i] + "]") return typedArrayNameOf(value) === TYPED_ARRAYS[i];
      }
    } catch (ignored) {
      return false;
    }
    return true;
  }

  // The tag an object is treated as having: the one it reports when its slots
  // back it up, and Object otherwise. An object without a prototype that is a
  // collection, a date or a typed array does not report its tag, so those are
  // looked for too.
  function kindOf(value, tag) {
    if (tag === "[object Object]") {
      if (getPrototypeOf(value) !== null) return tag;
      if (hasSlotsOf(value, "[object Map]")) return "[object Map]";
      if (hasSlotsOf(value, "[object Set]")) return "[object Set]";
      if (hasSlotsOf(value, "[object Date]")) return "[object Date]";
      const typed = typedArrayNameOf(value);
      return typed === undefined ? tag : "[object " + typed + "]";
    }
    return hasSlotsOf(value, tag) ? tag : "[object Object]";
  }
  const ELEMENT_BYTES = {
    Int8Array: 1, Uint8Array: 1, Uint8ClampedArray: 1, Int16Array: 2, Uint16Array: 2,
    Int32Array: 4, Uint32Array: 4, Float32Array: 4, Float64Array: 8, BigInt64Array: 8, BigUint64Array: 8,
  };

  let logCount = 0;
  let logsCutShort = false;
  let groupIndent = "";
  // The depth of the object whose entries were started on last, which is how
  // deep what is being laid out goes (an empty object has no entries to start).
  let currentDepth = 0;

  function enter(depth) {
    const before = currentDepth;
    currentDepth = depth;
    return before;
  }

  function spaces(depth) {
    let out = "";
    for (let i = 0; i < depth; i++) out += "  ";
    return out;
  }

  // The first `end` characters, without half of a surrogate pair at the end.
  function head(text, end) {
    const last = end > 0 ? stringCharCodeAt(text, end - 1) : 0;
    return stringSlice(text, 0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
  }

  function cut(text, limit, state) {
    if (text.length <= limit) return text;
    state.cut = true;
    return head(text, limit > 3 ? limit - 3 : 0) + "...";
  }

  function hexByte(code) {
    return (code < 16 ? "0" : "") + numberToString(code, 16);
  }

  // Text leaves the guest as a C string. A NUL character would end it there, so
  // "a\0b" came back as "a", and a lone surrogate has no UTF-8 form and came
  // back as three replacement characters. Control characters other than tab,
  // newline and carriage return are shown as \xNN, since Telegram would not.
  function visible(text) {
    let out = "";
    let from = 0;
    for (let i = 0; i < text.length; i++) {
      const c = stringCharCodeAt(text, i);
      if (c >= 32 && c < 127) continue;

      let replacement;
      if (c < 32) {
        if (c === 9 || c === 10 || c === 13) continue;
        replacement = "\\x" + hexByte(c);
      } else if (c === 127) {
        replacement = "\\x7f";
      } else if (c >= 0xd800 && c <= 0xdfff) {
        if (c <= 0xdbff && i + 1 < text.length) {
          const next = stringCharCodeAt(text, i + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            i++;
            continue;
          }
        }
        replacement = "�";
      } else {
        continue;
      }
      out += stringSlice(text, from, i) + replacement;
      from = i + 1;
    }
    return from === 0 ? text : out + stringSlice(text, from);
  }

  // Shortens text that is too long, then makes what is left safe to hand over.
  // Looking at the first `limit` characters only keeps a huge string cheap.
  function bound(text, limit, state) {
    const clipped = text.length > limit;
    let out = visible(clipped ? head(text, limit) : text);
    if (clipped || out.length > limit) {
      state.cut = true;
      out = head(out, limit > 3 ? limit - 3 : 0) + "...";
    }
    return out;
  }

  function isIdentifier(key) {
    if (key.length === 0) return false;
    for (let i = 0; i < key.length; i++) {
      const c = key[i];
      const letter = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
      const digit = c >= "0" && c <= "9";
      if (!(letter || (digit && i > 0))) return false;
    }
    return true;
  }

  function quote(text, state) {
    let source = text;
    let clipped = false;
    if (source.length > 1000) {
      source = head(source, 1000);
      clipped = true;
      state.cut = true;
    }

    let mark = "'";
    if (stringIndexOf(source, "'") !== -1) {
      if (stringIndexOf(source, '"') === -1) mark = '"';
      else if (stringIndexOf(source, "`") === -1) mark = "`";
    }

    return mark + escapeBody(source, mark) + mark + (clipped ? "..." : "");
  }

  // The characters of a quoted text, with the quote mark, a backslash and
  // control characters escaped the way Node writes them.
  function escapeBody(source, mark) {
    let out = "";
    for (let i = 0; i < source.length; i++) {
      const c = source[i];
      if (c === mark || c === "\\") out += "\\" + c;
      else if (c === "\n") out += "\\n";
      else if (c === "\r") out += "\\r";
      else if (c === "\t") out += "\\t";
      else if (c === "\b") out += "\\b";
      else if (c === "\f") out += "\\f";
      else if (c < " " || (c >= "\x7f" && c <= "\x9f")) out += "\\x" + (stringCharCodeAt(c, 0) < 16 ? "0" : "") + stringToUpper(numberToString(stringCharCodeAt(c, 0), 16));
      else if (c >= "\ud800" && c <= "\udfff") {
        // A pair stays whole; a half has no UTF-8 form, so Node writes its code unit.
        const code = stringCharCodeAt(c, 0);
        const next = i + 1 < source.length ? stringCharCodeAt(source, i + 1) : 0;
        if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) out += c + source[++i];
        else out += "\\u" + numberToString(code, 16);
      } else out += c;
    }
    return out;
  }

  function formatNumber(n) {
    return n === 0 && 1 / n < 0 ? "-0" : toText(n);
  }

  // The name of the constructor an object is an instance of, found along its
  // prototype chain: the first named constructor that the object is an instance
  // of, so the prototype of a class is not named after its own class.
  function constructorName(value) {
    let proto = value;
    for (let hops = 0; hops < 20 && proto !== null; hops++) {
      const descriptor = getOwnPropertyDescriptor(proto, "constructor");
      if (descriptor && typeof descriptor.value === "function") {
        const nameDescriptor = getOwnPropertyDescriptor(descriptor.value, "name");
        if (nameDescriptor && typeof nameDescriptor.value === "string" && nameDescriptor.value && isInstanceOf(value, descriptor.value)) {
          return stringSlice(nameDescriptor.value, 0, 100);
        }
      }
      proto = getPrototypeOf(proto);
    }
    return null;
  }

  function isInstanceOf(value, Class) {
    try {
      return Class.prototype !== undefined && isPrototypeOfObject(Class.prototype, value);
    } catch (ignored) {
      return false;
    }
  }

  // The name a prefix gives an object without a prototype: its own tag when it
  // has one, as V8 names it, and Object otherwise.
  function nullPrototypeName(value) {
    const descriptor = getOwnPropertyDescriptor(value, Symbol.toStringTag);
    return descriptor !== undefined && typeof descriptor.value === "string" ? descriptor.value : "Object";
  }

  // Node tells a class from a function by its source. The head of a class has no
  // parenthesis before its body, unless it matches a plain head once comments are
  // taken out, so `class A extends (B) {}` and `class A extends f() {}` are functions.
  const classHeadRegExp = /^(\s+[^(]*?)\s*{/;
  const commentRegExp = /(\/\/.*?\n)|(\/\*(.|\n)*?\*\/)/g;
  const regExpTest = uncurry(RegExp.prototype.test);
  const stringReplace = uncurry(String.prototype.replace);

  function isClassSource(source) {
    if (!startsWith(source, "class") || !endsWith(source, "}")) return false;
    const head = stringSlice(source, 5, source.length - 1);
    const bracket = stringIndexOf(head, "{");
    if (bracket === -1) return false;
    if (stringIndexOf(stringSlice(head, 0, bracket), "(") === -1) return true;
    return regExpTest(classHeadRegExp, stringReplace(head, commentRegExp, ""));
  }

  function formatFunction(fn) {
    const nameDescriptor = getOwnPropertyDescriptor(fn, "name");
    const name = nameDescriptor && typeof nameDescriptor.value === "string" ? stringSlice(nameDescriptor.value, 0, 100) : "";
    const constructor = constructorName(fn);

    if (isClassSource(functionToString(fn))) {
      const parent = getPrototypeOf(fn);
      let extended = "";
      if (constructor === null) {
        extended = " extends [null prototype]";
      } else if (typeof parent === "function" && parent !== functionPrototype) {
        const parentName = getOwnPropertyDescriptor(parent, "name");
        if (parentName && typeof parentName.value === "string" && parentName.value) {
          extended = " extends " + stringSlice(parentName.value, 0, 100);
        }
      }
      return "[class " + (name || "(anonymous)") + extended + "]";
    }

    const tag = objectToString(fn);
    const kind = tag === "[object AsyncFunction]" ? "AsyncFunction"
      : tag === "[object GeneratorFunction]" ? "GeneratorFunction"
      : tag === "[object AsyncGeneratorFunction]" ? "AsyncGeneratorFunction"
      : "Function";
    let text = "[" + kind + (constructor === null ? " (null prototype)" : "") + (name ? ": " + name : " (anonymous)") + "]";
    // A function whose constructor is not its kind names that constructor after it.
    if (constructor !== null && constructor !== kind) text += " " + constructor;
    return text;
  }

  function startsWith(text, prefix) {
    return stringSlice(text, 0, prefix.length) === prefix;
  }

  function endsWith(text, suffix) {
    return text.length >= suffix.length && stringSlice(text, text.length - suffix.length) === suffix;
  }

  // The engine words a few of its errors differently from V8, and what V8 says
  // is what programs and the people reading their output know. Only the messages
  // that cannot be anything else are changed.
  function nodeWording(name, message) {
    if (name === "TypeError") {
      if (message === "cannot convert symbol to string") return "Cannot convert a Symbol value to a string";
      if (message === "cannot convert symbol to number") return "Cannot convert a Symbol value to a number";
      if (message === "empty array") return "Reduce of empty array with no initial value";
      const read = startsWith(message, "cannot read property '");
      if (read || startsWith(message, "cannot set property '")) {
        const head = read ? "cannot read property '" : "cannot set property '";
        for (const nothing of [" of undefined", " of null"]) {
          if (endsWith(message, "'" + nothing)) {
            const key = stringSlice(message, head.length, message.length - nothing.length - 1);
            return (read ? "Cannot read properties" : "Cannot set properties") + nothing + (read ? " (reading '" : " (setting '") + key + "')";
          }
        }
      }
    } else if (name === "RangeError") {
      if (message === "invalid array length") return "Invalid array length";
    } else if (name === "ReferenceError") {
      if (startsWith(message, "'") && endsWith(message, "' is not defined")) {
        return stringSlice(message, 1, message.length - "' is not defined".length) + " is not defined";
      }
      if (endsWith(message, " is not initialized")) {
        const variable = stringSlice(message, 0, message.length - " is not initialized".length);
        return variable === "this"
          ? "Must call super constructor in derived class before accessing 'this' or returning from derived constructor"
          : "Cannot access '" + variable + "' before initialization";
      }
    }
    return message;
  }

  // Whether prototype is somewhere on the chain of value, found without running anything of the program's.
  function inherits(value, prototype) {
    let proto = value;
    for (let hops = 0; hops < 100; hops++) {
      proto = getPrototypeOf(proto);
      if (proto === null) return false;
      if (proto === prototype) return true;
    }
    return false;
  }

  function errorText(error, state) {
    let name = "Error";
    let message = "";
    try {
      const n = error.name;
      if (typeof n === "string" && n) name = stringSlice(n, 0, 100);
      const m = error.message;
      if (typeof m === "string") message = cut(nodeWording(name, m), maxResultLength, state);
      if (name === "RangeError" && message === STACK_OVERFLOW && getPrototypeOf(error) === InternalError.prototype) {
        message = "Maximum call stack size exceeded";
      } else if (endsWith(name, "Error") && inherits(error, errorPrototype)) {
        // A subclass that did not name itself is shown by its class, as Node does:
        // ValidationError, or Foo [Error] when the class name does not hold the name.
        // A DOMException always names itself, and is shown as DOMException [AbortError].
        const own = constructorName(error);
        if (own !== null && own !== name && (own === "DOMException" || !hasOwn(error, "name"))) {
          name = stringIndexOf(own, name) !== -1 ? own : own + " [" + name + "]";
        }
      }
    } catch (ignored) {}
    return message ? name + ": " + message : name;
  }

  function blanks(count) {
    let out = "";
    for (let i = 0; i < count; i++) out += " ";
    return out;
  }

  function padStartTo(text, width) {
    return text.length >= width ? text : blanks(width - text.length) + text;
  }

  function padEndTo(text, width) {
    return text.length >= width ? text : text + blanks(width - text.length);
  }

  // Sets out the entries of a long array in columns, the way Node does: as
  // many as make the block roughly square, the numbers lined up on the right
  // and anything else on the left. Returns the rows, or the entries unchanged
  // when they are too uneven in length to be worth it.
  function columnize(parts, indentation, numeric) {
    let count = parts.length;
    // The "... n more items" entry is not part of the table.
    if (count > MAX_ENTRIES) count--;

    const lengths = [];
    let total = 0;
    let longest = 0;
    for (let i = 0; i < count; i++) {
      const length = parts[i].length;
      lengths[i] = length;
      total += length + 2;
      if (length > longest) longest = length;
    }

    const cell = longest + 2;
    if (cell * 3 + indentation >= LINE_WIDTH || (total / cell <= 5 && longest > 6)) return parts;

    const bias = mathSqrt(cell - total / parts.length);
    const biased = mathMax(cell - 3 - bias, 1);
    const columns = mathMin(
      mathRound(mathSqrt(2.5 * biased * count) / biased),
      mathFloor((LINE_WIDTH - indentation) / cell),
      COMPACT * 4,
      15,
    );
    if (columns <= 1) return parts;

    const widths = [];
    for (let column = 0; column < columns; column++) {
      let widest = 0;
      for (let i = column; i < count; i += columns) {
        if (lengths[i] > widest) widest = lengths[i];
      }
      widths[column] = widest + 2;
    }

    const rows = [];
    for (let from = 0; from < count; from += columns) {
      const to = mathMin(from + columns, count);
      let row = "";
      for (let i = from; i < to - 1; i++) {
        const cellText = parts[i] + ", ";
        row += numeric ? padStartTo(cellText, widths[i - from]) : padEndTo(cellText, widths[i - from]);
      }
      row += numeric ? padStartTo(parts[to - 1], widths[to - 1 - from] - 2) : parts[to - 1];
      rows[rows.length] = row;
    }
    if (count < parts.length) rows[rows.length] = parts[count];
    return rows;
  }

  // Lays out already formatted entries as Node does: on one line when they are
  // few enough for that and fit in 80 columns, otherwise one per line, with a
  // long array's entries set out in columns. `kind` is ARRAY for the lists
  // that are grouped (`numeric` when all their items are numbers) and BASE
  // when the braces follow a text of their own, as in `[Function: f] { a: 1 }`.
  // The marker in front of an object that something inside it refers back to.
  function reference(value, state) {
    const index = state.circular === undefined ? undefined : mapGet(state.circular, value);
    return index === undefined ? "" : "<ref *" + index + "> ";
  }

  function layout(prefix, open, parts, close, depth, kind, numeric) {
    if (parts.length === 0) return prefix + open + close;

    const indentation = depth * 2;
    let rows = parts;
    if (kind === ARRAY && parts.length > 6) rows = columnize(parts, indentation, numeric);

    // Only an object that does not hold more than three levels of its own fits on one line.
    if (rows === parts && currentDepth - depth < COMPACT) {
      const count = parts.length;
      let used = count + indentation + prefix.length + open.length - (kind === BASE || stringIndexOf(prefix, "<ref *") === 0 ? 1 : 0) + 10;
      let fits = used + count <= LINE_WIDTH;
      let multiline = false;
      for (let i = 0; fits && i < count; i++) {
        used += parts[i].length + 1;
        if (stringIndexOf(parts[i], "\n") !== -1) multiline = true;
      }
      if (fits && !multiline && used <= LINE_WIDTH) {
        let line = prefix + open + " ";
        for (let i = 0; i < count; i++) line += (i > 0 ? ", " : "") + parts[i];
        return line + " " + close;
      }
    }

    const inner = spaces(depth + 1);
    let out = prefix + open + "\n";
    for (let i = 0; i < rows.length; i++) {
      out += inner + rows[i] + (i < rows.length - 1 ? "," : "") + "\n";
    }
    return out + spaces(depth) + close;
  }

  function more(count, singular, plural) {
    return "... " + count + " more " + (count === 1 ? singular : plural);
  }

  // What comes before the items of a collection of a class that extends Array, Map or Set.
  function subclassPrefix(value, base, size) {
    const name = constructorName(value);
    if (name === null) return "[" + base + "(" + size + "): null prototype] ";
    if (name === base) return base === "Array" ? "" : base + "(" + size + ") ";
    return name + "(" + size + ") " + (base === "Array" ? "" : "[" + base + "] ");
  }

  function formatArray(array, depth, state) {
    const parts = [];
    const length = array.length;
    const before = enter(depth);
    let index = 0;
    let scanned = 0;

    while (index < length && parts.length < MAX_ENTRIES && state.left > 0) {
      if (hasOwn(array, index)) {
        const part = format(array[index], depth + 1, state);
        parts[parts.length] = part;
        state.left -= part.length;
        index++;
        continue;
      }

      let end = index;
      while (end < length && !hasOwn(array, end) && scanned < MAX_SCAN) {
        end++;
        scanned++;
      }
      if (end === index) break;
      parts[parts.length] = "<" + (end - index) + " empty item" + (end - index === 1 ? "" : "s") + ">";
      index = end;
    }

    if (index < length) {
      state.cut = true;
      parts[parts.length] = more(length - index, "item", "items");
    }
    addProperties(array, parts, depth, state, true, false, true);
    if (parts.length === 0) currentDepth = before;

    let numeric = true;
    for (let i = 0; numeric && i < parts.length; i++) {
      numeric = typeof array[i] === "number" || typeof array[i] === "bigint";
    }
    return layout(reference(array, state) + subclassPrefix(array, "Array", length), "[", parts, "]", depth, ARRAY, numeric);
  }

  function formatTypedArray(array, name, depth, state) {
    const length = typedArrayLength(array);
    const parts = [];
    const before = enter(depth);
    for (let i = 0; i < length && i < MAX_ENTRIES && state.left > 0; i++) {
      const part = format(array[i], depth + 1, state);
      parts[parts.length] = part;
      state.left -= part.length;
    }
    if (length > parts.length) {
      state.cut = true;
      parts[parts.length] = more(length - parts.length, "item", "items");
    }
    // With %o the hidden fields come after the items, as Node lists them.
    if (showHidden) {
      const buffer = typedArrayBuffer(array);
      const bufferName = isSharedBuffer(buffer) ? "SharedArrayBuffer" : "ArrayBuffer";
      const hidden = [
        "[BYTES_PER_ELEMENT]: " + ELEMENT_BYTES[name],
        "[length]: " + length,
        "[byteLength]: " + typedArrayByteLength(array),
        "[byteOffset]: " + typedArrayByteOffset(array),
        "[buffer]: " + bufferName + " { [byteLength]: " + (bufferName === "SharedArrayBuffer" ? sharedArrayBufferLength(buffer) : arrayBufferLength(buffer)) + " }",
      ];
      for (let i = 0; i < hidden.length; i++) {
        parts[parts.length] = hidden[i];
        state.left -= hidden[i].length;
      }
    }
    // Listing the own keys of a typed array makes one key for each item, so
    // the properties added to a long one are not shown.
    if (length <= MAX_TYPED_KEYS) addProperties(array, parts, depth, state, true, false, true);
    if (parts.length === 0) currentDepth = before;
    let numeric = true;
    for (let i = 0; numeric && i < parts.length; i++) {
      numeric = typeof array[i] === "number" || typeof array[i] === "bigint";
    }
    const prefix = prefixFor(constructorName(array), name, name, "(" + length + ")");
    return layout(reference(array, state) + prefix, "[", parts, "]", depth, ARRAY, numeric);
  }

  // Whether a buffer is a SharedArrayBuffer, which is told by its length getter
  // throwing for anything else. A tag set by the program does not count.
  function isSharedBuffer(buffer) {
    try {
      sharedArrayBufferLength(buffer);
      return true;
    } catch (ignored) {
      return false;
    }
  }

  // The first bytes of a buffer, then the length of it and what was added to it.
  function formatArrayBuffer(buffer, depth, state) {
    const shared = isSharedBuffer(buffer);
    const length = shared ? sharedArrayBufferLength(buffer) : arrayBufferLength(buffer);
    const shown = length < MAX_ENTRIES ? length : MAX_ENTRIES;
    const bytes = new NativeUint8Array(buffer, 0, shown);
    let hex = "";
    for (let i = 0; i < shown; i++) hex += (i > 0 ? " " : "") + hexByte(bytes[i]);
    if (length > shown) {
      state.cut = true;
      hex += " ... " + (length - shown) + " more byte" + (length - shown === 1 ? "" : "s");
    }

    const parts = ["[Uint8Contents]: <" + hex + ">", "[byteLength]: " + length];
    enter(depth);
    addProperties(buffer, parts, depth, state, false);
    const name = constructorName(buffer);
    const kind = shared ? "SharedArrayBuffer" : "ArrayBuffer";
    const prefix = name === kind || name === null ? kind + " " : name + " [" + kind + "] ";
    return layout(reference(buffer, state) + prefix, "{", parts, "}", depth);
  }

  function formatDataView(view, depth, state) {
    const parts = ["[byteLength]: " + dataViewLength(view), "[byteOffset]: " + dataViewOffset(view)];
    enter(depth);
    parts[parts.length] = "[buffer]: " + format(dataViewBuffer(view), depth + 1, state);
    addProperties(view, parts, depth, state, false);
    const name = constructorName(view);
    const prefix = name === "DataView" || name === null ? "DataView " : name + " [DataView] ";
    return layout(reference(view, state) + prefix, "{", parts, "}", depth);
  }

  function formatMap(map, depth, state) {
    const size = mapSize(map);
    const parts = [];
    const before = enter(depth);
    mapForEach(map, function (value, key) {
      if (parts.length >= MAX_ENTRIES || state.left <= 0) return;
      const part = format(key, depth + 1, state) + " => " + format(value, depth + 1, state);
      parts[parts.length] = part;
      state.left -= part.length;
    });
    if (size > parts.length) {
      state.cut = true;
      parts[parts.length] = more(size - parts.length, "item", "items");
    }
    addProperties(map, parts, depth, state, false);
    if (parts.length === 0) currentDepth = before;
    return layout(reference(map, state) + subclassPrefix(map, "Map", size), "{", parts, "}", depth);
  }

  function formatSet(set, depth, state) {
    const size = setSize(set);
    const parts = [];
    const before = enter(depth);
    setForEach(set, function (value) {
      if (parts.length >= MAX_ENTRIES || state.left <= 0) return;
      const part = format(value, depth + 1, state);
      parts[parts.length] = part;
      state.left -= part.length;
    });
    if (size > parts.length) {
      state.cut = true;
      parts[parts.length] = more(size - parts.length, "item", "items");
    }
    addProperties(set, parts, depth, state, false);
    if (parts.length === 0) currentDepth = before;
    return layout(reference(set, state) + subclassPrefix(set, "Set", size), "{", parts, "}", depth);
  }

  // Prototype -> function that lists what to show of an instance of a class the
  // extras define (URL and the like), whose state is not in visible properties.
  const inspectors = new Map();
  // The classes whose subclasses are shown the same way, such as Buffer.
  const inheritedInspectors = new Map();
  // The classes whose instances %s turns into text with their own toString, as Node
  // does for a Buffer.
  const textClasses = new Map();
  let anyInherited = false;

  function registerInspector(Class, inspect, inherit, asText) {
    mapSet(inspectors, Class.prototype, inspect);
    if (inherit) {
      mapSet(inheritedInspectors, Class.prototype, inspect);
      anyInherited = true;
    }
    if (asText) mapSet(textClasses, Class.prototype, true);
  }

  function isTextClass(value) {
    if (!anyInherited) return false;
    for (let proto = getPrototypeOf(value); proto !== null; proto = getPrototypeOf(proto)) {
      if (mapGet(textClasses, proto) === true) return true;
    }
    return false;
  }

  // The inspector of an object: the one of its own class, or of a class it
  // inherits from when that one was registered for its subclasses.
  function findInspector(value) {
    const own = getPrototypeOf(value);
    const inspect = mapGet(inspectors, own);
    if (inspect !== undefined || !anyInherited) return inspect;
    for (let proto = own; proto !== null; proto = getPrototypeOf(proto)) {
      const inherited = mapGet(inheritedInspectors, proto);
      if (inherited !== undefined) return inherited;
    }
    return undefined;
  }

  function formatInspected(inspect, name, value, depth, state) {
    const described = inspect(value);
    if (described.text !== undefined) return described.text;
    const entries = described.entries;
    const parts = [];
    const before = enter(depth);

    for (let i = 0; i < entries.length && i < MAX_ENTRIES && state.left > 0; i++) {
      const shown = format(entries[i][1], depth + 1, state);
      const part = described.map
        ? format(entries[i][0], depth + 1, state) + " => " + shown
        : entries[i][0] + ": " + shown;
      parts[parts.length] = part;
      state.left -= part.length;
    }
    if (entries.length > parts.length) {
      state.cut = true;
      parts[parts.length] = more(entries.length - parts.length, "item", "items");
    }
    if (parts.length === 0) currentDepth = before;
    return layout(reference(value, state) + name + " ", "{", parts, "}", depth);
  }

  // An array index such as "0" or "12", which an array already shows as an item.
  function isIndexKey(key) {
    const length = key.length;
    if (length === 0 || (length > 1 && stringCharCodeAt(key, 0) === 48)) return false;
    for (let i = 0; i < length; i++) {
      const c = stringCharCodeAt(key, i);
      if (c < 48 || c > 57) return false;
    }
    return true;
  }

  // Adds "key: value" for each enumerable own property to parts, and says how
  // many it left out for want of room. Indexes are skipped for the objects that
  // list their items on their own.
  function addProperties(object, parts, depth, state, skipIndexes, skipErrorFields, uncapped) {
    const names = getOwnPropertyNames(object);
    const symbols = getOwnPropertySymbols(object);
    let seen = 0;

    for (let pass = 0; pass < 2; pass++) {
      const keys = pass === 0 ? names : symbols;
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const hidden = !isEnumerable(object, key);
        if (hidden && !showHidden) continue;
        if (skipIndexes && pass === 0 && isIndexKey(key)) continue;
        if (skipErrorFields && pass === 0 && (key === "name" || key === "message" || key === "stack")) continue;
        if ((parts.length >= MAX_ENTRIES && !uncapped) || state.left <= 0) {
          seen++;
          continue;
        }

        const descriptor = getOwnPropertyDescriptor(object, key);
        const label = pass === 1 ? escapeBody(symbolToString(key), "'")
          : key === "__proto__" ? "['__proto__']"
          : isIdentifier(key) ? key
          : quote(key, state);
        let value;
        if (descriptor.get || descriptor.set) {
          value = descriptor.get ? (descriptor.set ? "[Getter/Setter]" : "[Getter]") : "[Setter]";
        } else {
          value = format(descriptor.value, depth + 1, state);
        }
        const part = (hidden ? "[" + label + "]" : label) + ": " + value;
        parts[parts.length] = part;
        state.left -= part.length;
      }
    }

    if (seen > 0) {
      state.cut = true;
      parts[parts.length] = more(seen, "property", "properties");
    }
  }

  function formatProperties(object, prefix, depth, state) {
    const parts = [];
    const before = enter(depth);
    addProperties(object, parts, depth, state, false);
    if (parts.length === 0) currentDepth = before;
    return layout(reference(object, state) + prefix, "{", parts, "}", depth);
  }

  // Text that stands for the whole value, followed by the properties that were
  // added to it, as in `[Function: f] { calls: 2 }`.
  function withProperties(text, object, depth, state, skipIndexes) {
    const parts = [];
    const before = enter(depth);
    addProperties(object, parts, depth, state, skipIndexes);
    if (parts.length === 0) currentDepth = before;
    return parts.length === 0 ? text : layout(reference(object, state) + text + " ", "{", parts, "}", depth, BASE);
  }

  // An error shows as its name and message, and the properties added to it,
  // such as a code, the error that caused it or the errors an AggregateError
  // holds, follow.
  function formatError(error, depth, state) {
    const text = errorText(error, state);
    const parts = [];
    const before = enter(depth);
    addProperties(error, parts, depth, state, false, true);
    if (hasOwn(error, "cause") && !isEnumerable(error, "cause")) {
      parts[parts.length] = "[cause]: " + format(error.cause, depth + 1, state);
    }
    if (hasOwn(error, "errors") && !isEnumerable(error, "errors") && isArray(error.errors)) {
      parts[parts.length] = "[errors]: " + format(error.errors, depth + 1, state);
    }

    if (parts.length === 0) currentDepth = before;
    const shown = depth === 0 ? text : "[" + text + "]";
    return parts.length === 0 ? shown : layout(reference(error, state) + shown + " ", "{", parts, "}", depth, BASE);
  }

  // A promise shows what it was settled with, or that it has not been. The
  // host reads that off it: the guest has no way to.
  function formatPromise(promise, depth, state) {
    if (depth > depthLimit) return "[Promise]";

    const name = constructorName(promise);
    const prefix = name === "Promise" || name === null ? "Promise " : name + " [Promise] ";
    const before = enter(depth);
    const settled = promiseState(promise);
    let part = "<pending>";
    if (settled[0] !== "pending") {
      part = (settled[0] === "rejected" ? "<rejected> " : "") + format(settled[1], depth + 1, state);
    } else {
      currentDepth = before;
    }
    return layout(reference(promise, state) + prefix, "{", [part], "}", depth);
  }

  // The prefix Node puts before an object: its constructor name, then its tag when
  // the tag is another name, then the size. A null prototype is said so.
  // A tag that ends in ".Name" stands for the class Name, as Intl.Locale does.
  function namesClass(name, tag) {
    return name !== null && tag.length > name.length && stringSlice(tag, tag.length - name.length - 1) === "." + name;
  }

  function prefixFor(name, tag, fallback, size) {
    if (name === null) {
      return "[" + fallback + size + ": null prototype] " + (tag !== "" && tag !== fallback ? "[" + tag + "] " : "");
    }
    if (tag !== "" && name !== tag) return (namesClass(name, tag) ? tag + size : name + size + " [" + tag + "]") + " ";
    return name + size + " ";
  }

  // The tag an object shows after its name: its Symbol.toStringTag, unless the
  // program made it an own enumerable property, which is shown as a property.
  function tagOf(value) {
    try {
      const tag = value[Symbol.toStringTag];
      if (typeof tag !== "string" || isEnumerable(value, Symbol.toStringTag)) return "";
      return tag;
    } catch (ignored) {
      return "";
    }
  }

  // Whether a value is a Date or a RegExp by its internal slots, which a tag
  // the program sets cannot change. The RegExp prototype is not one of them.
  // A date or a regular expression reports its own tag unless the program changed
  // it. Only those and tags nothing else reports are looked at: the checks throw
  // for anything else, and a throw is slow to make.
  function slotKindOf(value, reported) {
    if (reported !== "[object Date]" && reported !== "[object RegExp]" && mapGet(knownTags, reported) !== undefined) return "";
    try {
      dateTimeOf(value);
      return "Date";
    } catch (ignored) {}
    if (value !== regExpPrototype) {
      try {
        regExpSourceOf(value);
        return "RegExp";
      } catch (ignored) {}
    }
    return "";
  }

  function formatDate(value, depth, state) {
    let text = "Invalid Date";
    try { text = dateToISOString(value); } catch (ignored) {}
    const prefix = prefixFor(constructorName(value), tagOf(value), "Date", "");
    return withProperties(prefix === "Date " ? text : prefix + text, value, depth, state);
  }

  // A RegExp without a prototype has no source or flags to read through one, so
  // it is printed from a copy made with the same pattern and flags.
  function formatRegExp(value, depth, state) {
    const name = constructorName(value);
    const text = regExpToString(name === null ? new NativeRegExp(value) : value);
    const prefix = prefixFor(name, tagOf(value), "RegExp", "");
    return withProperties(prefix === "RegExp " ? text : prefix + text, value, depth, state);
  }

  // An empty object, array, map, set or typed array is shown as it is even past
  // the depth limit, since there is nothing in it to go down into.
  function isEmptyContainer(value, tag) {
    if (getKeys(value).length !== 0) return false;
    const symbols = getOwnPropertySymbols(value);
    for (let i = 0; i < symbols.length; i++) {
      if (isEnumerable(value, symbols[i])) return false;
    }
    if (isArray(value)) return value.length === 0;
    if (tag === "[object Map]") return mapSize(value) === 0;
    if (tag === "[object Set]") return setSize(value) === 0;
    for (let i = 0; i < TYPED_ARRAYS.length; i++) {
      if (tag === "[object " + TYPED_ARRAYS[i] + "]") return typedArrayLength(value) === 0;
    }
    return true;
  }

  function formatObject(value, depth, state) {
    // What is left to read from these cannot be seen without taking it, so only
    // the kind is shown. Its prototype tells what it is, without running a tag.
    const prototype = getPrototypeOf(value);
    // Buffers are told apart before their tag is read, since a program can make
    // reading that run its code.
    if (prototype === arrayBufferPrototype && hasSlotsOf(value, "[object ArrayBuffer]")) {
      return depth > depthLimit ? "[ArrayBuffer]" : formatArrayBuffer(value, depth, state);
    }
    if (prototype === dataViewPrototype && hasSlotsOf(value, "[object DataView]")) {
      return depth > depthLimit ? "[DataView]" : formatDataView(value, depth, state);
    }
    if (prototype === mapIteratorPrototype) return "[Map Iterator] { <items unknown> }";
    if (prototype === setIteratorPrototype) return "[Set Iterator] { <items unknown> }";

    const reported = objectToString(value);
    const tag = kindOf(value, reported);

    const slot = slotKindOf(value, reported);
    if (slot === "Date") return formatDate(value, depth, state);
    if (slot === "RegExp") return formatRegExp(value, depth, state);
    if (tag === "[object Error]" || tag === "[object DOMException]") return formatError(value, depth, state);
    if (tag === "[object Number]") return withProperties("[Number: " + formatNumber(numberValueOf(value)) + "]", value, depth, state);
    if (tag === "[object String]") return withProperties("[String: " + quote(stringValueOf(value), state) + "]", value, depth, state, true);
    if (tag === "[object Boolean]") return withProperties("[Boolean: " + booleanValueOf(value) + "]", value, depth, state);
    if (tag === "[object BigInt]") return withProperties("[BigInt: " + bigintToString(bigintValueOf(value)) + "n]", value, depth, state);
    if (tag === "[object Symbol]") return withProperties("[Symbol: " + symbolToString(symbolValueOf(value)) + "]", value, depth, state);
    if (tag === "[object Promise]") return formatPromise(value, depth, state);
    if (tag === "[object WeakMap]") return "WeakMap { <items unknown> }";
    if (tag === "[object WeakSet]") return "WeakSet { <items unknown> }";
    if (tag === "[object ArrayBuffer]") return depth > depthLimit ? "[ArrayBuffer]" : formatArrayBuffer(value, depth, state);
    if (tag === "[object SharedArrayBuffer]" && isSharedBuffer(value)) return depth > depthLimit ? "[SharedArrayBuffer]" : formatArrayBuffer(value, depth, state);
    if (tag === "[object DataView]") return depth > depthLimit ? "[DataView]" : formatDataView(value, depth, state);

    const name = constructorName(value);
    const label = name === null ? "[" + (tag === "[object Object]" ? nullPrototypeName(value) : stringSlice(tag, 8, tag.length - 1)) + ": null prototype]" : name;

    if (depth > depthLimit && !isEmptyContainer(value, tag)) {
      if (name === null) return isArray(value) ? "[Array: null prototype]" : label;
      return "[" + (isArray(value) ? "Array" : label) + "]";
    }

    const inspect = findInspector(value);
    if (inspect !== undefined) return formatInspected(inspect, label, value, depth, state);

    if (isArray(value)) return formatArray(value, depth, state);
    if (tag === "[object Map]") return formatMap(value, depth, state);
    if (tag === "[object Set]") return formatSet(value, depth, state);
    for (let i = 0; i < TYPED_ARRAYS.length; i++) {
      if (tag === "[object " + TYPED_ARRAYS[i] + "]") return formatTypedArray(value, TYPED_ARRAYS[i], depth, state);
    }

    // A tag the object has as an own property is shown as a property already.
    const tagName = tagOf(value);
    let prefix = (name === null ? label : name) + " ";
    if (reported === "[object Arguments]" && name === "Object") prefix = "[Arguments] ";
    else if (tagName !== "" && tagName !== name) prefix = namesClass(name, tagName) ? tagName + " " : prefix + "[" + tagName + "] ";
    else if (name === "Object") prefix = "";
    return formatProperties(value, prefix, depth, state);
  }

  // The one entry point for turning any value into text. state.left is the
  // remaining character budget; state.cut records that something was dropped.
  function format(value, depth, state) {
    if (depth === 0) state.circular = undefined;
    switch (typeof value) {
      case "string": return quote(value, state);
      case "number": return formatNumber(value);
      case "bigint": return bigintToString(value) + "n";
      case "boolean": return value ? "true" : "false";
      case "undefined": return "undefined";
      case "symbol": return symbolToString(value);
    }
    if (value === null) return "null";

    if (proxiesMade) {
      // A proxy is shown as its target inside Proxy(...), as Node shows it, and none of its traps run.
      const target = weakMapGet(proxyTargets, value);
      if (target === null) return "<Revoked Proxy>";
      if (target !== undefined) return "Proxy(" + format(target, depth, state) + ")";
    }

    for (let i = 0; i < state.stack.length; i++) {
      if (state.stack[i] === value) {
        if (state.circular === undefined) state.circular = new Map();
        let index = mapGet(state.circular, value);
        if (index === undefined) {
          index = mapSize(state.circular) + 1;
          mapSet(state.circular, value, index);
        }
        return "[Circular *" + index + "]";
      }
    }
    state.stack[state.stack.length] = value;
    try {
      if (typeof value === "function") {
        const text = formatFunction(value);
        return depth > depthLimit ? text : withProperties(text, value, depth, state);
      }
      return formatObject(value, depth, state);
    } catch (ignored) {
      return "[Unformattable object]";
    } finally {
      state.stack.length = state.stack.length - 1;
    }
  }

  function render(value, limit, raw) {
    const state = { left: limit, cut: false, stack: [] };
    let text;
    try {
      text = raw && typeof value === "string" ? value : format(value, 0, state);
    } catch (ignored) {
      text = "[Unformattable value]";
    }
    return { text: bound(text, limit, state), cut: state.cut };
  }

  // Where an error came from in the user's code, read off its stack: "line" or
  // "line:column", and "0" when the stack does not say. The column is counted in
  // code points from 1, as the engine counts it.
  function whereOf(error) {
    try {
      const stack = error.stack;
      if (typeof stack !== "string") return "0";
      const at = stringIndexOf(stack, FILE + ":");
      if (at === -1) return "0";

      const numbers = [0, 0];
      let field = 0;
      for (let i = at + FILE.length + 1; i < stack.length && i < at + FILE.length + 20; i++) {
        const c = stack[i];
        if (c === ":" && field === 0) {
          field = 1;
          continue;
        }
        if (c < "0" || c > "9") break;
        numbers[field] = numbers[field] * 10 + (stringCharCodeAt(c, 0) - 48);
      }
      if (numbers[0] === 0) return "0";

      return numbers[1] > 0 ? numbers[0] + ":" + numbers[1] : "" + numbers[0];
    } catch (ignored) {
      return "0";
    }
  }

  function isErrorLike(value) {
    try {
      if (typeof value !== "object" || value === null) return false;
      const tag = objectToString(value);
      return tag === "[object Error]" || tag === "[object DOMException]" || inherits(value, errorPrototype);
    } catch (ignored) {
      return false;
    }
  }

  function flags(resultCut) {
    return (resultCut ? 1 : 0) + (logsCutShort ? 2 : 0);
  }

  function packOk(value) {
    const rendered = render(value, maxResultLength, true);
    return "o\n0\n" + flags(rendered.cut) + "\n" + rendered.text;
  }

  function packError(error) {
    let text;
    let where = "0";
    let cutShort = false;

    if (isErrorLike(error)) {
      const state = { left: maxResultLength, cut: false, stack: [] };
      text = bound(errorText(error, state), maxResultLength, state);
      cutShort = state.cut;
      where = whereOf(error);
    } else {
      const rendered = render(error, maxResultLength, false);
      text = "Uncaught " + rendered.text;
      cutShort = rendered.cut;
    }
    return "e\n" + where + "\n" + flags(cutShort) + "\n" + text;
  }

  // Settles with a packed string whether the code returned or threw.
  async function finish(pending) {
    let value;
    let failed = false;
    try {
      value = await pending;
    } catch (error) {
      value = error;
      failed = true;
    }
    return failed ? packError(value) : packOk(value);
  }

  function fail(error) {
    return packError(error);
  }

  function indent(text) {
    let out = groupIndent;
    for (let i = 0; i < text.length; i++) {
      out += text[i];
      if (text[i] === "\n") out += groupIndent;
    }
    return out;
  }

  const toNumber = Number;
  const parseInteger = parseInt;
  const parseDecimal = parseFloat;
  const toJson = JSON.stringify;

  // The names of the constructors the engine and this runtime put on the
  // global object, which are the ones Node counts as built in: a name that
  // starts with a capital letter, then letters and digits.
  const builtInNames = new Map();
  function collectBuiltInNames() {
    const names = getOwnPropertyNames(globalThis);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      let plain = name.length > 1 && name[0] >= "A" && name[0] <= "Z";
      for (let j = 1; plain && j < name.length; j++) {
        const c = name[j];
        plain = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9");
      }
      if (plain) mapSet(builtInNames, name, true);
    }
  }

  // Whether the program, rather than the engine, gave `value` the property
  // `key`: on the object itself, or on a prototype of a class of its own.
  function programDefined(value, key) {
    let holder = value;
    while (holder !== null && !hasOwn(holder, key)) holder = getPrototypeOf(holder);
    if (holder === null) return false;
    if (holder === value) return true;
    const descriptor = getOwnPropertyDescriptor(holder, "constructor");
    return !(descriptor !== undefined && typeof descriptor.value === "function" && mapGet(builtInNames, descriptor.value.name) === true);
  }

  // Whether %s should show an object as it would be printed rather than turn
  // it into text, which is so unless the program wrote its toString or
  // Symbol.toPrimitive (Node's rule).
  function hasBuiltInToString(value) {
    try {
      if (typeof value[Symbol.toPrimitive] === "function" && programDefined(value, Symbol.toPrimitive)) return false;
      return typeof value.toString !== "function" || !programDefined(value, "toString");
    } catch (ignored) {
      return true;
    }
  }

  // What a % specifier of console.log stands for. Objects are shown, and only
  // those with a toString of the program's own are converted by it.
  function substitute(code, argument, state) {
    switch (code) {
      case "s": {
        if (typeof argument === "string") return argument;
        if (typeof argument === "function") return toText(argument);
        if (typeof argument !== "object" || argument === null) return format(argument, 0, state);

        if (!hasBuiltInToString(argument) || isTextClass(argument)) {
          try {
            return toText(argument);
          } catch (ignored) {}
        }

        // Node shows an object one level deep here, whatever it would be shown to otherwise.
        const limit = depthLimit;
        depthLimit = 0;
        try {
          return format(argument, 0, state);
        } finally {
          depthLimit = limit;
        }
      }
      case "o": {
        // Node's %o shows hidden properties and goes four levels down.
        const limit = depthLimit;
        const hiddenBefore = showHidden;
        depthLimit = 4;
        showHidden = true;
        try {
          return format(argument, 0, state);
        } finally {
          depthLimit = limit;
          showHidden = hiddenBefore;
        }
      }
      case "d":
      case "i":
      case "f":
        if (typeof argument === "bigint") return bigintToString(argument) + "n";
        if (typeof argument === "symbol") return "NaN";
        return formatNumber(code === "d" ? toNumber(argument) : code === "i" ? parseInteger(argument) : parseDecimal(argument));
      case "j":
        try {
          const json = toJson(argument);
          return json === undefined ? "undefined" : json;
        } catch (ignored) {
          return "[Circular]";
        }
      case "c":
        return "";
      default:
        return format(argument, 0, state);
    }
  }

  // The arguments of console.log with its specifiers filled in from the ones
  // after the first. Returns the text, and how many arguments were used.
  function fill(args, state) {
    const template = args[0];
    let out = "";
    let from = 0;
    let used = 1;

    for (let i = 0; i < template.length - 1; i++) {
      if (stringCharCodeAt(template, i) !== 37) continue;

      const code = template[i + 1];
      if (code === "%") {
        out += stringSlice(template, from, i + 1);
        from = i + 2;
        i++;
      } else if (used < args.length && stringIndexOf("sdifjoOc", code) >= 0) {
        out += stringSlice(template, from, i) + substitute(code, args[used++], state);
        from = i + 2;
        i++;
      }
    }

    return { text: out + stringSlice(template, from), used };
  }

  function write() {
    if (logCount >= maxLogs) {
      logsCutShort = true;
      return;
    }
    logCount++;

    const state = { left: maxLogLength, cut: false, stack: [] };
    let line = "";
    let first = 0;
    if (arguments.length > 1 && typeof arguments[0] === "string" && stringIndexOf(arguments[0], "%") >= 0) {
      try {
        const filled = fill(arguments, state);
        line = filled.text;
        first = filled.used;
      } catch (ignored) {
        line = "";
      }
    }
    for (let i = first; i < arguments.length; i++) {
      const argument = arguments[i];
      let piece;
      try {
        piece = typeof argument === "string" && !quoteStrings ? argument : format(argument, 0, state);
      } catch (ignored) {
        piece = "[Unformattable value]";
      }
      line += (i > 0 ? " " : "") + piece;
      if (line.length > maxLogLength) break;
    }
    if (groupIndent) line = indent(line);
    line = bound(line, maxLogLength, state);
    if (state.cut) logsCutShort = true;
    hostLog(line);
  }

  function assert(condition) {
    if (condition) return;
    if (arguments.length < 2) {
      write("Assertion failed");
      return;
    }

    // A message that is a string continues the words, so its specifiers are filled.
    const details = typeof arguments[1] === "string" ? ["Assertion failed: " + arguments[1]] : ["Assertion failed", arguments[1]];
    for (let i = 2; i < arguments.length; i++) details[details.length] = arguments[i];
    reflectApply(write, undefined, details);
  }

  const counts = Object.create(null);

  function count(label) {
    const key = label === undefined ? "default" : toText(label);
    counts[key] = (counts[key] || 0) + 1;
    write(key + ": " + counts[key]);
  }

  function countReset(label) {
    counts[label === undefined ? "default" : toText(label)] = 0;
  }

  function group() {
    if (arguments.length > 0) reflectApply(write, undefined, arguments);
    groupIndent += "  ";
  }

  function groupEnd() {
    groupIndent = stringSlice(groupIndent, 2);
  }

  function cell(value) {
    const text = render(value, TABLE_CELL_WIDTH, false).text;
    let out = "";
    for (let i = 0; i < text.length; i++) out += text[i] === "\n" ? " " : text[i];
    return out;
  }

  // Laid out like Node's console.table: an (index) column, one column for each
  // key found in the rows, and a Values column for rows that are not objects.
  function table(data, only) {
    if (typeof data !== "object" || data === null) {
      write(data);
      return;
    }

    const tag = objectToString(data);
    if (tag === "[object Map]" || tag === "[object Set]") {
      tableOfCollection(data, tag === "[object Map]");
      return;
    }

    const columns = [];
    const known = Object.create(null);
    // The columns the caller asked for, which stay even when no row has them.
    const chosen = isArray(only);
    if (chosen) {
      for (let i = 0; i < only.length && columns.length < MAX_TABLE_COLUMNS; i++) {
        const name = toText(only[i]);
        if (!known[name]) {
          known[name] = true;
          columns[columns.length] = name;
        }
      }
    }
    const rows = [];
    let hasValues = false;
    const keys = getKeys(data);
    if (keys.length > MAX_TABLE_ROWS) logsCutShort = true;

    for (let i = 0; i < keys.length && i < MAX_TABLE_ROWS; i++) {
      const row = { index: keys[i], cells: Object.create(null), value: "" };
      let item;
      try {
        item = data[keys[i]];
      } catch (ignored) {
        item = undefined;
      }

      if (typeof item === "object" && item !== null) {
        const fields = getKeys(item);
        for (let j = 0; j < fields.length; j++) {
          if (!known[fields[j]]) {
            if (chosen) continue;
            if (columns.length >= MAX_TABLE_COLUMNS) {
              logsCutShort = true;
              continue;
            }
            known[fields[j]] = true;
            columns[columns.length] = fields[j];
          }
          try {
            row.cells[fields[j]] = cell(item[fields[j]]);
          } catch (ignored) {
            row.cells[fields[j]] = "[Unreadable]";
          }
        }
      } else {
        hasValues = true;
        row.value = cell(item);
      }
      rows[rows.length] = row;
    }

    // The columns the rows found are ordered as the keys of an object are, so a number-like key comes first.
    const names = chosen ? columns : getKeys(known);
    const headers = ["(index)"];
    for (let i = 0; i < names.length; i++) headers[headers.length] = names[i];
    if (hasValues) headers[headers.length] = "Values";

    const body = [];
    for (let i = 0; i < rows.length; i++) {
      const parts = [rows[i].index];
      for (let j = 0; j < names.length; j++) parts[parts.length] = rows[i].cells[names[j]] || "";
      if (hasValues) parts[parts.length] = rows[i].value;
      body[body.length] = parts;
    }

    drawTable(headers, body);
  }

  // A map or a set, one row for each entry.
  function tableOfCollection(collection, isMap) {
    const headers = isMap ? ["(iteration index)", "Key", "Values"] : ["(iteration index)", "Values"];
    const body = [];
    let count = 0;
    function add(value, key) {
      if (count++ >= MAX_TABLE_ROWS) {
        logsCutShort = true;
        return;
      }
      const row = [numberToString(body.length, 10)];
      if (isMap) row[row.length] = cell(key);
      row[row.length] = cell(value);
      body[body.length] = row;
    }
    if (isMap) mapForEach(collection, add);
    else setForEach(collection, add);

    drawTable(headers, body);
  }

  let measure;

  // How many columns text takes in a monospace font, which is not always its
  // length. The table of wide characters is only read when the text needs it.
  function columns(text) {
    let width = 0;
    for (let i = 0; i < text.length; i++) {
      const code = stringCharCodeAt(text, i);
      if (code >= 0x300) {
        if (measure === undefined) measure = indirectEval(loadExtra("width"))();
        return measure(text);
      }
      if (code >= 0x20 && (code < 0x7f || code > 0x9f)) width++;
    }
    return width;
  }

  function drawTable(headers, body) {
    const widths = [];
    for (let i = 0; i < headers.length; i++) {
      let width = columns(headers[i]);
      for (let j = 0; j < body.length; j++) {
        const own = columns(body[j][i]);
        if (own > width) width = own;
      }
      widths[i] = width + 2;
    }

    function rule(left, middle, right) {
      let out = left;
      for (let i = 0; i < widths.length; i++) {
        for (let j = 0; j < widths[i]; j++) out += "─";
        out += i < widths.length - 1 ? middle : right;
      }
      return out;
    }

    function line(parts) {
      let out = "│";
      for (let i = 0; i < parts.length; i++) {
        out += " " + parts[i];
        for (let j = columns(parts[i]) + 1; j < widths[i]; j++) out += " ";
        out += "│";
      }
      return out;
    }

    let out = rule("┌", "┬", "┐") + "\n" + line(headers) + "\n" + rule("├", "┼", "┤");
    for (let i = 0; i < body.length; i++) out += "\n" + line(body[i]);
    write(out + "\n" + rule("└", "┴", "┘"));
  }

  function trace() {
    if (arguments.length === 0) {
      write("Trace");
      return;
    }

    const details = ["Trace:"];
    for (let i = 0; i < arguments.length; i++) details[i + 1] = arguments[i];
    reflectApply(write, undefined, details);
  }

  // Started timers by label, with the moment each began on the sandbox clock.
  const timersStarted = Object.create(null);

  function time(label) {
    const key = label === undefined ? "default" : toText(label);
    if (timersStarted[key] === undefined) timersStarted[key] = performance.now();
  }

  function elapsed(key) {
    const ms = performance.now() - timersStarted[key];
    return key + ": " + (ms >= 1000 ? numberToFixed(ms / 1000, 3) + "s" : numberToFixed(ms, 3) + "ms");
  }

  function timeLog(label) {
    const key = label === undefined ? "default" : toText(label);
    if (timersStarted[key] === undefined) return;

    const details = [elapsed(key)];
    for (let i = 1; i < arguments.length; i++) details[i] = arguments[i];
    reflectApply(write, undefined, details);
  }

  function timeEnd(label) {
    const key = label === undefined ? "default" : toText(label);
    if (timersStarted[key] === undefined) return;

    write(elapsed(key));
    delete timersStarted[key];
  }

  // Node's second argument is options for the inspector, not another value to print.
  // Its depth, when it has one, is how far down objects are shown.
  // Node reads the depth as a number: null is no limit, and so is anything that
  // is not a number, since a comparison with it is never true; a negative depth
  // cuts the top level. showHidden shows the non-enumerable properties, for this call.
  function dir(value, options) {
    let depth = MAX_DEPTH;
    let hidden = false;
    try {
      if (typeof options === "object" && options !== null) {
        if (options.depth !== undefined) {
          const asked = options.depth === null ? Infinity : toNumber(options.depth);
          depth = asked === asked ? asked : Infinity;
        }
        hidden = !!options.showHidden;
      }
    } catch (ignored) {}

    const hiddenBefore = showHidden;
    depthLimit = depth < MAX_NESTING ? depth : MAX_NESTING;
    showHidden = hidden;
    quoteStrings = true;
    try {
      write(value);
    } finally {
      depthLimit = MAX_DEPTH;
      showHidden = hiddenBefore;
      quoteStrings = false;
    }
  }

  // Objects nested deeper than this are cut even when console.dir asks for all of them.
  const MAX_NESTING = 30;

  function clear() {}

  function timeStamp() {}

  function profile() {}

  function profileEnd() {}

  function groupCollapsed() {
    reflectApply(group, undefined, arguments);
  }

  function dirxml() {
    reflectApply(write, undefined, arguments);
  }

  // Each printing method is a function of its own, so it has its own name.
  function printer(name) {
    return {
      [name]() {
        return reflectApply(write, undefined, arguments);
      },
    }[name];
  }

  // What a built-in prints as, where the engine would show the source of the sandbox. The
  // console methods are bound functions in Node, so they are anonymous there.
  const builtInText = new WeakMap();
  function markBuiltIn(fn, anonymous) {
    weakMapSet(builtInText, fn, anonymous ? "function () { [native code] }" : "function " + fn.name + "() { [native code] }");
  }

  const console = freeze({
    log: printer("log"),
    info: printer("info"),
    warn: printer("warn"),
    error: printer("error"),
    debug: printer("debug"),
    dir,
    dirxml,
    clear,
    timeStamp,
    profile,
    profileEnd,
    assert,
    count,
    countReset,
    group,
    groupCollapsed,
    groupEnd,
    table,
    trace,
    time,
    timeLog,
    timeEnd,
  });
  Object.defineProperty(globalThis, "console", { value: console, writable: false, configurable: false, enumerable: false });
  for (const name of getOwnPropertyNames(console)) markBuiltIn(console[name], true);

  // Timers run on a virtual clock. The host calls tick() once the promise queue
  // is empty, and each call fires the earliest timer, so a sleep costs no real
  // time and a run never holds the sandbox while it waits.
  const timers = [];
  let timerClock = 0;
  let lastTimerId = 0;
  // The interval whose callback is running, so that it can clear itself.
  let firing = null;

  function schedule(timer) {
    let low = 0;
    let high = timers.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (timers[middle].at <= timer.at) low = middle + 1;
      else high = middle;
    }
    arraySplice(timers, low, 0, timer);
  }

  // What setTimeout and setInterval return: a Timeout, as in Node, whose methods work
  // on the timer. The timer is kept in a WeakMap, out of the program's reach.
  const timerHandles = new WeakMap();
  function Timeout() {}
  function timerOf(handle) {
    return weakMapHas(timerHandles, handle) ? weakMapGet(timerHandles, handle) : undefined;
  }
  const timeoutMethods = {
    ref() {
      const timer = timerOf(this);
      if (timer !== undefined) timer.ref = true;
      return this;
    },
    unref() {
      const timer = timerOf(this);
      if (timer !== undefined) timer.ref = false;
      return this;
    },
    hasRef() {
      const timer = timerOf(this);
      return timer !== undefined && timer.ref;
    },
    refresh() {
      const timer = timerOf(this);
      if (timer !== undefined) {
        for (let i = 0; i < timers.length; i++) {
          if (timers[i] === timer) {
            arraySplice(timers, i, 1);
            break;
          }
        }
        timer.at = timerClock + timer.wait;
        schedule(timer);
      }
      return this;
    },
    close() {
      clearTimeout(this);
      return this;
    },
    [Symbol.toPrimitive]() {
      const timer = timerOf(this);
      return timer === undefined ? NaN : timer.id;
    },
  };
  for (const name of Reflect.ownKeys(timeoutMethods)) {
    Object.defineProperty(Timeout.prototype, name, { value: timeoutMethods[name], writable: true, configurable: true, enumerable: false });
  }

  function addTimer(callback, delay, args, repeat) {
    if (typeof callback !== "function") {
      throw new TypeError("The callback must be a function");
    }

    const wait = delay >= 1 && delay <= MAX_TIMER_DELAY ? +delay : 1;
    const timer = {
      id: ++lastTimerId,
      at: timerClock + wait,
      wait,
      callback,
      args,
      every: repeat ? wait : 0,
      ref: true,
    };
    schedule(timer);

    const handle = new Timeout();
    weakMapSet(timerHandles, handle, timer);
    return handle;
  }

  function setTimeout(callback, delay, ...args) {
    return addTimer(callback, delay, args, false);
  }

  // An interval that is never cleared runs until the time limit, like any loop.
  function setInterval(callback, delay, ...args) {
    return addTimer(callback, delay, args, true);
  }

  function clearTimeout(handle) {
    const id = weakMapHas(timerHandles, handle) ? weakMapGet(timerHandles, handle).id : handle;
    if (firing !== null && firing.id === id) firing.every = 0;

    for (let i = 0; i < timers.length; i++) {
      if (timers[i].id === id) {
        arraySplice(timers, i, 1);
        return;
      }
    }
  }

  function clearInterval(id) {
    clearTimeout(id);
  }

  // Runs after the code that is running, like a timer of no delay.
  function setImmediate(callback, ...args) {
    return addTimer(callback, 0, args, false);
  }

  function clearImmediate(id) {
    clearTimeout(id);
  }

  // Only timers that were not unreferenced keep the run going: once the rest are
  // unreferenced, the run ends without them, as Node's event loop does.
  function tick() {
    let referenced = false;
    for (let i = 0; i < timers.length && !referenced; i++) referenced = timers[i].ref;
    if (!referenced) return false;

    const timer = arraySplice(timers, 0, 1)[0];
    timerClock = timer.at;
    firing = timer;
    try {
      timer.callback(...timer.args);
    } finally {
      firing = null;
    }
    if (timer.every > 0) {
      timer.at = timerClock + timer.every;
      schedule(timer);
    }
    return true;
  }

  const resolved = Promise.resolve();
  const promiseThen = uncurry(Promise.prototype.then);

  // An error in a callback that runs as a job is not the run's result, since by
  // then the code has moved on; it is logged the way a browser logs it.
  function uncaught(error) {
    write("Uncaught " + (isErrorLike(error) ? errorText(error, { cut: false }) : render(error, maxLogLength, false).text));
  }

  function queueMicrotask(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("The callback must be a function");
    }

    promiseThen(resolved, function () {
      try {
        callback();
      } catch (error) {
        uncaught(error);
      }
    });
  }

  // Time on the virtual clock moves when a timer fires, so a sleep shows up in
  // a measurement even though it took none of the real time.
  const dateNow = Date.now;
  const clockStart = dateNow();
  const performance = {
    now() {
      return dateNow() - clockStart + timerClock;
    },
    timeOrigin: clockStart,
    mark(name, options) {
      const at = options !== undefined && options !== null && options.startTime !== undefined ? +options.startTime : performance.now();
      const detail = options !== undefined && options !== null && options.detail !== undefined ? options.detail : null;
      const entry = { name: toText(name), entryType: "mark", startTime: at, duration: 0, detail };
      entries[entries.length] = entry;
      return entry;
    },
    measure(name, startOrOptions, endMark) {
      let start = startOrOptions;
      let end = endMark;
      let detail = null;
      if (typeof startOrOptions === "object" && startOrOptions !== null) {
        start = startOrOptions.start;
        end = startOrOptions.end;
        if (startOrOptions.detail !== undefined) detail = startOrOptions.detail;
      }
      const from = start === undefined ? 0 : markTime(start);
      const to = end === undefined ? performance.now() : markTime(end);
      const entry = { name: toText(name), entryType: "measure", startTime: from, duration: to - from, detail };
      entries[entries.length] = entry;
      return entry;
    },
    getEntries() {
      return sortedEntries(undefined, undefined);
    },
    getEntriesByName(name, type) {
      return sortedEntries(toText(name), type);
    },
    getEntriesByType(type) {
      return sortedEntries(undefined, type);
    },
    clearMarks(name) {
      clearEntries("mark", name);
    },
    clearMeasures(name) {
      clearEntries("measure", name);
    },
  };

  // The marks and measures of the run, for performance.
  const entries = [];

  function markTime(value) {
    if (typeof value === "number") return value;
    const wanted = toText(value);
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].entryType === "mark" && entries[i].name === wanted) return entries[i].startTime;
    }
    throw new SyntaxError('The "' + wanted + '" performance mark has not been set');
  }

  function sortedEntries(name, type) {
    const found = [];
    for (let i = 0; i < entries.length; i++) {
      if ((name === undefined || entries[i].name === name) && (type === undefined || entries[i].entryType === type)) {
        found[found.length] = entries[i];
      }
    }
    return found.sort((a, b) => a.startTime - b.startTime);
  }

  function clearEntries(type, name) {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].entryType === type && (name === undefined || entries[i].name === toText(name))) arraySplice(entries, i, 1);
    }
  }

  // Globals whose code is only evaluated, from source the host hands over by
  // name, when the program first reads one of them. Assigning to the global
  // replaces it as it would any other.
  const indirectEval = eval;
  const defineProperty = Object.defineProperty;

  // The timers and the clock as they are now, for extras that need them even
  // after the program has replaced the globals.
  // `extra` hands out what another extra exports, evaluating it if need be, so
  // that an extra does not depend on a global the program may have replaced.
  const loaders = Object.create(null);
  // The target of each proxy the program made, null once it is revoked. The
  // formatter only looks proxies up after the first one was made.
  const proxyTargets = new WeakMap();
  let proxiesMade = false;
  const hostFunctions = {
    setTimeout,
    queueMicrotask,
    defineProperty,
    Proxy,
    WeakRef,
    rememberProxy(proxy, target) {
      proxiesMade = true;
      weakMapSet(proxyTargets, proxy, target);
    },
    now: performance.now,
    isProxy: (value) => weakMapHas(proxyTargets, value),
    extra: (module) => loaders[module](),
  };

  // The functions an extra exports, and those its classes own, print as built-ins.
  function markBuiltIns(exported) {
    const names = getOwnPropertyNames(exported);
    for (let i = 0; i < names.length; i++) {
      const value = exported[names[i]];
      markOwnFunctions(value);
      if (typeof value === "function") markOwnFunctions(value.prototype);
    }
  }

  function markOwnFunctions(object) {
    if (object === null || (typeof object !== "object" && typeof object !== "function")) return;
    const names = getOwnPropertyNames(object);
    for (let i = 0; i < names.length; i++) {
      const descriptor = getOwnPropertyDescriptor(object, names[i]);
      if (typeof descriptor.value === "function") markBuiltIn(descriptor.value, false);
    }
  }

  function lazyGlobals(module, names, builtIns) {
    let exported;

    function load() {
      if (exported === undefined) {
        exported = indirectEval(loadExtra(module))(registerInspector, [seed0, seed1, seed2, seed3], hostFunctions);
        if (builtIns) markBuiltIns(exported);
      }
      return exported;
    }

    loaders[module] = load;

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const settle = function (value) {
        defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false });
        return value;
      };
      defineProperty(globalThis, name, {
        get() {
          return settle(load()[name]);
        },
        set: settle,
        configurable: true,
        enumerable: false,
      });
    }
  }

  // Methods the engine does not have, each taken from an extra. Each one is a stub
  // until the program calls one of them: then the extra is evaluated once and
  // every method it returns takes the place of its stub.
  function lazyMethods(module, entries) {
    let exported;

    function load() {
      if (exported === undefined) {
        exported = indirectEval(loadExtra(module))(registerInspector, [seed0, seed1, seed2, seed3], hostFunctions);
        for (let i = 0; i < entries.length; i++) {
          const [owner, name] = entries[i];
          defineProperty(owner, name, { value: exported[name], writable: true, configurable: true, enumerable: false });
        }
      }
      return exported;
    }

    for (let i = 0; i < entries.length; i++) {
      const [owner, name, length] = entries[i];
      const stub = {
        [name]() {
          load();
          return reflectApply(owner[name], this, arguments);
        },
      }[name];
      defineProperty(stub, "length", { value: length, configurable: true });
      defineProperty(owner, name, { value: stub, writable: true, configurable: true, enumerable: false });
    }
  }

  // A built-in method that is replaced by one from an extra, evaluated the
  // first time the method is called.
  function lazyMethod(module, owner, name) {
    const original = owner[name];
    let exported;
    const stub = {
      [name]() {
        if (exported === undefined) exported = indirectEval(loadExtra(module))(original, owner, zoneInfo)[name];
        return reflectApply(exported, this, arguments);
      },
    }[name];
    defineProperty(stub, "length", { value: original.length, configurable: true });

    defineProperty(owner, name, { value: stub, writable: true, configurable: true, enumerable: false });
  }

  // The engine reports a stack overflow as an InternalError. Node has a RangeError
  // for it, which is what programs test for, so the engine's errors are made to
  // look like one in that case.
  Object.setPrototypeOf(InternalError.prototype, RangeError.prototype);
  defineProperty(InternalError.prototype, "name", {
    get() {
      return this.message === STACK_OVERFLOW ? "RangeError" : "InternalError";
    },
    set(value) {
      defineProperty(this, "name", { value, writable: true, configurable: true, enumerable: false });
    },
    configurable: true,
    enumerable: false,
  });

  // Custom error classes call this in their constructors. The engine has no
  // call stack to hand over, so what the object gets is the line a stack opens
  // with.
  defineProperty(Error, "captureStackTrace", {
    value: function captureStackTrace(target) {
      if ((typeof target !== "object" || target === null) && typeof target !== "function") {
        throw new TypeError("Invalid argument");
      }
      defineProperty(target, "stack", { value: errorText(target, { cut: false }), writable: true, configurable: true, enumerable: false });
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });

  // Array.fromAsync, which the engine does not have. It always builds an Array.
  defineProperty(Array, "fromAsync", {
    value: {
      async fromAsync(items, mapfn, thisArg) {
        if (items === null || items === undefined) {
          throw new TypeError("Array.fromAsync requires an iterable, async iterable or array-like object");
        }
        if (mapfn !== undefined && typeof mapfn !== "function") {
          throw new TypeError("Array.fromAsync: the mapper is not a function");
        }

        const result = [];
        let k = 0;
        if (items[Symbol.asyncIterator] != null || items[Symbol.iterator] != null) {
          for await (const item of items) {
            result[k] = mapfn === undefined ? item : await reflectApply(mapfn, thisArg, [item, k]);
            k++;
          }
          return result;
        }

        const source = Object(items);
        const length = Math.min(Math.max(Math.trunc(+source.length) || 0, 0), Number.MAX_SAFE_INTEGER);
        for (; k < length; k++) {
          const item = await source[k];
          result[k] = mapfn === undefined ? item : await reflectApply(mapfn, thisArg, [item, k]);
        }
        return result;
      },
    }.fromAsync,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  defineProperty(Array.fromAsync, "length", { value: 1, configurable: true });

  // Closing an iterator helper (map, filter, drop and the others) whose source is
  // an Array, Map, Set or String iterator throws "not a function" in the engine,
  // because those have no return method. some, find, every, break and
  // destructuring all close the helper, so they failed unless the whole iterator
  // was read. A source without return has nothing to close.
  {
    const helperPrototype = getPrototypeOf([].values().map((value) => value));
    const helperReturn = helperPrototype.return;
    defineProperty(helperPrototype, "return", {
      value: {
        return() {
          try {
            return reflectApply(helperReturn, this, []);
          } catch (error) {
            if (error instanceof TypeError && error.message === "not a function") return { value: undefined, done: true };
            throw error;
          }
        },
      }.return,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  // The error that Promise.any rejects with has no message in the engine. Only
  // that method is wrapped, so ordinary promises cost what they did.
  const promiseAny = Promise.any;
  const AggregateErrorClass = AggregateError;
  defineProperty(Promise, "any", {
    value: {
      any(values) {
        return promiseThen(reflectApply(promiseAny, this, [values]), undefined, function (error) {
          if (error instanceof AggregateErrorClass && !hasOwn(error, "message") && hasOwn(error, "errors")) {
            defineProperty(error, "message", { value: "All promises were rejected", writable: true, configurable: true, enumerable: false });
          }
          throw error;
        });
      },
    }.any,
    writable: true,
    configurable: true,
    enumerable: false,
  });

  lazyMethod("collate", String.prototype, "localeCompare");
  // The date extra writes the three locale methods of Date.prototype, and the parts
  // Intl.DateTimeFormat uses, so it is evaluated once, by the first call of any of them.
  const engineDate = {
    toLocaleString: Date.prototype.toLocaleString,
    toLocaleDateString: Date.prototype.toLocaleDateString,
    toLocaleTimeString: Date.prototype.toLocaleTimeString,
  };
  let dateExtra;
  function loadDate() {
    if (dateExtra === undefined) dateExtra = indirectEval(loadExtra("date"))(engineDate, zoneInfo);
    return dateExtra;
  }
  loaders.date = loadDate;
  for (const name of ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"]) {
    const stub = {
      [name]() {
        return reflectApply(loadDate()[name], this, arguments);
      },
    }[name];
    defineProperty(stub, "length", { value: engineDate[name].length, configurable: true });
    defineProperty(Date.prototype, name, { value: stub, writable: true, configurable: true, enumerable: false });
  }
  lazyMethod("datestring", Date.prototype, "toString");
  lazyMethod("datestring", Date.prototype, "toTimeString");
  lazyMethod("number", Number.prototype, "toLocaleString");
  lazyMethod("number", BigInt.prototype, "toLocaleString");
  lazyMethod("arrays", Array.prototype, "join");
  lazyMethod("arrays", Array.prototype, "toLocaleString");
  lazyGlobals("clone", ["structuredClone"]);
  lazyGlobals("proxy", ["Proxy"]);
  lazyGlobals("digest", []);
  lazyGlobals("encoding", ["TextEncoder", "TextDecoder", "atob", "btoa"]);
  lazyGlobals("url", ["URL", "URLSearchParams"]);
  lazyGlobals("crypto", ["crypto"]);
  lazyGlobals("intl", ["Intl"]);
  lazyGlobals("events", ["DOMException", "Event", "CustomEvent", "EventTarget", "AbortController", "AbortSignal"]);
  lazyGlobals("weakref", ["WeakRef"]);
  lazyGlobals("buffer", ["Buffer"], true);
  lazyGlobals("disposable", ["DisposableStack", "AsyncDisposableStack", "SuppressedError"]);
  lazyGlobals("blob", ["Blob", "File"]);
  lazyMethods("bytes", [
    [Uint8Array, "fromBase64", 1],
    [Uint8Array, "fromHex", 1],
    [Uint8Array.prototype, "toBase64", 0],
    [Uint8Array.prototype, "toHex", 0],
    [Uint8Array.prototype, "setFromBase64", 1],
    [Uint8Array.prototype, "setFromHex", 1],
  ]);

  // The symbols for explicit resource management, which the engine has not got.
  for (const name of ["dispose", "asyncDispose"]) {
    if (Symbol[name] === undefined) {
      Object.defineProperty(Symbol, name, { value: Symbol("Symbol." + name), writable: false, configurable: false, enumerable: false });
    }
  }

  for (const [name, value] of [
    ["setTimeout", setTimeout],
    ["clearTimeout", clearTimeout],
    ["setInterval", setInterval],
    ["clearInterval", clearInterval],
    ["setImmediate", setImmediate],
    ["clearImmediate", clearImmediate],
    ["queueMicrotask", queueMicrotask],
    ["performance", performance],
    ["global", globalThis],
  ]) {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false });
    if (typeof value === "function") markBuiltIn(value, false);
  }

  // A built-in prints as Node prints it, on one line with no body: function max() { [native code] }.
  // A bound function is anonymous there, whatever its target was called. A program's own
  // functions keep their source as they are.
  const engineFunctionSource = Function.prototype.toString;
  const nativeBody = /\{\n    \[native code\]\n\}$/;
  const boundHead = /^function bound \(\)/;
  const functionSource = {
    toString() {
      if (weakMapHas(builtInText, this)) return weakMapGet(builtInText, this);
      const text = reflectApply(engineFunctionSource, this, []);
      return nativeBody.test(text) ? text.replace(boundHead, "function ()").replace(nativeBody, "{ [native code] }") : text;
    },
  }.toString;
  Object.defineProperty(Function.prototype, "toString", { value: functionSource, writable: true, configurable: true, enumerable: false });

  collectBuiltInNames();

  return { finish, fail, tick, uncaught };
})
