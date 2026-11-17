// Blob and File, for the guest: data in memory, with no network and no files. Evaluated
// the first time the code asks for either; see lazyGlobals in guest.js. Stream()
// is not here, since the sandbox has no streams: it throws a plain Error that says so.
// Line endings follow Linux, where Node's "native" is a line feed.
(function (register, seed, host) {
  "use strict";

  const bytesOf = new WeakMap();
  const types = new WeakMap();

  function nodeError(Type, code, message) {
    const error = new Type(message);
    error.code = code;
    return error;
  }

  function describe(value) {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "function") return "function " + value.name;
    if (typeof value === "object") {
      const name = value.constructor && value.constructor.name;
      return "an instance of " + (name ? name : "Object");
    }
    return "type " + typeof value + " (" + String(value) + ")";
  }

  function isBlob(value) {
    return value !== null && (typeof value === "object" || typeof value === "function") && bytesOf.has(value);
  }

  function invalidThis() {
    return nodeError(TypeError, "ERR_INVALID_THIS", 'Value of "this" must be of type Blob');
  }

  // The type of a blob: the text, lower case, when every character is printable ASCII.
  function normalizeType(value) {
    const text = String(value);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 0x20 || code > 0x7e) return "";
    }
    return text.toLowerCase();
  }

  function encodeText(text, endings) {
    const lineFeed = endings === "native" ? text.replace(/\r\n?/g, "\n") : text;
    return new TextEncoder().encode(lineFeed);
  }

  function concatenate(chunks, total) {
    const out = new Uint8Array(total);
    let at = 0;
    for (let i = 0; i < chunks.length; i++) {
      out.set(chunks[i], at);
      at += chunks[i].length;
    }
    return out;
  }

  function create(Type, parts, options) {
    if (options !== undefined && options !== null && typeof options !== "object" && typeof options !== "function") {
      throw nodeError(TypeError, "ERR_INVALID_ARG_TYPE", 'The "options" argument must be a dictionary. Received ' + describe(options));
    }
    const settings = options || {};
    let endings = "transparent";
    if (settings.endings !== undefined) {
      endings = String(settings.endings);
      if (endings !== "transparent" && endings !== "native") {
        throw nodeError(
          TypeError,
          "ERR_INVALID_ARG_VALUE",
          "The property 'options.endings' is invalid. Received '" + endings + "'",
        );
      }
    }

    let items = [];
    if (parts !== undefined) {
      if (parts === null || (typeof parts !== "object" && typeof parts !== "function") || typeof parts[Symbol.iterator] !== "function") {
        throw nodeError(TypeError, "ERR_INVALID_ARG_TYPE", "Value cannot be converted to sequence.");
      }
      items = Array.from(parts);
    }

    const chunks = [];
    let total = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let chunk;
      if (isBlob(item)) {
        chunk = bytesOf.get(item);
      } else if (item instanceof ArrayBuffer || (typeof SharedArrayBuffer === "function" && item instanceof SharedArrayBuffer)) {
        chunk = new Uint8Array(item.slice(0));
      } else if (ArrayBuffer.isView(item)) {
        chunk = new Uint8Array(item.buffer.slice(item.byteOffset, item.byteOffset + item.byteLength));
      } else {
        chunk = encodeText(String(item), endings);
      }
      chunks.push(chunk);
      total += chunk.length;
    }

    const self = Reflect.construct(Object, [], Type);
    bytesOf.set(self, concatenate(chunks, total));
    types.set(self, settings.type === undefined ? "" : normalizeType(settings.type));
    return self;
  }

  function Blob(parts, options) {
    if (new.target === undefined) throw new TypeError("Class constructor Blob cannot be invoked without 'new'");
    return create(new.target, parts, options);
  }

  function File(parts, name, options) {
    if (new.target === undefined) throw new TypeError("Class constructor File cannot be invoked without 'new'");
    if (arguments.length < 2) {
      throw nodeError(TypeError, "ERR_MISSING_ARGS", 'The "fileBits" and "fileName" arguments must be specified');
    }
    if (options !== undefined && options !== null && typeof options !== "object" && typeof options !== "function") {
      throw nodeError(TypeError, "ERR_INVALID_ARG_TYPE", 'The "options" argument must be a dictionary. Received ' + describe(options));
    }
    const file = create(new.target, parts, options);
    const settings = options || {};
    names.set(file, String(name));
    lastModified.set(file, settings.lastModified === undefined ? Date.now() : Number(settings.lastModified));
    return file;
  }

  const names = new WeakMap();
  const lastModified = new WeakMap();

  Object.setPrototypeOf(File.prototype, Blob.prototype);
  Object.setPrototypeOf(File, Blob);

  function define(target, name, value) {
    Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
  }

  function getter(target, name, read) {
    Object.defineProperty(target, name, {
      get() {
        if (!bytesOf.has(this)) throw invalidThis();
        return read(this);
      },
      configurable: true,
      enumerable: false,
    });
  }

  getter(Blob.prototype, "size", (blob) => bytesOf.get(blob).length);
  getter(Blob.prototype, "type", (blob) => types.get(blob));
  getter(File.prototype, "name", (file) => names.get(file));
  getter(File.prototype, "lastModified", (file) => lastModified.get(file));

  define(Blob.prototype, "slice", function slice(start, end, contentType) {
    if (!bytesOf.has(this)) throw invalidThis();
    const bytes = bytesOf.get(this);
    const size = bytes.length;
    const from = start === undefined ? 0 : relative(start, size);
    const to = end === undefined ? size : relative(end, size);
    const span = Math.max(to - from, 0);
    const copy = new Uint8Array(span);
    copy.set(bytes.subarray(from, from + span));
    const blob = Reflect.construct(Object, [], Blob);
    bytesOf.set(blob, copy);
    types.set(blob, contentType === undefined ? "" : normalizeType(contentType));
    return blob;
  });

  // A slice index: negative counts from the end, and the result stays in the blob.
  function relative(index, size) {
    const number = Math.trunc(+index) || 0;
    return number < 0 ? Math.max(size + number, 0) : Math.min(number, size);
  }

  define(Blob.prototype, "text", async function text() {
    if (!bytesOf.has(this)) throw invalidThis();
    return new TextDecoder().decode(bytesOf.get(this));
  });

  define(Blob.prototype, "arrayBuffer", async function arrayBuffer() {
    if (!bytesOf.has(this)) throw invalidThis();
    return bytesOf.get(this).slice(0).buffer;
  });

  define(Blob.prototype, "bytes", async function bytes() {
    if (!bytesOf.has(this)) throw invalidThis();
    return bytesOf.get(this).slice(0);
  });

  define(Blob.prototype, "stream", function stream() {
    throw new Error("Blob.stream() is not supported here: the sandbox has no streams");
  });

  Object.defineProperty(Blob.prototype, Symbol.toStringTag, { value: "Blob", configurable: true });
  Object.defineProperty(File.prototype, Symbol.toStringTag, { value: "File", configurable: true });
  Object.defineProperty(Blob, "length", { value: 0, configurable: true });
  Object.defineProperty(File, "length", { value: 2, configurable: true });

  // Node prints a blob as its size and type, and a file with its name and time too.
  register(Blob, function (blob) {
    return { entries: [["size", bytesOf.get(blob).length], ["type", types.get(blob)]], map: false };
  });
  register(File, function (file) {
    return {
      entries: [
        ["size", bytesOf.get(file).length],
        ["type", types.get(file)],
        ["name", names.get(file)],
        ["lastModified", lastModified.get(file)],
      ],
      map: false,
    };
  });

  return { Blob, File };
})
