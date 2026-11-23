// BigInt, for the guest: the same function as the engine's, with the errors of a
// conversion worded as Node words them. It keeps the engine's prototype, asIntN and
// asUintN, so BigInt.prototype and instanceof work as before. Evaluated the first time
// the code reads BigInt; see lazyGlobals in guest.js.
(function (register, seed, host, builtins) {
  "use strict";

  const native = builtins.BigInt;

  function BigInt(value) {
    if (new.target !== undefined) throw new TypeError("BigInt is not a constructor");
    if (typeof value === "number") {
      if (!Number.isInteger(value)) {
        throw new RangeError("The number " + String(value) + " cannot be converted to a BigInt because it is not an integer");
      }
    } else if (typeof value === "string") {
      try {
        return native(value);
      } catch (error) {
        throw new SyntaxError("Cannot convert " + value + " to a BigInt");
      }
    } else if (value === undefined || value === null) {
      throw new TypeError("Cannot convert " + String(value) + " to a BigInt");
    }
    return native(value);
  }

  Object.defineProperty(BigInt, "length", { value: 1, configurable: true });
  BigInt.prototype = native.prototype;
  Object.defineProperty(native.prototype, "constructor", { value: BigInt, writable: true, configurable: true, enumerable: false });
  Object.defineProperty(BigInt, "asIntN", { value: native.asIntN, writable: true, configurable: true, enumerable: false });
  Object.defineProperty(BigInt, "asUintN", { value: native.asUintN, writable: true, configurable: true, enumerable: false });

  return { BigInt };
})
