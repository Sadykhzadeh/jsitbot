// structuredClone, for the guest. Evaluated the first time the code asks for it;
// see lazyGlobals in guest.js. Returns the globals it defines.
(function (register, seed, host) {
  "use strict";

  function cloneError(what) {
    return new (host.extra("events").DOMException)(what + " could not be cloned.", "DataCloneError");
  }

  function dataCloneError(message) {
    return new (host.extra("events").DOMException)(message, "DataCloneError");
  }

  // The TypeErrors Node throws for bad arguments, with the code it sets on them.
  function argumentError(message, code) {
    const error = new TypeError("Failed to execute 'structuredClone': " + message);
    error.code = code;
    return error;
  }

  const typedArrays = {
    "[object Int8Array]": Int8Array,
    "[object Uint8Array]": Uint8Array,
    "[object Uint8ClampedArray]": Uint8ClampedArray,
    "[object Int16Array]": Int16Array,
    "[object Uint16Array]": Uint16Array,
    "[object Int32Array]": Int32Array,
    "[object Uint32Array]": Uint32Array,
    "[object Float32Array]": Float32Array,
    "[object Float64Array]": Float64Array,
    "[object BigInt64Array]": BigInt64Array,
    "[object BigUint64Array]": BigUint64Array,
  };

  const errorTypes = { EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError };

  // The buffers listed in the transfer option, each with the copy that stands for it.
  function transferList(options) {
    if (options === undefined || options === null) return [];
    if (typeof options !== "object" && typeof options !== "function") {
      throw argumentError("Options cannot be converted to a dictionary", "ERR_INVALID_ARG_TYPE");
    }
    const transfer = options.transfer;
    if (transfer === undefined) return [];
    if (transfer === null || typeof transfer[Symbol.iterator] !== "function") {
      throw argumentError("transfer in Options cannot be converted to sequence.", "ERR_INVALID_ARG_TYPE");
    }

    const buffers = [];
    let index = 0;
    for (const item of transfer) {
      if (item === null || (typeof item !== "object" && typeof item !== "function")) {
        throw argumentError("transfer in Options[" + index + "] is not an object.", "ERR_INVALID_ARG_TYPE");
      }
      if (Object.prototype.toString.call(item) !== "[object ArrayBuffer]") {
        throw dataCloneError("Found invalid value in transferList.");
      }
      if (buffers.indexOf(item) !== -1) {
        throw dataCloneError("Transfer list contains duplicate ArrayBuffer");
      }
      if (item.detached) {
        throw dataCloneError("Cannot transfer object of unsupported type.");
      }
      buffers.push(item);
      index++;
    }
    return buffers;
  }

  function structuredClone(value, options) {
    if (arguments.length === 0) {
      const error = new TypeError("The \"The value argument must be specified\" argument must be specified");
      error.code = "ERR_MISSING_ARGS";
      throw error;
    }

    const buffers = transferList(options);
    const seen = new Map();
    // A transferred buffer is copied here, and detached once the whole value has been copied.
    for (const buffer of buffers) seen.set(buffer, buffer.slice(0));

    function copy(source) {
      if (source === null || (typeof source !== "object" && typeof source !== "function")) {
        if (typeof source === "symbol") throw cloneError(String(source));
        return source;
      }
      if (typeof source === "function") throw cloneError(String(source));
      if (seen.has(source)) return seen.get(source);
      if (host.isProxy(source)) throw cloneError(Array.isArray(source) ? "[object Array]" : "#<Object>");

      let tag = Object.prototype.toString.call(source);
      let out;

      // A Blob or a File is copied only when it holds data. An object that only claims the tag,
      // or has the prototype without the data, is cloned as an ordinary object, as Node does.
      if (tag === "[object Blob]" || tag === "[object File]") {
        const blob = host.extra("blob");
        if (blob.isBlob(source)) {
          out = source instanceof blob.File
            ? new blob.File([source], source.name, { type: source.type, lastModified: source.lastModified })
            : new blob.Blob([source], { type: source.type });
          seen.set(source, out);
          return out;
        }
        tag = "[object Object]";
      }

      switch (tag) {
        case "[object Date]":
          out = new Date(source.getTime());
          seen.set(source, out);
          return out;
        case "[object RegExp]":
          out = new RegExp(source.source, source.flags);
          seen.set(source, out);
          return out;
        case "[object Boolean]":
        case "[object Number]":
        case "[object String]":
        case "[object BigInt]":
          out = Object(source.valueOf());
          seen.set(source, out);
          return out;
        case "[object ArrayBuffer]":
          if (source.detached) throw dataCloneError("An ArrayBuffer is detached and could not be cloned.");
          out = source.slice(0);
          seen.set(source, out);
          return out;
        case "[object SharedArrayBuffer]":
          out = source.slice(0);
          seen.set(source, out);
          return out;
        case "[object Map]":
          out = new Map();
          seen.set(source, out);
          source.forEach(function (item, key) {
            out.set(copy(key), copy(item));
          });
          return out;
        case "[object Set]":
          out = new Set();
          seen.set(source, out);
          source.forEach(function (item) {
            out.add(copy(item));
          });
          return out;
        case "[object Error]": {
          const Type = errorTypes[source.name] || Error;
          out = new Type(typeof source.message === "string" ? source.message : "");
          seen.set(source, out);
          if (typeof source.stack === "string") {
            Object.defineProperty(out, "stack", { value: source.stack, writable: true, configurable: true });
          }
          if ("cause" in source) {
            Object.defineProperty(out, "cause", { value: copy(source.cause), writable: true, configurable: true });
          }
          return out;
        }
        case "[object DOMException]":
          out = new (host.extra("events").DOMException)(source.message, source.name);
          seen.set(source, out);
          return out;
        case "[object Array]":
          out = new Array(source.length);
          seen.set(source, out);
          copyProperties(source, out);
          return out;
        case "[object Object]":
        case "[object Arguments]":
          out = {};
          seen.set(source, out);
          copyProperties(source, out);
          return out;
      }

      const Typed = typedArrays[tag];
      if (Typed !== undefined) {
        out = new Typed(copy(source.buffer), source.byteOffset, source.length);
        seen.set(source, out);
        return out;
      }
      if (tag === "[object DataView]") {
        out = new DataView(copy(source.buffer), source.byteOffset, source.byteLength);
        seen.set(source, out);
        return out;
      }

      throw cloneError("#<" + tag.slice(8, -1) + ">");
    }

    function copyProperties(source, out) {
      const keys = Object.keys(source);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key === "__proto__") {
          Object.defineProperty(out, key, { value: copy(source[key]), writable: true, enumerable: true, configurable: true });
        } else {
          out[key] = copy(source[key]);
        }
      }
    }

    const result = copy(value);
    for (const buffer of buffers) buffer.transfer();
    return result;
  }

  return { structuredClone };
})
