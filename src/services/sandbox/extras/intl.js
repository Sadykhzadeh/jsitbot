// Intl.NumberFormat and Intl.Collator, for the guest. Evaluated the first time
// the code asks for `Intl`; see lazyGlobals in guest.js.
//
// Both are the toLocaleString of numbers and the localeCompare of strings
// under another name, with the same formatting and the same limits (see
// number.js and collate.js). There is no DateTimeFormat, PluralRules,
// RelativeTimeFormat or ListFormat, and no formatToParts or resolvedOptions.
(function () {
  "use strict";

  function define(object, name, value) {
    Object.defineProperty(object, name, { value, writable: true, configurable: true, enumerable: false });
  }

  class NumberFormat {
    constructor(locales, options) {
      // the arguments are checked now, as a constructor does, not at the first format
      Number.prototype.toLocaleString.call(0, locales, options);

      const format = (value) =>
        typeof value === "bigint"
          ? BigInt.prototype.toLocaleString.call(value, locales, options)
          : Number.prototype.toLocaleString.call(Number(value), locales, options);
      define(this, "format", format);
    }
  }

  class Collator {
    constructor(locales, options) {
      const compare = (a, b) => String(a).localeCompare(String(b), locales, options);
      define(this, "compare", compare);
    }
  }

  // Called without new, as the real ones may be
  function callable(Class) {
    const wrapper = function (locales, options) {
      return new Class(locales, options);
    };
    wrapper.prototype = Class.prototype;
    define(Class.prototype, "constructor", wrapper);
    define(wrapper, "name", Class.name);
    return wrapper;
  }

  const Intl = {};
  define(Intl, "NumberFormat", callable(NumberFormat));
  define(Intl, "Collator", callable(Collator));
  Object.defineProperty(Intl, Symbol.toStringTag, { value: "Intl", configurable: true });

  return { Intl };
})
