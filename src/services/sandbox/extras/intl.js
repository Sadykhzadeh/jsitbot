// Intl.NumberFormat, Intl.Collator and Intl.DateTimeFormat, for the guest. Evaluated the first time
// the code asks for `Intl`; see lazyGlobals in guest.js.
//
// They are the toLocaleString of numbers, the localeCompare of strings and the
// toLocaleString of dates under another name, with the same formatting and the
// same limits (see number.js, collate.js and date.js). There is no PluralRules,
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

  const FORMAT_FIELDS = [
    "weekday", "year", "month", "day", "dayPeriod", "hour", "minute", "second", "fractionalSecondDigits", "dateStyle", "timeStyle",
  ];

  class DateTimeFormat {
    constructor(locales, options) {
      if (options === null) throw new TypeError("Cannot convert undefined or null to object");
      let given = options === undefined ? {} : Object(options);
      // with nothing asked for, a date is written; toLocaleString would add the time
      if (!FORMAT_FIELDS.some((name) => given[name] !== undefined)) {
        given = Object.assign({}, given, { year: "numeric", month: "numeric", day: "numeric" });
      }
      // the arguments are checked now, as a constructor does, not at the first format
      Date.prototype.toLocaleString.call(new Date(0), locales, given);

      const format = (date) => {
        const when = new Date(date === undefined ? Date.now() : Number(date));
        if (when.getTime() !== when.getTime()) throw new RangeError("Invalid time value");
        return Date.prototype.toLocaleString.call(when, locales, given);
      };
      define(this, "format", format);
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
  define(Intl, "DateTimeFormat", callable(DateTimeFormat));
  Object.defineProperty(Intl, Symbol.toStringTag, { value: "Intl", configurable: true });

  return { Intl };
})
