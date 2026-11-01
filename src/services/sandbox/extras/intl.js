// Intl.NumberFormat, Intl.Collator, Intl.DateTimeFormat, Intl.PluralRules and
// Intl.ListFormat, for the guest. Evaluated the first time
// the code asks for `Intl`; see lazyGlobals in guest.js.
//
// They are the toLocaleString of numbers, the localeCompare of strings and the
// toLocaleString of dates under another name, with the same formatting and the
// same limits (see number.js, collate.js and date.js). PluralRules and
// ListFormat are written out here and know English only. There is no
// RelativeTimeFormat, and no formatToParts or resolvedOptions on the others.
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

  // PluralRules and ListFormat only know English; any other language is refused
  // rather than answered with English rules.
  function checkLocale(locales, ending) {
    const tag = Array.isArray(locales) ? locales[0] : locales;
    if (tag === undefined) return "en-US";
    if (!ending.test(String(tag))) throw new RangeError("Incorrect locale information provided");
    return String(tag);
  }

  function choose(options, name, allowed, fallback, owner) {
    const given = options[name];
    if (given === undefined) return fallback;
    const text = String(given);
    if (allowed.indexOf(text) === -1) {
      throw new RangeError("Value " + text + " out of range for Intl." + owner + " options property " + name);
    }
    return text;
  }

  class PluralRules {
    #type;
    #locale;
    #digits;

    constructor(locales, options) {
      this.#locale = checkLocale(locales, /^en(-[A-Za-z0-9]+)*$/i);
      if (options === null) throw new TypeError("Cannot convert undefined or null to object");
      const given = options === undefined ? {} : Object(options);
      this.#type = choose(given, "type", ["cardinal", "ordinal"], "cardinal", "PluralRules");
      this.#digits = { useGrouping: false };
      if (given.minimumFractionDigits !== undefined) this.#digits.minimumFractionDigits = given.minimumFractionDigits;
      if (given.maximumFractionDigits !== undefined) this.#digits.maximumFractionDigits = given.maximumFractionDigits;
      // the digits are checked now, as a constructor does
      Number.prototype.toLocaleString.call(0, "en-US", this.#digits);
    }

    select(value) {
      const type = this.#type;
      const number = +value;
      if (!Number.isFinite(number)) return "other";

      // The digits as they are shown decide the category, so 1.0 is not "one".
      const shown = Number.prototype.toLocaleString.call(Math.abs(number), "en-US", this.#digits);
      const point = shown.indexOf(".");
      const whole = point === -1 ? shown : shown.slice(0, point);
      if (point !== -1) return "other";
      if (type === "cardinal") return whole === "1" ? "one" : "other";

      const last = whole.charCodeAt(whole.length - 1) - 48;
      const tens = whole.length > 1 ? whole.charCodeAt(whole.length - 2) - 48 : 0;
      if (tens === 1) return "other";
      return last === 1 ? "one" : last === 2 ? "two" : last === 3 ? "few" : "other";
    }

    resolvedOptions() {
      const digits = this.#digits;
      const min = digits.minimumFractionDigits === undefined ? 0 : Number(digits.minimumFractionDigits);
      const max = digits.maximumFractionDigits === undefined ? Math.max(3, min) : Number(digits.maximumFractionDigits);
      return {
        locale: this.#locale,
        type: this.#type,
        minimumIntegerDigits: 1,
        minimumFractionDigits: min,
        maximumFractionDigits: max,
        pluralCategories: this.#type === "ordinal" ? ["one", "two", "few", "other"] : ["one", "other"],
      };
    }
  }

  // How a list is joined: between two items, between the others, before the last of three or more.
  const LIST_PATTERNS = {
    conjunction: { long: [" and ", ", ", ", and "], short: [" & ", ", ", ", & "], narrow: [", ", ", ", ", "] },
    disjunction: { long: [" or ", ", ", ", or "], short: [" or ", ", ", ", or "], narrow: [" or ", ", ", ", or "] },
    unit: { long: [", ", ", ", ", "], short: [", ", ", ", ", "], narrow: [" ", " ", " "] },
  };

  class ListFormat {
    #locale;
    #type;
    #style;

    constructor(locales, options) {
      this.#locale = checkLocale(locales, /^en(-US)?$/i);
      if (options === null) throw new TypeError("Cannot convert undefined or null to object");
      const given = options === undefined ? {} : Object(options);
      this.#type = choose(given, "type", ["conjunction", "disjunction", "unit"], "conjunction", "ListFormat");
      this.#style = choose(given, "style", ["long", "short", "narrow"], "long", "ListFormat");
    }

    format(list) {
      const pattern = LIST_PATTERNS[this.#type][this.#style];
      const items = [];
      if (list !== undefined) {
        for (const item of list) {
          if (typeof item !== "string") throw new TypeError("Iterable yielded " + String(item) + " which is not a string");
          items[items.length] = item;
        }
      }

      if (items.length < 3) return items.length === 2 ? items[0] + pattern[0] + items[1] : items.join("");
      let out = items[0];
      for (let i = 1; i < items.length - 1; i++) out += pattern[1] + items[i];
      return out + pattern[2] + items[items.length - 1];
    }

    resolvedOptions() {
      return { locale: this.#locale, type: this.#type, style: this.#style };
    }
  }

  Object.defineProperty(PluralRules.prototype, Symbol.toStringTag, { value: "Intl.PluralRules", configurable: true });
  Object.defineProperty(ListFormat.prototype, Symbol.toStringTag, { value: "Intl.ListFormat", configurable: true });

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
  define(Intl, "PluralRules", PluralRules);
  define(Intl, "ListFormat", ListFormat);
  Object.defineProperty(Intl, Symbol.toStringTag, { value: "Intl", configurable: true });

  return { Intl };
})
