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
  // Whether a string given to write on its own is quoted, as console.dir shows it.
  let quoteStrings = false;
  const MAX_ENTRIES = 100;
  const MAX_SCAN = 100000;
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
  const weakMapSet = uncurry(WeakMap.prototype.set);
  const setForEach = uncurry(Set.prototype.forEach);
  const mapSize = uncurry(getOwnPropertyDescriptor(Map.prototype, "size").get);
  const setSize = uncurry(getOwnPropertyDescriptor(Set.prototype, "size").get);
  const TypedArray = getPrototypeOf(Uint8Array);
  const typedArrayLength = uncurry(getOwnPropertyDescriptor(TypedArray.prototype, "length").get);
  const arrayBufferLength = uncurry(getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get);
  const numberValueOf = uncurry(Number.prototype.valueOf);
  const stringValueOf = uncurry(String.prototype.valueOf);
  const booleanValueOf = uncurry(Boolean.prototype.valueOf);
  const bigintValueOf = uncurry(BigInt.prototype.valueOf);
  const symbolValueOf = uncurry(Symbol.prototype.valueOf);

  const TYPED_ARRAYS = [
    "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
    "Int32Array", "Uint32Array", "Float32Array", "Float64Array",
    "BigInt64Array", "BigUint64Array",
  ];

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
      const letter = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$";
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

    let out = mark;
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
    return out + mark + (clipped ? "..." : "");
  }

  function formatNumber(n) {
    return n === 0 && 1 / n < 0 ? "-0" : toText(n);
  }

  function constructorName(value) {
    let proto = value;
    for (let hops = 0; hops < 20; hops++) {
      proto = getPrototypeOf(proto);
      if (proto === null) return null;
      const descriptor = getOwnPropertyDescriptor(proto, "constructor");
      if (descriptor && typeof descriptor.value === "function") {
        const nameDescriptor = getOwnPropertyDescriptor(descriptor.value, "name");
        if (nameDescriptor && typeof nameDescriptor.value === "string" && nameDescriptor.value) {
          return stringSlice(nameDescriptor.value, 0, 100);
        }
      }
    }
    return null;
  }

  function formatFunction(fn) {
    const nameDescriptor = getOwnPropertyDescriptor(fn, "name");
    const name = nameDescriptor && typeof nameDescriptor.value === "string" ? stringSlice(nameDescriptor.value, 0, 100) : "";
    const source = stringSlice(functionToString(fn), 0, 6);

    if (source === "class " || source === "class{") {
      const parent = getPrototypeOf(fn);
      let extended = "";
      if (typeof parent === "function" && parent !== functionPrototype) {
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
    return name ? "[" + kind + ": " + name + "]" : "[" + kind + " (anonymous)]";
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
    if (name === null || name === base) return base === "Array" ? "" : base + "(" + size + ") ";
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
    addProperties(array, parts, depth, state, true);
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
    if (length > 0) enter(depth);
    for (let i = 0; i < length && i < MAX_ENTRIES && state.left > 0; i++) {
      const part = format(array[i], depth + 1, state);
      parts[parts.length] = part;
      state.left -= part.length;
    }
    if (length > parts.length) {
      state.cut = true;
      parts[parts.length] = more(length - parts.length, "item", "items");
    }
    return layout(reference(array, state) + name + "(" + length + ") ", "[", parts, "]", depth, ARRAY, true);
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

  function registerInspector(Class, inspect) {
    mapSet(inspectors, Class.prototype, inspect);
  }

  function formatInspected(inspect, name, value, depth, state) {
    const described = inspect(value);
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
  function addProperties(object, parts, depth, state, skipIndexes, skipErrorFields) {
    const names = getOwnPropertyNames(object);
    const symbols = getOwnPropertySymbols(object);
    let seen = 0;

    for (let pass = 0; pass < 2; pass++) {
      const keys = pass === 0 ? names : symbols;
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (!isEnumerable(object, key)) continue;
        if (skipIndexes && pass === 0 && isIndexKey(key)) continue;
        if (skipErrorFields && pass === 0 && (key === "name" || key === "message" || key === "stack")) continue;
        if (parts.length >= MAX_ENTRIES || state.left <= 0) {
          seen++;
          continue;
        }

        const descriptor = getOwnPropertyDescriptor(object, key);
        const label = pass === 1 ? "[" + symbolToString(key) + "]"
          : isIdentifier(key) ? key
          : quote(key, state);
        let value;
        if (descriptor.get || descriptor.set) {
          value = descriptor.get ? (descriptor.set ? "[Getter/Setter]" : "[Getter]") : "[Setter]";
        } else {
          value = format(descriptor.value, depth + 1, state);
        }
        const part = label + ": " + value;
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
  function withProperties(text, object, depth, state) {
    const parts = [];
    const before = enter(depth);
    addProperties(object, parts, depth, state, false);
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

  function formatObject(value, depth, state) {
    const tag = objectToString(value);

    if (tag === "[object Date]") {
      let text = "Invalid Date";
      try { text = dateToISOString(value); } catch (ignored) {}
      return withProperties(text, value, depth, state);
    }
    if (tag === "[object RegExp]") return withProperties(regExpToString(value), value, depth, state);
    if (tag === "[object Error]" || tag === "[object DOMException]") return formatError(value, depth, state);
    if (tag === "[object Number]") return "[Number: " + formatNumber(numberValueOf(value)) + "]";
    if (tag === "[object String]") return "[String: " + quote(stringValueOf(value), state) + "]";
    if (tag === "[object Boolean]") return "[Boolean: " + booleanValueOf(value) + "]";
    if (tag === "[object BigInt]") return "[BigInt: " + bigintToString(bigintValueOf(value)) + "n]";
    if (tag === "[object Symbol]") return "[Symbol: " + symbolToString(symbolValueOf(value)) + "]";
    if (tag === "[object Promise]") return formatPromise(value, depth, state);
    if (tag === "[object WeakMap]") return "WeakMap { <items unknown> }";
    if (tag === "[object WeakSet]") return "WeakSet { <items unknown> }";
    if (tag === "[object ArrayBuffer]") return "ArrayBuffer { byteLength: " + arrayBufferLength(value) + " }";

    const name = constructorName(value);
    const label = name === null ? "[Object: null prototype]" : name;

    if (depth > depthLimit) {
      return "[" + (isArray(value) ? "Array" : label) + "]";
    }

    const inspect = mapGet(inspectors, getPrototypeOf(value));
    if (inspect !== undefined) return formatInspected(inspect, label, value, depth, state);

    if (isArray(value)) return formatArray(value, depth, state);
    if (tag === "[object Map]") return formatMap(value, depth, state);
    if (tag === "[object Set]") return formatSet(value, depth, state);
    for (let i = 0; i < TYPED_ARRAYS.length; i++) {
      if (tag === "[object " + TYPED_ARRAYS[i] + "]") return formatTypedArray(value, TYPED_ARRAYS[i], depth, state);
    }

    // A tag the object has as an own property is shown as a property already.
    const tagName = tag === "[object Object]" || isEnumerable(value, Symbol.toStringTag) ? "" : stringSlice(tag, 8, tag.length - 1);
    let prefix = (name === null ? label : name) + " ";
    if (tagName !== "" && tagName !== name) prefix += "[" + tagName + "] ";
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
      // What a proxy stands for is shown, as Node does, and none of its traps run.
      let target = weakMapGet(proxyTargets, value);
      while (target !== undefined) {
        if (target === null) return "<Revoked Proxy>";
        value = target;
        target = weakMapGet(proxyTargets, value);
      }
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

  // The line of the user's code that an error came from, read off its stack.
  function lineOf(error) {
    try {
      const stack = error.stack;
      if (typeof stack !== "string") return 0;
      const at = stringIndexOf(stack, FILE + ":");
      if (at === -1) return 0;

      let line = 0;
      for (let i = at + FILE.length + 1; i < stack.length && i < at + FILE.length + 8; i++) {
        const c = stack[i];
        if (c < "0" || c > "9") break;
        line = line * 10 + (stringCharCodeAt(c, 0) - 48);
      }
      return line;
    } catch (ignored) {
      return 0;
    }
  }

  function isErrorLike(value) {
    try {
      return typeof value === "object" && value !== null
        && (objectToString(value) === "[object Error]" || objectToString(value) === "[object DOMException]" || typeof value.message === "string");
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
    let line = 0;
    let cutShort = false;

    if (isErrorLike(error)) {
      const state = { left: maxResultLength, cut: false, stack: [] };
      text = bound(errorText(error, state), maxResultLength, state);
      cutShort = state.cut;
      line = lineOf(error);
    } else {
      const rendered = render(error, maxResultLength, false);
      text = "Uncaught " + rendered.text;
      cutShort = rendered.cut;
    }
    return "e\n" + line + "\n" + flags(cutShort) + "\n" + text;
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
        if (typeof argument !== "object" || argument === null) return format(argument, 0, state);

        if (!hasBuiltInToString(argument)) {
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
      case "d":
      case "i":
      case "f":
        if (typeof argument === "bigint") return bigintToString(argument) + "n";
        if (typeof argument === "symbol" || (typeof argument === "object" && argument !== null) || typeof argument === "function") return "NaN";
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

    const headers = ["(index)"];
    for (let i = 0; i < columns.length; i++) headers[headers.length] = columns[i];
    if (hasValues) headers[headers.length] = "Values";

    const body = [];
    for (let i = 0; i < rows.length; i++) {
      const parts = [rows[i].index];
      for (let j = 0; j < columns.length; j++) parts[parts.length] = rows[i].cells[columns[j]] || "";
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
  function dir(value, options) {
    let depth = MAX_DEPTH;
    try {
      if (typeof options === "object" && options !== null && options.depth !== undefined) {
        const asked = options.depth;
        depth = asked === null || asked === Infinity ? MAX_NESTING : typeof asked === "number" && asked >= 0 ? asked : MAX_DEPTH;
      }
    } catch (ignored) {}

    depthLimit = depth < MAX_NESTING ? depth : MAX_NESTING;
    quoteStrings = true;
    try {
      write(value);
    } finally {
      depthLimit = MAX_DEPTH;
      quoteStrings = false;
    }
  }

  // Objects nested deeper than this are cut even when console.dir asks for all of them.
  const MAX_NESTING = 30;

  function clear() {}

  function dirxml() {
    reflectApply(write, undefined, arguments);
  }

  const console = freeze({
    log: write,
    info: write,
    warn: write,
    error: write,
    debug: write,
    dir,
    dirxml,
    clear,
    timeStamp: clear,
    profile: clear,
    profileEnd: clear,
    assert,
    count,
    countReset,
    group,
    groupCollapsed: group,
    groupEnd,
    table,
    trace,
    time,
    timeLog,
    timeEnd,
  });
  Object.defineProperty(globalThis, "console", { value: console, writable: false, configurable: false, enumerable: false });

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

  function addTimer(callback, delay, args, repeat) {
    if (typeof callback !== "function") {
      throw new TypeError("The callback must be a function");
    }

    const wait = delay >= 1 && delay <= MAX_TIMER_DELAY ? +delay : 1;
    const timer = {
      id: ++lastTimerId,
      at: timerClock + wait,
      callback,
      args,
      every: repeat ? wait : 0,
    };
    schedule(timer);

    return timer.id;
  }

  function setTimeout(callback, delay, ...args) {
    return addTimer(callback, delay, args, false);
  }

  // An interval that is never cleared runs until the time limit, like any loop.
  function setInterval(callback, delay, ...args) {
    return addTimer(callback, delay, args, true);
  }

  function clearTimeout(id) {
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

  function tick() {
    if (timers.length === 0) return false;

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
    rememberProxy(proxy, target) {
      proxiesMade = true;
      weakMapSet(proxyTargets, proxy, target);
    },
    now: performance.now,
    extra: (module) => loaders[module](),
  };

  function lazyGlobals(module, names) {
    let exported;

    function load() {
      if (exported === undefined) exported = indirectEval(loadExtra(module))(registerInspector, [seed0, seed1, seed2, seed3], hostFunctions);
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
  lazyMethod("date", Date.prototype, "toLocaleString");
  lazyMethod("date", Date.prototype, "toLocaleDateString");
  lazyMethod("date", Date.prototype, "toLocaleTimeString");
  lazyMethod("datestring", Date.prototype, "toString");
  lazyMethod("datestring", Date.prototype, "toTimeString");
  lazyMethod("number", Number.prototype, "toLocaleString");
  lazyMethod("number", BigInt.prototype, "toLocaleString");
  lazyGlobals("clone", ["structuredClone"]);
  lazyGlobals("proxy", ["Proxy"]);
  lazyGlobals("digest", []);
  lazyGlobals("encoding", ["TextEncoder", "TextDecoder", "atob", "btoa"]);
  lazyGlobals("url", ["URL", "URLSearchParams"]);
  lazyGlobals("crypto", ["crypto"]);
  lazyGlobals("intl", ["Intl"]);
  lazyGlobals("events", ["DOMException", "Event", "CustomEvent", "EventTarget", "AbortController", "AbortSignal"]);

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
  }

  collectBuiltInNames();

  return { finish, fail, tick, uncaught };
})
