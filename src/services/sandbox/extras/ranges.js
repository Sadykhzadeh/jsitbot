// String repeat, the digits of toFixed, toPrecision and toExponential, and the radix of
// Number toString, for the guest. The engine words their range errors in a few words
// ("invalid repeat count", "radix must be between 2 and 36") and leaves the value out;
// Node says "Invalid count value: -1" and "toString() radix argument must be between 2
// and 36". Each method converts its argument once, checks it with Node's message and
// passes the converted number on, so the error a program catches has Node's text too.
// Evaluated the first time one of them is called; see lazyMethod in guest.js.
(function (original, owner, zoneInfo, builtins) {
  "use strict";

  function isNumber(value) {
    return typeof value === "number" || builtins.tag(value) === "[object Number]";
  }

  // ToIntegerOrInfinity: NaN is 0, and an infinity stays infinite.
  function integer(value) {
    return builtins.trunc(builtins.number(value)) || 0;
  }

  function repeat(count) {
    if (this === null || this === undefined) return builtins.apply(original, this, [count]);
    const n = integer(count);
    if (n < 0 || n === Infinity) throw new RangeError("Invalid count value: " + builtins.string(n));
    return builtins.apply(original, this, [n]);
  }

  function ranged(name, min, max, message, optional) {
    return function (digits) {
      if (!isNumber(this)) throw new TypeError("Number.prototype." + name + " requires that 'this' be a Number");
      if (optional && digits === undefined) return builtins.apply(original, this, [digits]);
      const d = integer(digits);
      if (d < min || d > max) throw new RangeError(message);
      return builtins.apply(original, this, [d]);
    };
  }

  const methods = {
    repeat,
    toFixed: ranged("toFixed", 0, 100, "toFixed() digits argument must be between 0 and 100", false),
    toPrecision: ranged("toPrecision", 1, 100, "toPrecision() argument must be between 1 and 100", true),
    toExponential: ranged("toExponential", 0, 100, "toExponential() argument must be between 0 and 100", true),
    toString: ranged("toString", 2, 36, "toString() radix argument must be between 2 and 36", true),
  };

  const method = methods[original.name];
  Object.defineProperty(method, "name", { value: original.name, configurable: true });
  Object.defineProperty(method, "length", { value: original.length, configurable: true });
  return { [original.name]: method };
})
