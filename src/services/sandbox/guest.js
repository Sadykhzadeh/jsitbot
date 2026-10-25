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
(function setup(hostLog, loadExtra, maxLogs, maxLogLength, maxResultLength, seed0, seed1, seed2, seed3) {
  "use strict";

  const FILE = "input.js";
  const MAX_DEPTH = 3;
  const MAX_ENTRIES = 100;
  const MAX_SCAN = 100000;
  const LINE_WIDTH = 72;
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

  const arraySplice = uncurry(Array.prototype.splice);
  const objectToString = uncurry(Object.prototype.toString);
  const hasOwn = uncurry(Object.prototype.hasOwnProperty);
  const isEnumerable = uncurry(Object.prototype.propertyIsEnumerable);
  const stringSlice = uncurry(String.prototype.slice);
  const stringIndexOf = uncurry(String.prototype.indexOf);
  const stringCharCodeAt = uncurry(String.prototype.charCodeAt);
  const numberToString = uncurry(Number.prototype.toString);
  const functionToString = uncurry(Function.prototype.toString);
  const symbolToString = uncurry(Symbol.prototype.toString);
  const bigintToString = uncurry(BigInt.prototype.toString);
  const dateToISOString = uncurry(Date.prototype.toISOString);
  const regExpToString = uncurry(RegExp.prototype.toString);
  const mapForEach = uncurry(Map.prototype.forEach);
  const mapGet = uncurry(Map.prototype.get);
  const mapSet = uncurry(Map.prototype.set);
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
      else if (c < " ") out += "\\x" + (stringCharCodeAt(c, 0) < 16 ? "0" : "") + numberToString(stringCharCodeAt(c, 0), 16);
      else out += c;
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

  function errorText(error, state) {
    let name = "Error";
    let message = "";
    try {
      const n = error.name;
      if (typeof n === "string" && n) name = stringSlice(n, 0, 100);
      const m = error.message;
      if (typeof m === "string") message = cut(m, maxResultLength, state);
    } catch (ignored) {}
    return message ? name + ": " + message : name;
  }

  // Lays out already formatted entries: on one line when they fit, otherwise
  // one per line (or, for lists of short values, packed into rows).
  function layout(prefix, open, parts, close, depth, packable) {
    const count = parts.length;
    if (count === 0) return prefix + open + close;

    let total = prefix.length + open.length + close.length + 2;
    let multiline = false;
    let compact = packable && count > 6;
    for (let i = 0; i < count; i++) {
      total += parts[i].length + 2;
      if (stringIndexOf(parts[i], "\n") !== -1) multiline = true;
      if (parts[i].length > 12 && stringSlice(parts[i], 0, 4) !== "... ") compact = false;
    }

    if (!multiline && total <= LINE_WIDTH - depth * 2) {
      let line = prefix + open + " ";
      for (let i = 0; i < count; i++) line += (i > 0 ? ", " : "") + parts[i];
      return line + " " + close;
    }

    const inner = spaces(depth + 1);
    let out = prefix + open + "\n";

    if (compact && !multiline) {
      let row = inner;
      for (let i = 0; i < count; i++) {
        const piece = parts[i] + (i < count - 1 ? "," : "");
        if (row.length > inner.length && row.length + piece.length + 1 > LINE_WIDTH) {
          out += row + "\n";
          row = inner;
        }
        row += (row.length > inner.length ? " " : "") + piece;
      }
      return out + row + "\n" + spaces(depth) + close;
    }

    for (let i = 0; i < count; i++) {
      out += inner + parts[i] + (i < count - 1 ? "," : "") + "\n";
    }
    return out + spaces(depth) + close;
  }

  function more(count, singular, plural) {
    return "... " + count + " more " + (count === 1 ? singular : plural);
  }

  function formatArray(array, depth, state) {
    const parts = [];
    const length = array.length;
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
    return layout("", "[", parts, "]", depth, true);
  }

  function formatTypedArray(array, name, depth, state) {
    const length = typedArrayLength(array);
    const parts = [];
    for (let i = 0; i < length && i < MAX_ENTRIES && state.left > 0; i++) {
      const part = format(array[i], depth + 1, state);
      parts[parts.length] = part;
      state.left -= part.length;
    }
    if (length > parts.length) {
      state.cut = true;
      parts[parts.length] = more(length - parts.length, "item", "items");
    }
    return layout(name + "(" + length + ") ", "[", parts, "]", depth, true);
  }

  function formatMap(map, depth, state) {
    const size = mapSize(map);
    const parts = [];
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
    return layout("Map(" + size + ") ", "{", parts, "}", depth);
  }

  function formatSet(set, depth, state) {
    const size = setSize(set);
    const parts = [];
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
    return layout("Set(" + size + ") ", "{", parts, "}", depth, true);
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
    return layout(name + " ", "{", parts, "}", depth);
  }

  function formatProperties(object, prefix, depth, state) {
    const names = getOwnPropertyNames(object);
    const symbols = getOwnPropertySymbols(object);
    const parts = [];
    let seen = 0;

    for (let pass = 0; pass < 2; pass++) {
      const keys = pass === 0 ? names : symbols;
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (!isEnumerable(object, key)) continue;
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
    return layout(prefix, "{", parts, "}", depth);
  }

  function formatObject(value, depth, state) {
    const tag = objectToString(value);

    if (tag === "[object Date]") {
      try { return dateToISOString(value); } catch (ignored) { return "Invalid Date"; }
    }
    if (tag === "[object RegExp]") return regExpToString(value);
    if (tag === "[object Error]") return depth === 0 ? errorText(value, state) : "[" + errorText(value, state) + "]";
    if (tag === "[object Number]") return "[Number: " + formatNumber(numberValueOf(value)) + "]";
    if (tag === "[object String]") return "[String: " + quote(stringValueOf(value), state) + "]";
    if (tag === "[object Boolean]") return "[Boolean: " + booleanValueOf(value) + "]";
    if (tag === "[object BigInt]") return "[BigInt: " + bigintToString(bigintValueOf(value)) + "n]";
    if (tag === "[object Symbol]") return "[Symbol: " + symbolToString(symbolValueOf(value)) + "]";
    if (tag === "[object Promise]") return "Promise {}";
    if (tag === "[object WeakMap]") return "WeakMap { <items unknown> }";
    if (tag === "[object WeakSet]") return "WeakSet { <items unknown> }";
    if (tag === "[object ArrayBuffer]") return "ArrayBuffer { byteLength: " + arrayBufferLength(value) + " }";

    const name = constructorName(value);
    const label = name === null ? "[Object: null prototype]" : name;

    if (depth > MAX_DEPTH) {
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

    let prefix = "";
    if (name === null) prefix = label + " ";
    else if (name !== "Object") prefix = name + " ";
    else if (tag !== "[object Object]") prefix = "Object [" + stringSlice(tag, 8, tag.length - 1) + "] ";
    return formatProperties(value, prefix, depth, state);
  }

  // The one entry point for turning any value into text. state.left is the
  // remaining character budget; state.cut records that something was dropped.
  function format(value, depth, state) {
    switch (typeof value) {
      case "string": return quote(value, state);
      case "number": return formatNumber(value);
      case "bigint": return bigintToString(value) + "n";
      case "boolean": return value ? "true" : "false";
      case "undefined": return "undefined";
      case "symbol": return symbolToString(value);
      case "function": return formatFunction(value);
    }
    if (value === null) return "null";

    for (let i = 0; i < state.stack.length; i++) {
      if (state.stack[i] === value) return "[Circular]";
    }
    state.stack[state.stack.length] = value;
    try {
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
        && (objectToString(value) === "[object Error]" || typeof value.message === "string");
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

  function write() {
    if (logCount >= maxLogs) {
      logsCutShort = true;
      return;
    }
    logCount++;

    const state = { left: maxLogLength, cut: false, stack: [] };
    let line = "";
    for (let i = 0; i < arguments.length; i++) {
      const argument = arguments[i];
      let piece;
      try {
        piece = typeof argument === "string" ? argument : format(argument, 0, state);
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

    const details = ["Assertion failed:"];
    for (let i = 1; i < arguments.length; i++) details[i] = arguments[i];
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
  function table(data) {
    if (typeof data !== "object" || data === null) {
      write(data);
      return;
    }

    const columns = [];
    const known = Object.create(null);
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

    const widths = [];
    for (let i = 0; i < headers.length; i++) {
      let width = headers[i].length;
      for (let j = 0; j < body.length; j++) if (body[j][i].length > width) width = body[j][i].length;
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
        for (let j = parts[i].length + 1; j < widths[i]; j++) out += " ";
        out += "│";
      }
      return out;
    }

    let out = rule("┌", "┬", "┐") + "\n" + line(headers) + "\n" + rule("├", "┼", "┤");
    for (let i = 0; i < body.length; i++) out += "\n" + line(body[i]);
    write(out + "\n" + rule("└", "┴", "┘"));
  }

  // Node's second argument is options for the inspector, not another value to print.
  function dir(value) {
    write(value);
  }

  const console = freeze({
    log: write,
    info: write,
    warn: write,
    error: write,
    debug: write,
    dir,
    assert,
    count,
    countReset,
    group,
    groupCollapsed: group,
    groupEnd,
    table,
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

  // An error in the callback is not the run's result, since by then the code
  // has moved on; it is logged the way a browser logs it.
  function queueMicrotask(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("The callback must be a function");
    }

    promiseThen(resolved, function () {
      try {
        callback();
      } catch (error) {
        write("Uncaught " + (isErrorLike(error) ? errorText(error, { cut: false }) : render(error, maxLogLength, false).text));
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
  };

  // Globals whose code is only evaluated, from source the host hands over by
  // name, when the program first reads one of them. Assigning to the global
  // replaces it as it would any other.
  const indirectEval = eval;
  const defineProperty = Object.defineProperty;

  function lazyGlobals(module, names) {
    let exported;

    function load() {
      if (exported === undefined) exported = indirectEval(loadExtra(module))(registerInspector, [seed0, seed1, seed2, seed3]);
      return exported;
    }

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

  lazyGlobals("clone", ["structuredClone"]);
  lazyGlobals("encoding", ["TextEncoder", "TextDecoder", "atob", "btoa"]);
  lazyGlobals("url", ["URL", "URLSearchParams"]);
  lazyGlobals("crypto", ["crypto"]);

  for (const [name, value] of [
    ["setTimeout", setTimeout],
    ["clearTimeout", clearTimeout],
    ["setInterval", setInterval],
    ["clearInterval", clearInterval],
    ["queueMicrotask", queueMicrotask],
    ["performance", performance],
  ]) {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false });
  }

  return { finish, fail, tick };
})
