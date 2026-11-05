// Intl.NumberFormat, Intl.Collator, Intl.DateTimeFormat, Intl.PluralRules,
// Intl.ListFormat and Intl.RelativeTimeFormat, for the guest. Evaluated the
// first time the code asks for `Intl`; see lazyGlobals in guest.js.
//
// They are the toLocaleString of numbers, the localeCompare of strings and the
// toLocaleString of dates under another name, with the same formatting and the
// same limits (see number.js, collate.js and date.js). PluralRules,
// ListFormat and RelativeTimeFormat are written out here and know English only.
// There is no formatToParts. `hostTimeZone` is the zone of the process, which
// executionWrapper puts around this source.
(function () {
  "use strict";

  function define(object, name, value) {
    Object.defineProperty(object, name, { value, writable: true, configurable: true, enumerable: false });
  }

  // Options that were given, in the order resolvedOptions lists them.
  function given(options, names) {
    const out = {};
    if (options === undefined || options === null) return out;
    for (const name of names) {
      if (options[name] !== undefined) out[name] = options[name];
    }
    return out;
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
      define(this, "resolvedOptions", () => {
        const asked = given(options, [
          "style", "currency", "currencyDisplay", "currencySign", "unit", "unitDisplay", "minimumIntegerDigits",
          "minimumFractionDigits", "maximumFractionDigits", "minimumSignificantDigits", "maximumSignificantDigits",
          "useGrouping", "notation", "compactDisplay", "signDisplay",
        ]);
        const style = asked.style === undefined ? "decimal" : String(asked.style);
        const out = { locale: "en-US", numberingSystem: "latn", style };
        if (style === "currency") {
          out.currency = String(asked.currency).toUpperCase();
          out.currencyDisplay = asked.currencyDisplay === undefined ? "symbol" : asked.currencyDisplay;
          out.currencySign = asked.currencySign === undefined ? "standard" : asked.currencySign;
        } else if (style === "unit") {
          out.unit = asked.unit;
          out.unitDisplay = asked.unitDisplay === undefined ? "short" : asked.unitDisplay;
        }
        out.minimumIntegerDigits = asked.minimumIntegerDigits === undefined ? 1 : Number(asked.minimumIntegerDigits);
        if (asked.minimumSignificantDigits !== undefined || asked.maximumSignificantDigits !== undefined) {
          out.minimumSignificantDigits = asked.minimumSignificantDigits === undefined ? 1 : Number(asked.minimumSignificantDigits);
          out.maximumSignificantDigits = asked.maximumSignificantDigits === undefined ? 21 : Number(asked.maximumSignificantDigits);
        } else {
          const base = style === "currency" ? 2 : 0;
          const top = style === "currency" ? 2 : style === "percent" ? 0 : 3;
          const min = asked.minimumFractionDigits === undefined ? undefined : Number(asked.minimumFractionDigits);
          const max = asked.maximumFractionDigits === undefined ? undefined : Number(asked.maximumFractionDigits);
          out.minimumFractionDigits = min === undefined ? Math.min(base, max === undefined ? base : max) : min;
          out.maximumFractionDigits = max === undefined ? Math.max(top, out.minimumFractionDigits) : max;
        }
        out.useGrouping = asked.useGrouping === undefined ? "auto" : asked.useGrouping === true ? "always" : asked.useGrouping;
        out.notation = asked.notation === undefined ? "standard" : asked.notation;
        if (out.notation === "compact") out.compactDisplay = asked.compactDisplay === undefined ? "short" : asked.compactDisplay;
        out.signDisplay = asked.signDisplay === undefined ? "auto" : asked.signDisplay;
        return out;
      });
    }
  }

  class Collator {
    constructor(locales, options) {
      const compare = (a, b) => String(a).localeCompare(String(b), locales, options);
      define(this, "compare", compare);
      define(this, "resolvedOptions", () => {
        const asked = given(options, ["usage", "sensitivity", "ignorePunctuation", "numeric", "caseFirst"]);
        return {
          locale: "en-US",
          usage: asked.usage === undefined ? "sort" : asked.usage,
          sensitivity: asked.sensitivity === undefined ? "variant" : asked.sensitivity,
          ignorePunctuation: asked.ignorePunctuation === undefined ? false : Boolean(asked.ignorePunctuation),
          collation: "default",
          numeric: asked.numeric === undefined ? false : Boolean(asked.numeric),
          caseFirst: asked.caseFirst === undefined ? "false" : asked.caseFirst,
        };
      });
    }
  }

  const FORMAT_FIELDS = [
    "weekday", "year", "month", "day", "dayPeriod", "hour", "minute", "second", "fractionalSecondDigits", "dateStyle", "timeStyle",
  ];

  // The zones that mean UTC, as in date.js
  const UTC_ZONES = ["utc", "gmt", "etc/utc", "etc/gmt"];
  const RESOLVED_FIELDS = [
    "weekday", "era", "year", "month", "day", "dayPeriod", "hour", "minute", "second", "fractionalSecondDigits",
    "timeZoneName", "dateStyle", "timeStyle",
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
      define(this, "resolvedOptions", () => {
        const zone = given.timeZone === undefined ? hostTimeZone : String(given.timeZone);
        const out = { locale: "en-US", calendar: "gregory", numberingSystem: "latn", timeZone: UTC_ZONES.indexOf(zone.toLowerCase()) === -1 ? zone : "UTC" };
        if (given.hour !== undefined || given.timeStyle !== undefined) {
          const cycle = given.hourCycle !== undefined ? given.hourCycle : given.hour12 === undefined ? "h12" : given.hour12 ? "h12" : "h23";
          out.hourCycle = cycle;
          out.hour12 = cycle === "h12" || cycle === "h11";
        }
        for (const name of RESOLVED_FIELDS) {
          if (given[name] !== undefined) out[name] = given[name];
        }
        return out;
      });
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

  // What a unit is called when it is counted, per style: [one, other], or one text for both.
  const UNIT_NAMES = {
    long: {
      second: ["second", "seconds"], minute: ["minute", "minutes"], hour: ["hour", "hours"], day: ["day", "days"],
      week: ["week", "weeks"], month: ["month", "months"], quarter: ["quarter", "quarters"], year: ["year", "years"],
    },
    short: {
      second: "sec.", minute: "min.", hour: "hr.", day: ["day", "days"],
      week: "wk.", month: "mo.", quarter: ["qtr.", "qtrs."], year: "yr.",
    },
    narrow: {
      second: "s", minute: "m", hour: "h", day: "d", week: "w", month: "mo", quarter: "q", year: "y",
    },
  };
  // What the unit is called when it stands in a phrase of its own, as in "next wk.".
  const PHRASE_NAMES = { long: UNIT_NAMES.long, short: UNIT_NAMES.short, narrow: UNIT_NAMES.short };
  const WORDS = { "-1": "last", 0: "this", 1: "next" };
  const DAY_WORDS = { "-1": "yesterday", 0: "today", 1: "tomorrow" };

  class RelativeTimeFormat {
    #style;
    #numeric;

    constructor(locales, options) {
      checkLocale(locales, /^en(-[A-Za-z0-9]+)*$/i);
      if (options === null) throw new TypeError("Cannot convert undefined or null to object");
      const given = options === undefined ? {} : Object(options);
      this.#style = choose(given, "style", ["long", "short", "narrow"], "long", "RelativeTimeFormat");
      this.#numeric = choose(given, "numeric", ["always", "auto"], "always", "RelativeTimeFormat");
    }

    format(value, unit) {
      const number = Number(value);
      const text = String(unit);
      const name = text.endsWith("s") ? text.slice(0, -1) : text;
      if (!Object.prototype.hasOwnProperty.call(UNIT_NAMES.long, name)) {
        throw new RangeError("Invalid unit argument for Intl.RelativeTimeFormat.prototype.format() '" + text + "'");
      }
      if (!Number.isFinite(number)) {
        throw new RangeError("Value need to be finite number for Intl.RelativeTimeFormat.prototype.format()");
      }

      const style = this.#style;
      if (this.#numeric === "auto" && (number === -1 || number === 0 || number === 1)) {
        const key = Object.is(number, -0) ? 0 : number;
        if (name === "day") return DAY_WORDS[key];
        if (name === "second" && key === 0) return "now";
        if ((name === "minute" || name === "hour") && key === 0) return "this " + name;
        if (name !== "second" && name !== "minute" && name !== "hour") {
          const unitName = PHRASE_NAMES[style][name];
          return WORDS[key] + " " + (typeof unitName === "string" ? unitName : unitName[0]);
        }
      }

      const shown = Number.prototype.toLocaleString.call(Math.abs(number), "en-US");
      const names = UNIT_NAMES[style][name];
      const unitName = typeof names === "string" ? names : names[shown === "1" ? 0 : 1];
      const phrase = shown + (style === "narrow" ? "" : " ") + unitName;
      return number < 0 || Object.is(number, -0) ? phrase + " ago" : "in " + phrase;
    }

    resolvedOptions() {
      return { locale: "en-US", style: this.#style, numeric: this.#numeric, numberingSystem: "latn" };
    }
  }

  Object.defineProperty(RelativeTimeFormat.prototype, Symbol.toStringTag, { value: "Intl.RelativeTimeFormat", configurable: true });
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
  define(Intl, "RelativeTimeFormat", RelativeTimeFormat);
  Object.defineProperty(Intl, Symbol.toStringTag, { value: "Intl", configurable: true });

  return { Intl };
})
