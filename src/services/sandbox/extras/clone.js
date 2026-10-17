// structuredClone, for the guest. Evaluated the first time the code asks for it;
// see lazyGlobals in guest.js. Returns the globals it defines.
(function () {
  "use strict";

  function cloneError(what) {
    const error = new Error(what + " could not be cloned.");
    error.name = "DataCloneError";
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

  function structuredClone(value) {
    if (arguments.length === 0) {
      throw new TypeError("The value argument is required");
    }

    const seen = new Map();

    function copy(source) {
      if (source === null || (typeof source !== "object" && typeof source !== "function")) {
        if (typeof source === "symbol") throw cloneError(String(source));
        return source;
      }
      if (typeof source === "function") throw cloneError(String(source));
      if (seen.has(source)) return seen.get(source);

      const tag = Object.prototype.toString.call(source);
      let out;

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
        out[keys[i]] = copy(source[keys[i]]);
      }
    }

    return copy(value);
  }

  return { structuredClone };
})
