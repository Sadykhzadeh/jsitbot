// Intl.NumberFormat, Intl.Collator, Intl.DateTimeFormat, Intl.PluralRules,
// Intl.ListFormat, Intl.RelativeTimeFormat and Intl.Segmenter, for the guest. Evaluated the
// first time the code asks for `Intl`; see lazyGlobals in guest.js.
//
// They are the toLocaleString of numbers, the localeCompare of strings and the
// toLocaleString of dates under another name, with the same formatting and the
// same limits (see number.js, collate.js and date.js). PluralRules,
// ListFormat and RelativeTimeFormat are written out here and know English only.
// `hostTimeZone` is the zone of the process, which executionWrapper puts around this source.
// `host` is the set of host functions, which hands out the date extra's parts.
// `builtins` holds the built-ins captured before the program ran; see captured in guest.js.
(function (registerInspector, seeds, host, builtins) {
  "use strict";

  function define(object, name, value) {
    builtins.defineProperty(object, name, { value, writable: true, configurable: true, enumerable: false });
  }

  // Options that were given, in the order resolvedOptions lists them.
  function snapshot(options, names) {
    const out = { __proto__: null };
    if (options === undefined || options === null) return out;
    for (const name of names) {
      const value = options[name];
      if (value !== undefined) out[name] = value;
    }
    return out;
  }

  const COMPACT_WORDS = ["K", "M", "B", "T", "thousand", "million", "billion", "trillion"];

  // The fraction digits a currency has by default. The number formatter knows them,
  // and a zero written with the code has no symbol that could hold a point.
  function currencyDigits(code) {
    const text = builtins.numberToLocaleString(0, "en-US", { style: "currency", currency: code, currencyDisplay: "code" });
    const point = builtins.indexOf(text, ".");
    return point === -1 ? 0 : text.length - point - 1;
  }

  // Cuts what the number formatter wrote into the parts formatToParts names.
  // Its output has one shape, so each piece is told by what it is made of.
  function numberParts(text) {
    const parts = [];
    let point = false;
    let exponent = false;
    let i = 0;

    function add(type, value) {
      builtins.push(parts, { type, value });
    }

    while (i < text.length) {
      const c = text[i];
      if (c >= "0" && c <= "9") {
        let end = i;
        while (end < text.length && text[end] >= "0" && text[end] <= "9") end++;
        add(exponent ? "exponentInteger" : point ? "fraction" : "integer", builtins.slice(text, i, end));
        i = end;
        continue;
      }

      const last = parts.length === 0 ? "" : parts[parts.length - 1].type;
      if (c === "," || c === ".") {
        if (c === ".") point = true;
        add(c === "," ? "group" : "decimal", c);
      } else if (c === "-" || c === "+") {
        add(c === "+" ? "plusSign" : exponent ? "exponentMinusSign" : "minusSign", c);
      } else if (c === "%") {
        add("percentSign", c);
      } else if (c === "\u221e") {
        add("infinity", c);
      } else if (c === "(" || c === ")" || c === " " || c === "\u00a0") {
        add("literal", c);
      } else if (builtins.startsWith(text, "NaN", i)) {
        add("nan", "NaN");
        i += 3;
        continue;
      } else if (c === "E" && (last === "integer" || last === "fraction")) {
        exponent = true;
        add("exponentSeparator", c);
      } else {
        let end = i;
        while (end < text.length && !builtins.test(/[\d\s\u00a0()+\-.,%\u221e]/, text[end]) && !builtins.startsWith(text, "NaN", end)) end++;
        const run = builtins.slice(text, i, end);
        const afterNumber = last === "integer" || last === "fraction" || (last === "literal" && parts.length > 1 && parts[parts.length - 2].type !== "currency");
        add(afterNumber && builtins.indexOfIn(COMPACT_WORDS, run) !== -1 ? "compact" : "currency", run);
        i = end;
        continue;
      }
      i++;
    }
    return parts;
  }

  // In a unit style the unit is what the formatter writes after the number, with a space
  // before it when the form has one. The number without its unit is parsed as a number, so
  // a compact letter such as the K of 12KB is cut off from a unit that starts with one.
  function unitStyleParts(text, bare) {
    const parts = numberParts(bare);
    const rest = builtins.slice(text, bare.length);
    if (rest.length === 0) return parts;
    const space = rest[0] === " " || rest[0] === "\u00a0";
    if (space) builtins.push(parts, { type: "literal", value: rest[0] });
    builtins.push(parts, { type: "unit", value: space ? builtins.slice(rest, 1) : rest });
    return parts;
  }

  // The values Intl.NumberFormat takes for its options, as Node 26 reads them; the
  // same list as toLocaleString in number.js.
  const NUMBER_OPTION_VALUES = {
    style: ["decimal", "percent", "currency", "unit"],
    currencyDisplay: ["code", "symbol", "narrowSymbol", "name"],
    currencySign: ["standard", "accounting"],
    unitDisplay: ["short", "narrow", "long"],
    notation: ["standard", "scientific", "engineering", "compact"],
    compactDisplay: ["short", "long"],
    signDisplay: ["auto", "never", "always", "exceptZero", "negative"],
    roundingMode: ["ceil", "floor", "expand", "trunc", "halfCeil", "halfFloor", "halfExpand", "halfTrunc", "halfEven"],
  };

  // The options a number format reads, read once by its constructor so that a getter is not called again by each format.
  const NUMBER_OPTION_NAMES = [
    "style", "currency", "currencyDisplay", "currencySign", "unit", "unitDisplay", "minimumIntegerDigits",
    "minimumFractionDigits", "maximumFractionDigits", "minimumSignificantDigits", "maximumSignificantDigits",
    "useGrouping", "notation", "compactDisplay", "signDisplay", "roundingMode", "roundingPriority",
    "trailingZeroDisplay", "roundingIncrement",
  ];

  class NumberFormat {
    constructor(locales, options) {
      options = snapshot(options, NUMBER_OPTION_NAMES);
      const asked = options;
      for (const name of builtins.keys(NUMBER_OPTION_VALUES)) choose(asked, name, NUMBER_OPTION_VALUES[name], undefined, "NumberFormat");
      if (asked.currency !== undefined && !builtins.test(/^[A-Za-z]{3}$/, builtins.string(asked.currency))) {
        throw new RangeError("Invalid currency code : " + builtins.string(asked.currency));
      }
      if (asked.style === "unit" && asked.unit === undefined) throw new TypeError("Invalid unit argument for Intl.NumberFormat() ''");
      // the arguments are checked now, as a constructor does, not at the first format
      try {
        builtins.numberToLocaleString(0, locales, options);
      } catch (error) {
        if (error instanceof RangeError) {
          throw new RangeError(builtins.replace(builtins.replace(error.message, " for Number.prototype.toLocaleString options", " for Intl.NumberFormat options"), "for Number.prototype.toLocaleString() ", "for Intl.NumberFormat() "));
        }
        throw error;
      }

      const formatWith = (value, withOptions) =>
        typeof value === "bigint"
          ? builtins.bigintToLocaleString(value, locales, withOptions)
          : builtins.numberToLocaleString(builtins.number(value), locales, withOptions);
      const format = (value) => formatWith(value, options);
      define(this, "format", format);
      const layout = snapshot(options, ["style", "notation", "currencyDisplay"]);
      const bareOptions = builtins.assign({ __proto__: null }, options, { style: undefined, unit: undefined, unitDisplay: undefined });
      define(this, "formatToParts", (value) => {
        const text = format(value);
        if (layout.style === "unit") return unitStyleParts(text, formatWith(value, bareOptions));
        if (layout.style === "currency" && layout.currencyDisplay === "name") {
          // The number has no space in it, so the name is everything after the first one, as one part.
          const space = builtins.indexOf(text, " ");
          const parts = numberParts(builtins.slice(text, 0, space));
          builtins.push(parts, { type: "literal", value: " " });
          builtins.push(parts, { type: "currency", value: builtins.slice(text, space + 1) });
          return parts;
        }
        return numberParts(text);
      });
      define(this, "resolvedOptions", () => {
        const asked = snapshot(options, [
          "style", "currency", "currencyDisplay", "currencySign", "unit", "unitDisplay", "minimumIntegerDigits",
          "minimumFractionDigits", "maximumFractionDigits", "minimumSignificantDigits", "maximumSignificantDigits",
          "useGrouping", "notation", "compactDisplay", "signDisplay", "roundingIncrement", "roundingMode", "roundingPriority", "trailingZeroDisplay",
        ]);
        const style = asked.style === undefined ? "decimal" : builtins.string(asked.style);
        const out = { locale: "en-US", numberingSystem: "latn", style };
        if (style === "currency") {
          out.currency = builtins.toUpperCase(builtins.string(asked.currency));
          out.currencyDisplay = asked.currencyDisplay === undefined ? "symbol" : asked.currencyDisplay;
          out.currencySign = asked.currencySign === undefined ? "standard" : asked.currencySign;
        } else if (style === "unit") {
          out.unit = asked.unit;
          out.unitDisplay = asked.unitDisplay === undefined ? "short" : asked.unitDisplay;
        }
        out.minimumIntegerDigits = asked.minimumIntegerDigits === undefined ? 1 : builtins.number(asked.minimumIntegerDigits);
        const sigAsked = asked.minimumSignificantDigits !== undefined || asked.maximumSignificantDigits !== undefined;
        const fracAsked = asked.minimumFractionDigits !== undefined || asked.maximumFractionDigits !== undefined;
        // A compact number with no digits asked for is rounded to two significant digits, or to whole
        // numbers when that is the nearer, as Node does; the priority reads morePrecision for it.
        const compactDigits = asked.notation === "compact" && !sigAsked && !fracAsked && (asked.roundingPriority === undefined || asked.roundingPriority === "auto");
        const priority = compactDigits ? "morePrecision" : asked.roundingPriority === undefined ? "auto" : builtins.string(asked.roundingPriority);
        if (!sigAsked || priority !== "auto" || fracAsked) {
          const base = style === "currency" ? currencyDigits(out.currency) : 0;
          const top = style === "currency" ? base : style === "percent" ? 0 : 3;
          const min = asked.minimumFractionDigits === undefined ? undefined : builtins.number(asked.minimumFractionDigits);
          const max = asked.maximumFractionDigits === undefined ? undefined : builtins.number(asked.maximumFractionDigits);
          out.minimumFractionDigits = compactDigits ? 0 : min === undefined ? builtins.min(base, max === undefined ? base : max) : min;
          out.maximumFractionDigits = compactDigits ? 0 : max === undefined ? builtins.max(top, out.minimumFractionDigits) : max;
        }
        if (sigAsked || priority !== "auto") {
          out.minimumSignificantDigits = asked.minimumSignificantDigits === undefined ? 1 : builtins.number(asked.minimumSignificantDigits);
          out.maximumSignificantDigits = asked.maximumSignificantDigits === undefined ? (compactDigits ? 2 : 21) : builtins.number(asked.maximumSignificantDigits);
        }
        const grouping = asked.useGrouping;
        const compact = asked.notation === "compact" ? "min2" : "auto";
        if (grouping === undefined) out.useGrouping = compact;
        else if (grouping === true) out.useGrouping = "always";
        else if (!grouping) out.useGrouping = false;
        else out.useGrouping = builtins.indexOfIn(["always", "auto", "min2"], builtins.string(grouping)) !== -1 ? builtins.string(grouping) : compact;
        out.notation = asked.notation === undefined ? "standard" : asked.notation;
        if (out.notation === "compact") out.compactDisplay = asked.compactDisplay === undefined ? "short" : asked.compactDisplay;
        out.signDisplay = asked.signDisplay === undefined ? "auto" : asked.signDisplay;
        // stripIfInteger reports the priority as auto, as Node does.
        const trailingZeros = asked.trailingZeroDisplay === undefined ? "auto" : builtins.string(asked.trailingZeroDisplay);
        out.roundingIncrement = asked.roundingIncrement === undefined ? 1 : builtins.floor(builtins.number(asked.roundingIncrement));
        out.roundingMode = asked.roundingMode === undefined ? "halfExpand" : builtins.string(asked.roundingMode);
        out.roundingPriority = trailingZeros === "stripIfInteger" ? "auto" : priority;
        out.trailingZeroDisplay = trailingZeros;
        return out;
      });
    }
  }

  const COLLATOR_OPTION_NAMES = ["usage", "sensitivity", "ignorePunctuation", "numeric", "caseFirst"];

  class Collator {
    constructor(locales, options) {
      checkLocales(locales);
      if (options === null) throw new TypeError("Intl.Collator called on null or undefined");
      options = snapshot(options, COLLATOR_OPTION_NAMES);
      const asked = options;
      choose(asked, "usage", ["sort", "search"], undefined, "Collator");
      choose(asked, "sensitivity", ["base", "accent", "case", "variant"], undefined, "Collator");
      choose(asked, "caseFirst", ["upper", "lower", "false"], undefined, "Collator");
      const compare = (a, b) => builtins.localeCompare(builtins.string(a), builtins.string(b), locales, options);
      define(this, "compare", compare);
      define(this, "resolvedOptions", () => {
        const asked = snapshot(options, COLLATOR_OPTION_NAMES);
        return {
          locale: "en-US",
          usage: asked.usage === undefined ? "sort" : asked.usage,
          sensitivity: asked.sensitivity === undefined ? "variant" : asked.sensitivity,
          ignorePunctuation: asked.ignorePunctuation === undefined ? false : Boolean(asked.ignorePunctuation),
          collation: "default",
          numeric: asked.numeric === undefined ? false : Boolean(asked.numeric),
          caseFirst: asked.caseFirst === undefined ? "false" : builtins.string(asked.caseFirst),
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

  const DATE_FORMAT_FIELDS = ["weekday", "year", "month", "day", "dateStyle"];
  const TIME_FORMAT_FIELDS = ["hour", "minute", "second", "fractionalSecondDigits", "timeStyle"];
  // Every option the formats read, copied once when the formatter is made.
  const DATE_OPTION_NAMES = [
    "weekday", "era", "year", "month", "day", "dayPeriod", "hour", "minute", "second", "fractionalSecondDigits",
    "timeZoneName", "dateStyle", "timeStyle", "hour12", "hourCycle", "timeZone", "calendar", "numberingSystem",
    "localeMatcher", "formatMatcher",
  ];

  class DateTimeFormat {
    constructor(locales, options) {
      if (options === null) throw new TypeError("Cannot convert undefined or null to object");
      let given = snapshot(options, DATE_OPTION_NAMES);
      // with nothing asked for, a date is written; toLocaleString would add the time
      if (!builtins.some(FORMAT_FIELDS, (name) => given[name] !== undefined)) {
        given = builtins.assign({ __proto__: null }, given, { year: "numeric", month: "numeric", day: "numeric" });
      }
      // A language the engine answers itself gets the engine's method for the parts asked
      // for, so a date alone is not followed by a time.
      const hasDate = builtins.some(DATE_FORMAT_FIELDS, (name) => given[name] !== undefined);
      const hasTime = builtins.some(TIME_FORMAT_FIELDS, (name) => given[name] !== undefined);
      const method = hasDate && !hasTime ? "toLocaleDateString"
        : hasTime && !hasDate ? "toLocaleTimeString"
        : "toLocaleString";
      const write = method === "toLocaleDateString" ? builtins.dateToLocaleDateString
        : method === "toLocaleTimeString" ? builtins.dateToLocaleTimeString
        : builtins.dateToLocaleString;
      // the arguments are checked now, as a constructor does, not at the first format;
      // the value a method refuses is named for this constructor, as Node names it
      try {
        write(new Date(0), locales, given);
      } catch (error) {
        if (error instanceof RangeError) {
          throw new RangeError(builtins.replace(error.message, / for Date\.prototype\.\w+ options/, " for Intl.DateTimeFormat options"));
        }
        throw error;
      }

      const format = (date) => {
        const when = new Date(date === undefined ? builtins.dateNow() : builtins.number(date));
        if (builtins.getTime(when) !== builtins.getTime(when)) throw new RangeError("Invalid time value");
        return write(when, locales, given);
      };
      define(this, "format", format);
      define(this, "formatToParts", (date) => {
        const when = new Date(date === undefined ? builtins.dateNow() : builtins.number(date));
        if (builtins.getTime(when) !== builtins.getTime(when)) throw new RangeError("Invalid time value");
        return host.extra("date").partsOf(when, method, locales, given);
      });
      define(this, "resolvedOptions", () => {
        const zone = given.timeZone === undefined ? hostTimeZone : builtins.string(given.timeZone);
        const out = { locale: "en-US", calendar: "gregory", numberingSystem: "latn", timeZone: builtins.indexOfIn(UTC_ZONES, builtins.toLowerCase(zone)) === -1 ? host.extra("date").timeZoneId(zone) : "UTC" };
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

  // The grammar of a language tag, as the engine reads it, with no singleton given twice.
  // Node refuses a tag that fails either check with "Invalid language tag".
  const LANGUAGE_TAG = /^(?:[a-z]{2,3}|[a-z]{5,8})(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?(?:-(?:[a-z\d]{5,8}|\d[a-z\d]{3}))*(?:-[\da-wy-z](?:-[a-z\d]{2,8})+)*(?:-x(?:-[a-z\d]{1,8})+)?$/i;

  function checkLocales(locales) {
    const tags = builtins.isArray(locales) ? locales : [locales];
    for (let i = 0; i < tags.length; i++) {
      if (tags[i] === undefined) continue;
      const tag = builtins.string(tags[i]);
      const singletons = builtins.filter(builtins.split(builtins.split(builtins.toLowerCase(tag), "-x-")[0], "-"), (subtag) => subtag.length === 1);
      if (!builtins.test(LANGUAGE_TAG, tag) || builtins.some(singletons, (subtag, at) => builtins.indexOfIn(singletons, subtag) !== at)) {
        throw new RangeError("Invalid language tag: " + tag);
      }
    }
  }

  // PluralRules and ListFormat only know English; any other language is refused
  // rather than answered with English rules.
  function checkLocale(locales, ending) {
    checkLocales(locales);
    const tag = builtins.isArray(locales) ? locales[0] : locales;
    if (tag === undefined) return "en-US";
    if (!builtins.test(ending, builtins.string(tag))) throw new RangeError("Incorrect locale information provided");
    return builtins.string(tag);
  }

  function choose(options, name, allowed, fallback, owner) {
    const given = options[name];
    if (given === undefined) return fallback;
    const text = builtins.string(given);
    if (builtins.indexOfIn(allowed, text) === -1) {
      throw new RangeError("Value " + text + " out of range for Intl." + owner + " options property " + name);
    }
    return text;
  }

  // The end of a range of numbers, which is refused when it is not one, as Node names it.
  function rangeEnd(value, which) {
    if (value === undefined) throw new TypeError("Invalid " + which + " : undefined");
    if (builtins.numberIsNaN(+value)) throw new RangeError("Invalid " + which + " : NaN");
  }

  class PluralRules {
    #type;
    #locale;
    #digits;

    constructor(locales, options) {
      this.#locale = checkLocale(locales, /^en(-[A-Za-z0-9]+)*$/i);
      if (options === null) throw new TypeError("Cannot convert undefined or null to object");
      const given = options === undefined ? { __proto__: null } : Object(options);
      this.#type = choose(given, "type", ["cardinal", "ordinal"], "cardinal", "PluralRules");
      this.#digits = { __proto__: null, useGrouping: false };
      if (given.minimumFractionDigits !== undefined) this.#digits.minimumFractionDigits = given.minimumFractionDigits;
      if (given.maximumFractionDigits !== undefined) this.#digits.maximumFractionDigits = given.maximumFractionDigits;
      // the digits are checked now, as a constructor does
      builtins.numberToLocaleString(0, "en-US", this.#digits);
    }

    // English puts every range of numbers in "other", whatever the ends are.
    selectRange(start, end) {
      // The receiver must be a PluralRules, as it is for select.
      void this.#type;
      rangeEnd(start, "startRange");
      rangeEnd(end, "endRange");
      return "other";
    }

    select(value) {
      const type = this.#type;
      const number = +value;
      if (!builtins.numberIsFinite(number)) return "other";

      // The digits as they are shown decide the category, so 1.0 is not "one".
      const shown = builtins.numberToLocaleString(builtins.abs(number), "en-US", this.#digits);
      const point = builtins.indexOf(shown, ".");
      const whole = point === -1 ? shown : builtins.slice(shown, 0, point);
      const fraction = point === -1 ? "" : builtins.slice(shown, point + 1);
      if (type === "cardinal") return fraction === "" && whole === "1" ? "one" : "other";
      // An ordinal rule reads the whole number, so 2.0 is "two", but 2.5 is "other".
      if (builtins.test(/[1-9]/, fraction)) return "other";

      const last = builtins.charCodeAt(whole, whole.length - 1) - 48;
      const tens = whole.length > 1 ? builtins.charCodeAt(whole, whole.length - 2) - 48 : 0;
      if (tens === 1) return "other";
      return last === 1 ? "one" : last === 2 ? "two" : last === 3 ? "few" : "other";
    }

    resolvedOptions() {
      const digits = this.#digits;
      const min = digits.minimumFractionDigits === undefined ? 0 : builtins.number(digits.minimumFractionDigits);
      const max = digits.maximumFractionDigits === undefined ? builtins.max(3, min) : builtins.number(digits.maximumFractionDigits);
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
      const given = options === undefined ? { __proto__: null } : Object(options);
      this.#type = choose(given, "type", ["conjunction", "disjunction", "unit"], "conjunction", "ListFormat");
      this.#style = choose(given, "style", ["long", "short", "narrow"], "long", "ListFormat");
    }

    format(list) {
      return builtins.join(builtins.map(this.#parts(list), (part) => part.value), "");
    }

    formatToParts(list) {
      return this.#parts(list);
    }

    #parts(list) {
      const pattern = LIST_PATTERNS[this.#type][this.#style];
      const items = [];
      if (list !== undefined) {
        for (const item of list) {
          if (typeof item !== "string") throw new TypeError("Iterable yielded " + builtins.string(item) + " which is not a string");
          items[items.length] = item;
        }
      }

      const parts = [];
      const element = (value) => builtins.push(parts, { type: "element", value });
      const literal = (value) => builtins.push(parts, { type: "literal", value });
      if (items.length < 3) {
        if (items.length > 0) element(items[0]);
        if (items.length === 2) {
          literal(pattern[0]);
          element(items[1]);
        }
        return parts;
      }
      element(items[0]);
      for (let i = 1; i < items.length - 1; i++) {
        literal(pattern[1]);
        element(items[i]);
      }
      literal(pattern[2]);
      element(items[items.length - 1]);
      return parts;
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
      const given = options === undefined ? { __proto__: null } : Object(options);
      this.#style = choose(given, "style", ["long", "short", "narrow"], "long", "RelativeTimeFormat");
      this.#numeric = choose(given, "numeric", ["always", "auto"], "always", "RelativeTimeFormat");
    }

    format(value, unit) {
      return builtins.join(builtins.map(this.#parts(value, unit, "format"), (part) => part.value), "");
    }

    formatToParts(value, unit) {
      return this.#parts(value, unit, "formatToParts");
    }

    // The errors name the method that was called, as Node does.
    #parts(value, unit, method) {
      const number = builtins.number(value);
      const text = builtins.string(unit);
      const name = builtins.endsWith(text, "s") ? builtins.slice(text, 0, -1) : text;
      if (!builtins.hasOwn(UNIT_NAMES.long, name)) {
        throw new RangeError("Invalid unit argument for Intl.RelativeTimeFormat.prototype." + method + "() '" + text + "'");
      }
      if (!builtins.numberIsFinite(number)) {
        throw new RangeError("Value need to be finite number for Intl.RelativeTimeFormat.prototype." + method + "()");
      }

      const style = this.#style;
      const word = (text) => [{ type: "literal", value: text }];
      if (this.#numeric === "auto" && (number === -1 || number === 0 || number === 1)) {
        const key = builtins.is(number, -0) ? 0 : number;
        if (name === "day") return word(DAY_WORDS[key]);
        if (name === "second" && key === 0) return word("now");
        if ((name === "minute" || name === "hour") && key === 0) return word("this " + name);
        if (name !== "second" && name !== "minute" && name !== "hour") {
          const unitName = PHRASE_NAMES[style][name];
          return word(WORDS[key] + " " + (typeof unitName === "string" ? unitName : unitName[0]));
        }
      }

      const shown = builtins.numberToLocaleString(builtins.abs(number), "en-US");
      const names = UNIT_NAMES[style][name];
      const unitName = typeof names === "string" ? names : names[shown === "1" ? 0 : 1];
      const amount = builtins.map(numberParts(shown), (part) => ({ type: part.type, value: part.value, unit: name }));
      const tail = (style === "narrow" ? "" : " ") + unitName;
      if (number < 0 || builtins.is(number, -0)) return [...amount, { type: "literal", value: tail + " ago" }];
      return [{ type: "literal", value: "in " }, ...amount, { type: "literal", value: tail }];
    }

    resolvedOptions() {
      return { locale: "en-US", style: this.#style, numeric: this.#numeric, numberingSystem: "latn" };
    }
  }

  // Where a text is cut. These are approximations of the Unicode rules, the same
  // for every language: a grapheme is a character with its marks and joined
  // emoji, a word is a run of letters, digits and the apostrophe or the point
  // between them, a sentence ends after . ! or ? and the space that follows.
  const SEGMENT_PATTERNS = {
    grapheme: /\r\n|\p{Regional_Indicator}{2}|[^\p{M}\u200d][\p{M}\ufe0f\p{Emoji_Modifier}]*(?:\u200d\p{Extended_Pictographic}[\p{M}\ufe0f\p{Emoji_Modifier}]*)*|[\s\S]/gu,
    word: /[\p{L}\p{N}_]+(?:['’.][\p{L}\p{N}_]+)*|\s+|[\s\S]/gu,
    sentence: /[\s\S]*?(?:[.!?]+['")\]]*(?:\s+|$)|$)/gu,
  };

  class Segments {
    #input;
    #granularity;

    constructor(input, granularity) {
      this.#input = input;
      this.#granularity = granularity;
    }

    *[Symbol.iterator]() {
      const input = this.#input;
      const granularity = this.#granularity;
      const pattern = new RegExp(SEGMENT_PATTERNS[granularity].source, "gu");
      let match;
      while ((match = builtins.exec(pattern, input)) !== null && match[0] !== "") {
        const entry = { segment: match[0], index: match.index, input };
        if (granularity === "word") entry.isWordLike = builtins.test(/[\p{L}\p{N}]/u, match[0]);
        yield entry;
      }
    }

    containing(index) {
      const at = builtins.trunc(builtins.number(index)) || 0;
      if (at < 0 || at >= this.#input.length) return undefined;
      for (const entry of this) {
        if (at < entry.index + entry.segment.length) return entry;
      }
      return undefined;
    }
  }

  class Segmenter {
    #granularity;

    constructor(locales, options) {
      checkLocales(locales);
      if (options === null) throw new TypeError("Cannot convert undefined or null to object");
      const asked = options === undefined ? { __proto__: null } : Object(options);
      this.#granularity = choose(asked, "granularity", ["grapheme", "word", "sentence"], "grapheme", "Segmenter");
    }

    segment(input) {
      return new Segments(builtins.string(input), this.#granularity);
    }

    resolvedOptions() {
      return { locale: "en-US", granularity: this.#granularity };
    }
  }

  builtins.defineProperty(NumberFormat.prototype, Symbol.toStringTag, { value: "Intl.NumberFormat", configurable: true });
  builtins.defineProperty(DateTimeFormat.prototype, Symbol.toStringTag, { value: "Intl.DateTimeFormat", configurable: true });
  builtins.defineProperty(Collator.prototype, Symbol.toStringTag, { value: "Intl.Collator", configurable: true });
  builtins.defineProperty(Segmenter.prototype, Symbol.toStringTag, { value: "Intl.Segmenter", configurable: true });
  builtins.defineProperty(RelativeTimeFormat.prototype, Symbol.toStringTag, { value: "Intl.RelativeTimeFormat", configurable: true });
  builtins.defineProperty(PluralRules.prototype, Symbol.toStringTag, { value: "Intl.PluralRules", configurable: true });
  builtins.defineProperty(ListFormat.prototype, Symbol.toStringTag, { value: "Intl.ListFormat", configurable: true });

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

  // Names Intl.DisplayNames gives in English, as Node 26.13 gives them. A region
  // with a numeric code is a UN M.49 area. Only base languages are named.
  const REGION_NAMES = {
    "AC": "Ascension Island", "AD": "Andorra", "AE": "United Arab Emirates",
    "AF": "Afghanistan", "AG": "Antigua & Barbuda", "AI": "Anguilla",
    "AL": "Albania", "AM": "Armenia", "AN": "Cura\u00e7ao",
    "AO": "Angola", "AQ": "Antarctica", "AR": "Argentina",
    "AS": "American Samoa", "AT": "Austria", "AU": "Australia",
    "AW": "Aruba", "AX": "\u00c5land Islands", "AZ": "Azerbaijan",
    "BA": "Bosnia & Herzegovina", "BB": "Barbados", "BD": "Bangladesh",
    "BE": "Belgium", "BF": "Burkina Faso", "BG": "Bulgaria",
    "BH": "Bahrain", "BI": "Burundi", "BJ": "Benin",
    "BL": "St. Barth\u00e9lemy", "BM": "Bermuda", "BN": "Brunei",
    "BO": "Bolivia", "BQ": "Caribbean Netherlands", "BR": "Brazil",
    "BS": "Bahamas", "BT": "Bhutan", "BU": "Myanmar (Burma)",
    "BV": "Bouvet Island", "BW": "Botswana", "BY": "Belarus",
    "BZ": "Belize", "CA": "Canada", "CC": "Cocos (Keeling) Islands",
    "CD": "Congo - Kinshasa", "CF": "Central African Republic", "CG": "Congo - Brazzaville",
    "CH": "Switzerland", "CI": "C\u00f4te d\u2019Ivoire", "CK": "Cook Islands",
    "CL": "Chile", "CM": "Cameroon", "CN": "China",
    "CO": "Colombia", "CP": "Clipperton Island", "CQ": "Sark",
    "CR": "Costa Rica", "CS": "Serbia", "CU": "Cuba",
    "CV": "Cape Verde", "CW": "Cura\u00e7ao", "CX": "Christmas Island",
    "CY": "Cyprus", "CZ": "Czechia", "DD": "Germany",
    "DE": "Germany", "DG": "Diego Garcia", "DJ": "Djibouti",
    "DK": "Denmark", "DM": "Dominica", "DO": "Dominican Republic",
    "DY": "Benin", "DZ": "Algeria", "EA": "Ceuta & Melilla",
    "EC": "Ecuador", "EE": "Estonia", "EG": "Egypt",
    "EH": "Western Sahara", "ER": "Eritrea", "ES": "Spain",
    "ET": "Ethiopia", "EU": "European Union", "EZ": "Eurozone",
    "FI": "Finland", "FJ": "Fiji", "FK": "Falkland Islands",
    "FM": "Micronesia", "FO": "Faroe Islands", "FR": "France",
    "FX": "France", "GA": "Gabon", "GB": "United Kingdom",
    "GD": "Grenada", "GE": "Georgia", "GF": "French Guiana",
    "GG": "Guernsey", "GH": "Ghana", "GI": "Gibraltar",
    "GL": "Greenland", "GM": "Gambia", "GN": "Guinea",
    "GP": "Guadeloupe", "GQ": "Equatorial Guinea", "GR": "Greece",
    "GS": "South Georgia & South Sandwich Islands", "GT": "Guatemala", "GU": "Guam",
    "GW": "Guinea-Bissau", "GY": "Guyana", "HK": "Hong Kong SAR China",
    "HM": "Heard & McDonald Islands", "HN": "Honduras", "HR": "Croatia",
    "HT": "Haiti", "HU": "Hungary", "HV": "Burkina Faso",
    "IC": "Canary Islands", "ID": "Indonesia", "IE": "Ireland",
    "IL": "Israel", "IM": "Isle of Man", "IN": "India",
    "IO": "British Indian Ocean Territory", "IQ": "Iraq", "IR": "Iran",
    "IS": "Iceland", "IT": "Italy", "JE": "Jersey",
    "JM": "Jamaica", "JO": "Jordan", "JP": "Japan",
    "KE": "Kenya", "KG": "Kyrgyzstan", "KH": "Cambodia",
    "KI": "Kiribati", "KM": "Comoros", "KN": "St. Kitts & Nevis",
    "KP": "North Korea", "KR": "South Korea", "KW": "Kuwait",
    "KY": "Cayman Islands", "KZ": "Kazakhstan", "LA": "Laos",
    "LB": "Lebanon", "LC": "St. Lucia", "LI": "Liechtenstein",
    "LK": "Sri Lanka", "LR": "Liberia", "LS": "Lesotho",
    "LT": "Lithuania", "LU": "Luxembourg", "LV": "Latvia",
    "LY": "Libya", "MA": "Morocco", "MC": "Monaco",
    "MD": "Moldova", "ME": "Montenegro", "MF": "St. Martin",
    "MG": "Madagascar", "MH": "Marshall Islands", "MK": "North Macedonia",
    "ML": "Mali", "MM": "Myanmar (Burma)", "MN": "Mongolia",
    "MO": "Macao SAR China", "MP": "Northern Mariana Islands", "MQ": "Martinique",
    "MR": "Mauritania", "MS": "Montserrat", "MT": "Malta",
    "MU": "Mauritius", "MV": "Maldives", "MW": "Malawi",
    "MX": "Mexico", "MY": "Malaysia", "MZ": "Mozambique",
    "NA": "Namibia", "NC": "New Caledonia", "NE": "Niger",
    "NF": "Norfolk Island", "NG": "Nigeria", "NH": "Vanuatu",
    "NI": "Nicaragua", "NL": "Netherlands", "NO": "Norway",
    "NP": "Nepal", "NR": "Nauru", "NU": "Niue",
    "NZ": "New Zealand", "OM": "Oman", "PA": "Panama",
    "PE": "Peru", "PF": "French Polynesia", "PG": "Papua New Guinea",
    "PH": "Philippines", "PK": "Pakistan", "PL": "Poland",
    "PM": "St. Pierre & Miquelon", "PN": "Pitcairn Islands", "PR": "Puerto Rico",
    "PS": "Palestinian Territories", "PT": "Portugal", "PW": "Palau",
    "PY": "Paraguay", "QA": "Qatar", "QO": "Outlying Oceania",
    "RE": "R\u00e9union", "RH": "Zimbabwe", "RO": "Romania",
    "RS": "Serbia", "RU": "Russia", "RW": "Rwanda",
    "SA": "Saudi Arabia", "SB": "Solomon Islands", "SC": "Seychelles",
    "SD": "Sudan", "SE": "Sweden", "SG": "Singapore",
    "SH": "St. Helena", "SI": "Slovenia", "SJ": "Svalbard & Jan Mayen",
    "SK": "Slovakia", "SL": "Sierra Leone", "SM": "San Marino",
    "SN": "Senegal", "SO": "Somalia", "SR": "Suriname",
    "SS": "South Sudan", "ST": "S\u00e3o Tom\u00e9 & Pr\u00edncipe", "SU": "Russia",
    "SV": "El Salvador", "SX": "Sint Maarten", "SY": "Syria",
    "SZ": "Eswatini", "TA": "Tristan da Cunha", "TC": "Turks & Caicos Islands",
    "TD": "Chad", "TF": "French Southern Territories", "TG": "Togo",
    "TH": "Thailand", "TJ": "Tajikistan", "TK": "Tokelau",
    "TL": "Timor-Leste", "TM": "Turkmenistan", "TN": "Tunisia",
    "TO": "Tonga", "TP": "Timor-Leste", "TR": "T\u00fcrkiye",
    "TT": "Trinidad & Tobago", "TV": "Tuvalu", "TW": "Taiwan",
    "TZ": "Tanzania", "UA": "Ukraine", "UG": "Uganda",
    "UK": "United Kingdom", "UM": "U.S. Outlying Islands", "UN": "United Nations",
    "US": "United States", "UY": "Uruguay", "UZ": "Uzbekistan",
    "VA": "Vatican City", "VC": "St. Vincent & Grenadines", "VD": "Vietnam",
    "VE": "Venezuela", "VG": "British Virgin Islands", "VI": "U.S. Virgin Islands",
    "VN": "Vietnam", "VU": "Vanuatu", "WF": "Wallis & Futuna",
    "WS": "Samoa", "XA": "Pseudo-Accents", "XB": "Pseudo-Bidi",
    "XK": "Kosovo", "YD": "Yemen", "YE": "Yemen",
    "YT": "Mayotte", "YU": "Serbia", "ZA": "South Africa",
    "ZM": "Zambia", "ZR": "Congo - Kinshasa", "ZW": "Zimbabwe",
    "ZZ": "Unknown Region", "001": "world", "002": "Africa",
    "003": "North America", "005": "South America", "009": "Oceania",
    "011": "Western Africa", "013": "Central America", "014": "Eastern Africa",
    "015": "Northern Africa", "017": "Middle Africa", "018": "Southern Africa",
    "019": "Americas", "021": "Northern America", "029": "Caribbean",
    "030": "Eastern Asia", "034": "Southern Asia", "035": "Southeast Asia",
    "039": "Southern Europe", "053": "Australasia", "054": "Melanesia",
    "057": "Micronesian Region", "061": "Polynesia", "142": "Asia",
    "143": "Central Asia", "145": "Western Asia", "150": "Europe",
    "151": "Eastern Europe", "154": "Northern Europe", "155": "Western Europe",
    "202": "Sub-Saharan Africa", "419": "Latin America",
  };

  const SHORT_REGION_NAMES = {
    "BA": "Bosnia", "CC": "Cocos Islands", "GB": "UK",
    "HK": "Hong Kong", "MM": "Myanmar", "MO": "Macao",
    "PN": "Pitcairn", "PS": "Palestine", "UN": "UN",
    "US": "US",
  };

  const CURRENCY_NAMES = {
    "ADP": "Andorran Peseta", "AED": "United Arab Emirates Dirham", "AFA": "Afghan Afghani (1927\u20132002)",
    "AFN": "Afghan Afghani", "ALK": "Albanian Lek (1946\u20131965)", "ALL": "Albanian Lek",
    "AMD": "Armenian Dram", "ANG": "Netherlands Antillean Guilder", "AOA": "Angolan Kwanza",
    "AOK": "Angolan Kwanza (1977\u20131991)", "AON": "Angolan New Kwanza (1990\u20132000)", "AOR": "Angolan Readjusted Kwanza (1995\u20131999)",
    "ARA": "Argentine Austral", "ARL": "Argentine Peso Ley (1970\u20131983)", "ARM": "Argentine Peso (1881\u20131970)",
    "ARP": "Argentine Peso (1983\u20131985)", "ARS": "Argentine Peso", "ATS": "Austrian Schilling",
    "AUD": "Australian Dollar", "AWG": "Aruban Florin", "AZM": "Azerbaijani Manat (1993\u20132006)",
    "AZN": "Azerbaijani Manat", "BAD": "Bosnia-Herzegovina Dinar (1992\u20131994)", "BAM": "Bosnia-Herzegovina Convertible Mark",
    "BAN": "Bosnia-Herzegovina New Dinar (1994\u20131997)", "BBD": "Barbadian Dollar", "BDT": "Bangladeshi Taka",
    "BEC": "Belgian Franc (convertible)", "BEF": "Belgian Franc", "BEL": "Belgian Franc (financial)",
    "BGL": "Bulgarian Hard Lev", "BGM": "Bulgarian Socialist Lev", "BGN": "Bulgarian Lev",
    "BGO": "Bulgarian Lev (1879\u20131952)", "BHD": "Bahraini Dinar", "BIF": "Burundian Franc",
    "BMD": "Bermudan Dollar", "BND": "Brunei Dollar", "BOB": "Bolivian Boliviano",
    "BOL": "Bolivian Boliviano (1863\u20131963)", "BOP": "Bolivian Peso", "BOV": "Bolivian Mvdol",
    "BRB": "Brazilian New Cruzeiro (1967\u20131986)", "BRC": "Brazilian Cruzado (1986\u20131989)", "BRE": "Brazilian Cruzeiro (1990\u20131993)",
    "BRL": "Brazilian Real", "BRN": "Brazilian New Cruzado (1989\u20131990)", "BRR": "Brazilian Cruzeiro (1993\u20131994)",
    "BRZ": "Brazilian Cruzeiro (1942\u20131967)", "BSD": "Bahamian Dollar", "BTN": "Bhutanese Ngultrum",
    "BUK": "Burmese Kyat", "BWP": "Botswanan Pula", "BYB": "Belarusian Ruble (1994\u20131999)",
    "BYN": "Belarusian Ruble", "BYR": "Belarusian Ruble (2000\u20132016)", "BZD": "Belize Dollar",
    "CAD": "Canadian Dollar", "CDF": "Congolese Franc", "CHE": "WIR Euro",
    "CHF": "Swiss Franc", "CHW": "WIR Franc", "CLE": "Chilean Escudo",
    "CLF": "Chilean Unit of Account (UF)", "CLP": "Chilean Peso", "CNH": "Chinese Yuan (offshore)",
    "CNX": "Chinese People\u2019s Bank Dollar", "CNY": "Chinese Yuan", "COP": "Colombian Peso",
    "COU": "Colombian Real Value Unit", "CRC": "Costa Rican Col\u00f3n", "CSD": "Serbian Dinar (2002\u20132006)",
    "CSK": "Czechoslovak Hard Koruna", "CUC": "Cuban Convertible Peso", "CUP": "Cuban Peso",
    "CVE": "Cape Verdean Escudo", "CYP": "Cypriot Pound", "CZK": "Czech Koruna",
    "DDM": "East German Mark", "DEM": "German Mark", "DJF": "Djiboutian Franc",
    "DKK": "Danish Krone", "DOP": "Dominican Peso", "DZD": "Algerian Dinar",
    "ECS": "Ecuadorian Sucre", "ECV": "Ecuadorian Unit of Constant Value", "EEK": "Estonian Kroon",
    "EGP": "Egyptian Pound", "ERN": "Eritrean Nakfa", "ESA": "Spanish Peseta (A account)",
    "ESB": "Spanish Peseta (convertible account)", "ESP": "Spanish Peseta", "ETB": "Ethiopian Birr",
    "EUR": "Euro", "FIM": "Finnish Markka", "FJD": "Fijian Dollar",
    "FKP": "Falkland Islands Pound", "FRF": "French Franc", "GBP": "British Pound",
    "GEK": "Georgian Kupon Larit", "GEL": "Georgian Lari", "GHC": "Ghanaian Cedi (1979\u20132007)",
    "GHS": "Ghanaian Cedi", "GIP": "Gibraltar Pound", "GMD": "Gambian Dalasi",
    "GNF": "Guinean Franc", "GNS": "Guinean Syli", "GQE": "Equatorial Guinean Ekwele",
    "GRD": "Greek Drachma", "GTQ": "Guatemalan Quetzal", "GWE": "Portuguese Guinea Escudo",
    "GWP": "Guinea-Bissau Peso", "GYD": "Guyanaese Dollar", "HKD": "Hong Kong Dollar",
    "HNL": "Honduran Lempira", "HRD": "Croatian Dinar", "HRK": "Croatian Kuna",
    "HTG": "Haitian Gourde", "HUF": "Hungarian Forint", "IDR": "Indonesian Rupiah",
    "IEP": "Irish Pound", "ILP": "Israeli Pound", "ILR": "Israeli Shekel (1980\u20131985)",
    "ILS": "Israeli New Shekel", "INR": "Indian Rupee", "IQD": "Iraqi Dinar",
    "IRR": "Iranian Rial", "ISJ": "Icelandic Kr\u00f3na (1918\u20131981)", "ISK": "Icelandic Kr\u00f3na",
    "ITL": "Italian Lira", "JMD": "Jamaican Dollar", "JOD": "Jordanian Dinar",
    "JPY": "Japanese Yen", "KES": "Kenyan Shilling", "KGS": "Kyrgyz Som",
    "KHR": "Cambodian Riel", "KMF": "Comorian Franc", "KPW": "North Korean Won",
    "KRH": "South Korean Hwan (1953\u20131962)", "KRO": "South Korean Won (1945\u20131953)", "KRW": "South Korean Won",
    "KWD": "Kuwaiti Dinar", "KYD": "Cayman Islands Dollar", "KZT": "Kazakhstani Tenge",
    "LAK": "Laotian Kip", "LBP": "Lebanese Pound", "LKR": "Sri Lankan Rupee",
    "LRD": "Liberian Dollar", "LSL": "Lesotho Loti", "LTL": "Lithuanian Litas",
    "LTT": "Lithuanian Talonas", "LUC": "Luxembourgian Convertible Franc", "LUF": "Luxembourgian Franc",
    "LUL": "Luxembourg Financial Franc", "LVL": "Latvian Lats", "LVR": "Latvian Ruble",
    "LYD": "Libyan Dinar", "MAD": "Moroccan Dirham", "MAF": "Moroccan Franc",
    "MCF": "Monegasque Franc", "MDC": "Moldovan Cupon", "MDL": "Moldovan Leu",
    "MGA": "Malagasy Ariary", "MGF": "Malagasy Franc", "MKD": "Macedonian Denar",
    "MKN": "Macedonian Denar (1992\u20131993)", "MLF": "Malian Franc", "MMK": "Myanmar Kyat",
    "MNT": "Mongolian Tugrik", "MOP": "Macanese Pataca", "MRO": "Mauritanian Ouguiya (1973\u20132017)",
    "MRU": "Mauritanian Ouguiya", "MTL": "Maltese Lira", "MTP": "Maltese Pound",
    "MUR": "Mauritian Rupee", "MVP": "Maldivian Rupee (1947\u20131981)", "MVR": "Maldivian Rufiyaa",
    "MWK": "Malawian Kwacha", "MXN": "Mexican Peso", "MXP": "Mexican Silver Peso (1861\u20131992)",
    "MXV": "Mexican Investment Unit", "MYR": "Malaysian Ringgit", "MZE": "Mozambican Escudo",
    "MZM": "Mozambican Metical (1980\u20132006)", "MZN": "Mozambican Metical", "NAD": "Namibian Dollar",
    "NGN": "Nigerian Naira", "NIC": "Nicaraguan C\u00f3rdoba (1988\u20131991)", "NIO": "Nicaraguan C\u00f3rdoba",
    "NLG": "Dutch Guilder", "NOK": "Norwegian Krone", "NPR": "Nepalese Rupee",
    "NZD": "New Zealand Dollar", "OMR": "Omani Rial", "PAB": "Panamanian Balboa",
    "PEI": "Peruvian Inti", "PEN": "Peruvian Sol", "PES": "Peruvian Sol (1863\u20131965)",
    "PGK": "Papua New Guinean Kina", "PHP": "Philippine Peso", "PKR": "Pakistani Rupee",
    "PLN": "Polish Zloty", "PLZ": "Polish Zloty (1950\u20131995)", "PTE": "Portuguese Escudo",
    "PYG": "Paraguayan Guarani", "QAR": "Qatari Riyal", "RHD": "Rhodesian Dollar",
    "ROL": "Romanian Leu (1952\u20132006)", "RON": "Romanian Leu", "RSD": "Serbian Dinar",
    "RUB": "Russian Ruble", "RUR": "Russian Ruble (1991\u20131998)", "RWF": "Rwandan Franc",
    "SAR": "Saudi Riyal", "SBD": "Solomon Islands Dollar", "SCR": "Seychellois Rupee",
    "SDD": "Sudanese Dinar (1992\u20132007)", "SDG": "Sudanese Pound", "SDP": "Sudanese Pound (1957\u20131998)",
    "SEK": "Swedish Krona", "SGD": "Singapore Dollar", "SHP": "St. Helena Pound",
    "SIT": "Slovenian Tolar", "SKK": "Slovak Koruna", "SLE": "Sierra Leonean Leone",
    "SLL": "Sierra Leonean Leone (1964\u20142022)", "SOS": "Somali Shilling", "SRD": "Surinamese Dollar",
    "SRG": "Surinamese Guilder", "SSP": "South Sudanese Pound", "STD": "S\u00e3o Tom\u00e9 & Pr\u00edncipe Dobra (1977\u20132017)",
    "STN": "S\u00e3o Tom\u00e9 & Pr\u00edncipe Dobra", "SUR": "Soviet Rouble", "SVC": "Salvadoran Col\u00f3n",
    "SYP": "Syrian Pound", "SZL": "Swazi Lilangeni", "THB": "Thai Baht",
    "TJR": "Tajikistani Ruble", "TJS": "Tajikistani Somoni", "TMM": "Turkmenistani Manat (1993\u20132009)",
    "TMT": "Turkmenistani Manat", "TND": "Tunisian Dinar", "TOP": "Tongan Pa\u02bbanga",
    "TPE": "Timorese Escudo", "TRL": "Turkish Lira (1922\u20132005)", "TRY": "Turkish Lira",
    "TTD": "Trinidad & Tobago Dollar", "TWD": "New Taiwan Dollar", "TZS": "Tanzanian Shilling",
    "UAH": "Ukrainian Hryvnia", "UAK": "Ukrainian Karbovanets", "UGS": "Ugandan Shilling (1966\u20131987)",
    "UGX": "Ugandan Shilling", "USD": "US Dollar", "USN": "US Dollar (Next day)",
    "USS": "US Dollar (Same day)", "UYI": "Uruguayan Peso (Indexed Units)", "UYP": "Uruguayan Peso (1975\u20131993)",
    "UYU": "Uruguayan Peso", "UYW": "Uruguayan Nominal Wage Index Unit", "UZS": "Uzbekistani Som",
    "VEB": "Venezuelan Bol\u00edvar (1871\u20132008)", "VED": "Bol\u00edvar Soberano", "VEF": "Venezuelan Bol\u00edvar (2008\u20132018)",
    "VES": "Venezuelan Bol\u00edvar", "VND": "Vietnamese Dong", "VNN": "Vietnamese Dong (1978\u20131985)",
    "VUV": "Vanuatu Vatu", "WST": "Samoan Tala", "XAF": "Central African CFA Franc",
    "XAG": "Silver", "XAU": "Gold", "XBA": "European Composite Unit",
    "XBB": "European Monetary Unit", "XBC": "European Unit of Account (XBC)", "XBD": "European Unit of Account (XBD)",
    "XCD": "East Caribbean Dollar", "XCG": "Caribbean guilder", "XDR": "Special Drawing Rights",
    "XEU": "European Currency Unit", "XFO": "French Gold Franc", "XFU": "French UIC-Franc",
    "XOF": "West African CFA Franc", "XPD": "Palladium", "XPF": "CFP Franc",
    "XPT": "Platinum", "XRE": "RINET Funds", "XSU": "Sucre",
    "XTS": "Testing Currency Code", "XUA": "ADB Unit of Account", "XXX": "Unknown Currency",
    "YDD": "Yemeni Dinar", "YER": "Yemeni Rial", "YUD": "Yugoslavian Hard Dinar (1966\u20131990)",
    "YUM": "Yugoslavian New Dinar (1994\u20132002)", "YUN": "Yugoslavian Convertible Dinar (1990\u20131992)", "YUR": "Yugoslavian Reformed Dinar (1992\u20131993)",
    "ZAL": "South African Rand (financial)", "ZAR": "South African Rand", "ZMK": "Zambian Kwacha (1968\u20132012)",
    "ZMW": "Zambian Kwacha", "ZRN": "Zairean New Zaire (1993\u20131998)", "ZRZ": "Zairean Zaire (1971\u20131993)",
    "ZWD": "Zimbabwean Dollar (1980\u20132008)", "ZWG": "Zimbabwean Gold", "ZWL": "Zimbabwean Dollar (2009\u20132024)",
    "ZWR": "Zimbabwean Dollar (2008)",
  };

  const LANGUAGE_NAMES = {
    "aa": "Afar", "ab": "Abkhazian", "ae": "Avestan",
    "af": "Afrikaans", "ak": "Akan", "am": "Amharic",
    "an": "Aragonese", "ar": "Arabic", "as": "Assamese",
    "av": "Avaric", "ay": "Aymara", "az": "Azerbaijani",
    "ba": "Bashkir", "be": "Belarusian", "bg": "Bulgarian",
    "bh": "Bhojpuri", "bi": "Bislama", "bm": "Bambara",
    "bn": "Bangla", "bo": "Tibetan", "br": "Breton",
    "bs": "Bosnian", "ca": "Catalan", "ce": "Chechen",
    "ch": "Chamorro", "co": "Corsican", "cr": "Cree",
    "cs": "Czech", "cu": "Church Slavic", "cv": "Chuvash",
    "cy": "Welsh", "da": "Danish", "de": "German",
    "dv": "Divehi", "dz": "Dzongkha", "ee": "Ewe",
    "el": "Greek", "en": "English", "eo": "Esperanto",
    "es": "Spanish", "et": "Estonian", "eu": "Basque",
    "fa": "Persian", "ff": "Fula", "fi": "Finnish",
    "fj": "Fijian", "fo": "Faroese", "fr": "French",
    "fy": "Western Frisian", "ga": "Irish", "gd": "Scottish Gaelic",
    "gl": "Galician", "gn": "Guarani", "gu": "Gujarati",
    "gv": "Manx", "ha": "Hausa", "he": "Hebrew",
    "hi": "Hindi", "ho": "Hiri Motu", "hr": "Croatian",
    "ht": "Haitian Creole", "hu": "Hungarian", "hy": "Armenian",
    "hz": "Herero", "ia": "Interlingua", "id": "Indonesian",
    "ie": "Interlingue", "ig": "Igbo", "ii": "Sichuan Yi",
    "ik": "Inupiaq", "in": "Indonesian", "io": "Ido",
    "is": "Icelandic", "it": "Italian", "iu": "Inuktitut",
    "iw": "Hebrew", "ja": "Japanese", "ji": "Yiddish",
    "jv": "Javanese", "jw": "Javanese", "ka": "Georgian",
    "kg": "Kongo", "ki": "Kikuyu", "kj": "Kuanyama",
    "kk": "Kazakh", "kl": "Kalaallisut", "km": "Khmer",
    "kn": "Kannada", "ko": "Korean", "kr": "Kanuri",
    "ks": "Kashmiri", "ku": "Kurdish", "kv": "Komi",
    "kw": "Cornish", "ky": "Kyrgyz", "la": "Latin",
    "lb": "Luxembourgish", "lg": "Ganda", "li": "Limburgish",
    "ln": "Lingala", "lo": "Lao", "lt": "Lithuanian",
    "lu": "Luba-Katanga", "lv": "Latvian", "mg": "Malagasy",
    "mh": "Marshallese", "mi": "M\u0101ori", "mk": "Macedonian",
    "ml": "Malayalam", "mn": "Mongolian", "mo": "Romanian",
    "mr": "Marathi", "ms": "Malay", "mt": "Maltese",
    "my": "Burmese", "na": "Nauru", "nb": "Norwegian Bokm\u00e5l",
    "nd": "North Ndebele", "ne": "Nepali", "ng": "Ndonga",
    "nl": "Dutch", "nn": "Norwegian Nynorsk", "no": "Norwegian",
    "nr": "South Ndebele", "nv": "Navajo", "ny": "Nyanja",
    "oc": "Occitan", "oj": "Ojibwa", "om": "Oromo",
    "or": "Odia", "os": "Ossetic", "pa": "Punjabi",
    "pi": "Pali", "pl": "Polish", "ps": "Pashto",
    "pt": "Portuguese", "qu": "Quechua", "rm": "Romansh",
    "rn": "Rundi", "ro": "Romanian", "ru": "Russian",
    "rw": "Kinyarwanda", "sa": "Sanskrit", "sc": "Sardinian",
    "sd": "Sindhi", "se": "Northern Sami", "sg": "Sango",
    "sh": "Serbian (Latin)", "si": "Sinhala", "sk": "Slovak",
    "sl": "Slovenian", "sm": "Samoan", "sn": "Shona",
    "so": "Somali", "sq": "Albanian", "sr": "Serbian",
    "ss": "Swati", "st": "Southern Sotho", "su": "Sundanese",
    "sv": "Swedish", "sw": "Swahili", "ta": "Tamil",
    "te": "Telugu", "tg": "Tajik", "th": "Thai",
    "ti": "Tigrinya", "tk": "Turkmen", "tl": "Filipino",
    "tn": "Tswana", "to": "Tongan", "tr": "Turkish",
    "ts": "Tsonga", "tt": "Tatar", "tw": "Akan",
    "ty": "Tahitian", "ug": "Uyghur", "uk": "Ukrainian",
    "ur": "Urdu", "uz": "Uzbek", "ve": "Venda",
    "vi": "Vietnamese", "vo": "Volap\u00fck", "wa": "Walloon",
    "wo": "Wolof", "xh": "Xhosa", "yi": "Yiddish",
    "yo": "Yoruba", "za": "Zhuang", "zh": "Chinese",
    "zu": "Zulu",
  };

  class DisplayNames {
    #type;
    #style;
    #fallback;
    #languageDisplay;
    #locale;

    constructor(locales, options) {
      this.#locale = checkLocale(locales, /^en(-[A-Za-z0-9]+)*$/i);
      const given = options === undefined ? { __proto__: null } : Object(options);
      this.#type = choose(given, "type", ["language", "region", "currency"], undefined, "DisplayNames");
      if (this.#type === undefined) throw new TypeError("invalid_argument");
      this.#style = choose(given, "style", ["long", "short", "narrow"], "long", "DisplayNames");
      this.#fallback = choose(given, "fallback", ["code", "none"], "code", "DisplayNames");
      this.#languageDisplay = choose(given, "languageDisplay", ["dialect", "standard"], "dialect", "DisplayNames");
    }

    of(code) {
      const text = builtins.string(code);
      let name;
      if (this.#type === "region") {
        if (!builtins.test(/^(?:[a-z]{2}|\d{3})$/i, text)) throw new RangeError("invalid_argument");
        if (this.#style !== "long" && SHORT_REGION_NAMES[text] !== undefined) name = SHORT_REGION_NAMES[text];
        else name = REGION_NAMES[text];
      } else if (this.#type === "currency") {
        if (!builtins.test(/^[a-z]{3}$/i, text)) throw new RangeError("invalid_argument");
        name = CURRENCY_NAMES[builtins.toUpperCase(text)];
      } else {
        if (!builtins.test(LANGUAGE_TAG, text)) throw new RangeError("invalid_argument");
        if (builtins.indexOf(text, "-") === -1) name = LANGUAGE_NAMES[builtins.toLowerCase(text)];
      }
      if (name !== undefined) return name;
      return this.#fallback === "none" ? undefined : text;
    }

    resolvedOptions() {
      const out = { locale: this.#locale, style: this.#style, type: this.#type, fallback: this.#fallback };
      if (this.#type === "language") out.languageDisplay = this.#languageDisplay;
      return out;
    }
  }

  builtins.defineProperty(DisplayNames.prototype, Symbol.toStringTag, { value: "Intl.DisplayNames", configurable: true });

  // A constructor that Node has refuse a call without new
  function requiresNew(Class, name) {
    const wrapper = function (locales, options) {
      if (new.target === undefined) throw new TypeError("Constructor Intl." + name + " requires 'new'");
      return new Class(locales, options);
    };
    wrapper.prototype = Class.prototype;
    define(Class.prototype, "constructor", wrapper);
    define(wrapper, "name", name);
    return wrapper;
  }

  function titleCase(text) {
    return builtins.toUpperCase(builtins.charAt(text, 0)) + builtins.slice(text, 1);
  }

  // A Unicode extension keeps its attributes sorted and its keywords sorted by
  // key, and a key given twice keeps the value it had first. The other
  // extensions and the private use part are kept as they were written.
  function canonicalExtensions(parts) {
    const groups = [];
    for (const part of parts) {
      if (part.length === 1) builtins.push(groups, [part]);
      else builtins.push(groups[groups.length - 1], part);
    }

    return builtins.flatMap(groups, (group) => (group[0] === "u" ? unicodeExtension(group) : group));
  }

  function unicodeExtension(group) {
    const attributes = [];
    const keywords = [];
    let at = 1;
    while (at < group.length && group[at].length !== 2) builtins.push(attributes, group[at++]);
    while (at < group.length) {
      const key = group[at++];
      const values = [];
      while (at < group.length && group[at].length !== 2) builtins.push(values, group[at++]);
      builtins.push(keywords, [key, values]);
    }

    // A keyword whose value is "true" is written without the value.
    for (const keyword of keywords) {
      if (keyword[1].length === 1 && keyword[1][0] === "true") keyword[1] = [];
    }
    builtins.sort(keywords, (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const unique = builtins.filter(keywords, (keyword) => builtins.findIndex(keywords, (other) => other[0] === keyword[0]) === builtins.indexOfIn(keywords, keyword));

    return ["u", ...builtins.sort([...new Set(attributes)]), ...builtins.flatMap(unique, ([key, values]) => [key, ...values])];
  }

  class Locale {
    #language;
    #script;
    #region;
    #variants;
    #rest;

    constructor(tag, options) {
      if (tag === undefined || builtins.string(tag) === "") {
        throw tag === undefined
          ? new TypeError("First argument to Intl.Locale constructor can't be empty or missing")
          : new RangeError("First argument to Intl.Locale constructor can't be empty or missing");
      }
      const text = builtins.string(tag);
      const singletons = builtins.filter(builtins.split(builtins.split(builtins.toLowerCase(text), "-x-")[0], "-"), (subtag) => subtag.length === 1);
      if (!builtins.test(LANGUAGE_TAG, text) || builtins.some(singletons, (subtag, at) => builtins.indexOfIn(singletons, subtag) !== at)) {
        throw new RangeError("Incorrect locale information provided");
      }
      if (options === null) throw new TypeError("Intl.Locale called on null or undefined");
      const given = options === undefined ? { __proto__: null } : Object(options);

      const parts = builtins.split(builtins.toLowerCase(text), "-");
      let at = 1;
      let script;
      let region;
      if (builtins.test(/^[a-z]{4}$/, parts[at] || "")) script = titleCase(parts[at++]);
      if (builtins.test(/^(?:[a-z]{2}|\d{3})$/, parts[at] || "")) region = builtins.toUpperCase(parts[at++]);
      const variants = [];
      while (at < parts.length && parts[at].length !== 1) builtins.push(variants, parts[at++]);
      const rest = builtins.sliceOf(parts, at);

      this.#language = parts[0];
      this.#script = script;
      this.#region = region;
      this.#variants = builtins.sort(variants);
      this.#rest = canonicalExtensions(rest);
      if (given.language !== undefined) {
        const language = builtins.toLowerCase(builtins.string(given.language));
        if (!builtins.test(/^(?:[a-z]{2,3}|[a-z]{5,8})$/, language)) throw new RangeError("Incorrect locale information provided");
        this.#language = language;
      }
      if (given.script !== undefined) {
        if (!builtins.test(/^[a-z]{4}$/i, builtins.string(given.script))) throw new RangeError("Incorrect locale information provided");
        this.#script = titleCase(builtins.toLowerCase(builtins.string(given.script)));
      }
      if (given.region !== undefined) {
        if (!builtins.test(/^(?:[a-z]{2}|\d{3})$/i, builtins.string(given.region))) throw new RangeError("Incorrect locale information provided");
        this.#region = builtins.toUpperCase(builtins.string(given.region));
      }
    }

    get language() {
      return this.#language;
    }

    get script() {
      return this.#script;
    }

    get region() {
      return this.#region;
    }

    get baseName() {
      return builtins.join(this.#baseParts(), "-");
    }

    toString() {
      return builtins.join(builtins.concat(this.#baseParts(), this.#rest), "-");
    }

    #baseParts() {
      const parts = [this.#language];
      if (this.#script !== undefined) builtins.push(parts, this.#script);
      if (this.#region !== undefined) builtins.push(parts, this.#region);
      return builtins.concat(parts, this.#variants);
    }
  }

  builtins.defineProperty(Locale.prototype, Symbol.toStringTag, { value: "Intl.Locale", configurable: true });

  // What Intl.supportedValuesOf lists, as Node 26.13 lists it
  const SUPPORTED_VALUES = {
    calendar: [
        "buddhist", "chinese", "coptic", "dangi", "ethioaa", "ethiopic", "gregory", "hebrew", "indian",
        "islamic", "islamic-civil", "islamic-rgsa", "islamic-tbla", "islamic-umalqura", "iso8601",
        "japanese", "persian", "roc",
    ],
    collation: [
        "compat", "dict", "emoji", "eor", "phonebk", "phonetic", "pinyin", "searchjl", "stroke", "trad",
        "unihan", "zhuyin",
    ],
    currency: [
        "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN", "BAM", "BBD", "BDT", "BGN",
        "BHD", "BIF", "BMD", "BND", "BOB", "BRL", "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHF",
        "CLP", "CNY", "COP", "CRC", "CUC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP", "ERN",
        "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS", "GIP", "GMD", "GNF", "GTQ", "GYD", "HKD", "HNL",
        "HRK", "HTG", "HUF", "IDR", "ILS", "INR", "IQD", "IRR", "ISK", "JMD", "JOD", "JPY", "KES", "KGS",
        "KHR", "KMF", "KPW", "KRW", "KWD", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "LYD", "MAD",
        "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR", "MWK", "MXN", "MYR", "MZN", "NAD",
        "NGN", "NIO", "NOK", "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR",
        "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SHP", "SLE", "SLL", "SOS",
        "SRD", "SSP", "STN", "SVC", "SYP", "SZL", "THB", "TJS", "TMT", "TND", "TOP", "TRY", "TTD", "TWD",
        "TZS", "UAH", "UGX", "USD", "UYU", "UZS", "VES", "VND", "VUV", "WST", "XAF", "XCD", "XCG", "XDR",
        "XOF", "XPF", "XSU", "YER", "ZAR", "ZMW", "ZWG", "ZWL",
    ],
    numberingSystem: [
        "adlm", "ahom", "arab", "arabext", "bali", "beng", "bhks", "brah", "cakm", "cham", "deva", "diak",
        "fullwide", "gara", "gong", "gonm", "gujr", "gukh", "guru", "hanidec", "hmng", "hmnp", "java",
        "kali", "kawi", "khmr", "knda", "krai", "lana", "lanatham", "laoo", "latn", "lepc", "limb",
        "mathbold", "mathdbl", "mathmono", "mathsanb", "mathsans", "mlym", "modi", "mong", "mroo", "mtei",
        "mymr", "mymrepka", "mymrpao", "mymrshan", "mymrtlng", "nagm", "newa", "nkoo", "olck", "onao",
        "orya", "osma", "outlined", "rohg", "saur", "segment", "shrd", "sind", "sinh", "sora", "sund",
        "sunu", "takr", "talu", "tamldec", "telu", "thai", "tibt", "tirh", "tnsa", "tols", "vaii", "wara",
        "wcho",
    ],
    timeZone: [
        "Africa/Abidjan", "Africa/Accra", "Africa/Addis_Ababa", "Africa/Algiers", "Africa/Asmera",
        "Africa/Bamako", "Africa/Bangui", "Africa/Banjul", "Africa/Bissau", "Africa/Blantyre",
        "Africa/Brazzaville", "Africa/Bujumbura", "Africa/Cairo", "Africa/Casablanca", "Africa/Ceuta",
        "Africa/Conakry", "Africa/Dakar", "Africa/Dar_es_Salaam", "Africa/Djibouti", "Africa/Douala",
        "Africa/El_Aaiun", "Africa/Freetown", "Africa/Gaborone", "Africa/Harare", "Africa/Johannesburg",
        "Africa/Juba", "Africa/Kampala", "Africa/Khartoum", "Africa/Kigali", "Africa/Kinshasa",
        "Africa/Lagos", "Africa/Libreville", "Africa/Lome", "Africa/Luanda", "Africa/Lubumbashi",
        "Africa/Lusaka", "Africa/Malabo", "Africa/Maputo", "Africa/Maseru", "Africa/Mbabane",
        "Africa/Mogadishu", "Africa/Monrovia", "Africa/Nairobi", "Africa/Ndjamena", "Africa/Niamey",
        "Africa/Nouakchott", "Africa/Ouagadougou", "Africa/Porto-Novo", "Africa/Sao_Tome", "Africa/Tripoli",
        "Africa/Tunis", "Africa/Windhoek", "America/Adak", "America/Anchorage", "America/Anguilla",
        "America/Antigua", "America/Araguaina", "America/Argentina/La_Rioja",
        "America/Argentina/Rio_Gallegos", "America/Argentina/Salta", "America/Argentina/San_Juan",
        "America/Argentina/San_Luis", "America/Argentina/Tucuman", "America/Argentina/Ushuaia",
        "America/Aruba", "America/Asuncion", "America/Bahia", "America/Bahia_Banderas", "America/Barbados",
        "America/Belem", "America/Belize", "America/Blanc-Sablon", "America/Boa_Vista", "America/Bogota",
        "America/Boise", "America/Buenos_Aires", "America/Cambridge_Bay", "America/Campo_Grande",
        "America/Cancun", "America/Caracas", "America/Catamarca", "America/Cayenne", "America/Cayman",
        "America/Chicago", "America/Chihuahua", "America/Ciudad_Juarez", "America/Coral_Harbour",
        "America/Cordoba", "America/Costa_Rica", "America/Coyhaique", "America/Creston", "America/Cuiaba",
        "America/Curacao", "America/Danmarkshavn", "America/Dawson", "America/Dawson_Creek",
        "America/Denver", "America/Detroit", "America/Dominica", "America/Edmonton", "America/Eirunepe",
        "America/El_Salvador", "America/Fort_Nelson", "America/Fortaleza", "America/Glace_Bay",
        "America/Godthab", "America/Goose_Bay", "America/Grand_Turk", "America/Grenada",
        "America/Guadeloupe", "America/Guatemala", "America/Guayaquil", "America/Guyana", "America/Halifax",
        "America/Havana", "America/Hermosillo", "America/Indiana/Knox", "America/Indiana/Marengo",
        "America/Indiana/Petersburg", "America/Indiana/Tell_City", "America/Indiana/Vevay",
        "America/Indiana/Vincennes", "America/Indiana/Winamac", "America/Indianapolis", "America/Inuvik",
        "America/Iqaluit", "America/Jamaica", "America/Jujuy", "America/Juneau",
        "America/Kentucky/Monticello", "America/Kralendijk", "America/La_Paz", "America/Lima",
        "America/Los_Angeles", "America/Louisville", "America/Lower_Princes", "America/Maceio",
        "America/Managua", "America/Manaus", "America/Marigot", "America/Martinique", "America/Matamoros",
        "America/Mazatlan", "America/Mendoza", "America/Menominee", "America/Merida", "America/Metlakatla",
        "America/Mexico_City", "America/Miquelon", "America/Moncton", "America/Monterrey",
        "America/Montevideo", "America/Montserrat", "America/Nassau", "America/New_York", "America/Nome",
        "America/Noronha", "America/North_Dakota/Beulah", "America/North_Dakota/Center",
        "America/North_Dakota/New_Salem", "America/Ojinaga", "America/Panama", "America/Paramaribo",
        "America/Phoenix", "America/Port-au-Prince", "America/Port_of_Spain", "America/Porto_Velho",
        "America/Puerto_Rico", "America/Punta_Arenas", "America/Rankin_Inlet", "America/Recife",
        "America/Regina", "America/Resolute", "America/Rio_Branco", "America/Santarem", "America/Santiago",
        "America/Santo_Domingo", "America/Sao_Paulo", "America/Scoresbysund", "America/Sitka",
        "America/St_Barthelemy", "America/St_Johns", "America/St_Kitts", "America/St_Lucia",
        "America/St_Thomas", "America/St_Vincent", "America/Swift_Current", "America/Tegucigalpa",
        "America/Thule", "America/Tijuana", "America/Toronto", "America/Tortola", "America/Vancouver",
        "America/Whitehorse", "America/Winnipeg", "America/Yakutat", "Antarctica/Casey", "Antarctica/Davis",
        "Antarctica/DumontDUrville", "Antarctica/Macquarie", "Antarctica/Mawson", "Antarctica/McMurdo",
        "Antarctica/Palmer", "Antarctica/Rothera", "Antarctica/Syowa", "Antarctica/Troll",
        "Antarctica/Vostok", "Arctic/Longyearbyen", "Asia/Aden", "Asia/Almaty", "Asia/Amman", "Asia/Anadyr",
        "Asia/Aqtau", "Asia/Aqtobe", "Asia/Ashgabat", "Asia/Atyrau", "Asia/Baghdad", "Asia/Bahrain",
        "Asia/Baku", "Asia/Bangkok", "Asia/Barnaul", "Asia/Beirut", "Asia/Bishkek", "Asia/Brunei",
        "Asia/Calcutta", "Asia/Chita", "Asia/Colombo", "Asia/Damascus", "Asia/Dhaka", "Asia/Dili",
        "Asia/Dubai", "Asia/Dushanbe", "Asia/Famagusta", "Asia/Gaza", "Asia/Hebron", "Asia/Hong_Kong",
        "Asia/Hovd", "Asia/Irkutsk", "Asia/Jakarta", "Asia/Jayapura", "Asia/Jerusalem", "Asia/Kabul",
        "Asia/Kamchatka", "Asia/Karachi", "Asia/Katmandu", "Asia/Khandyga", "Asia/Krasnoyarsk",
        "Asia/Kuala_Lumpur", "Asia/Kuching", "Asia/Kuwait", "Asia/Macau", "Asia/Magadan", "Asia/Makassar",
        "Asia/Manila", "Asia/Muscat", "Asia/Nicosia", "Asia/Novokuznetsk", "Asia/Novosibirsk", "Asia/Omsk",
        "Asia/Oral", "Asia/Phnom_Penh", "Asia/Pontianak", "Asia/Pyongyang", "Asia/Qatar", "Asia/Qostanay",
        "Asia/Qyzylorda", "Asia/Rangoon", "Asia/Riyadh", "Asia/Saigon", "Asia/Sakhalin", "Asia/Samarkand",
        "Asia/Seoul", "Asia/Shanghai", "Asia/Singapore", "Asia/Srednekolymsk", "Asia/Taipei",
        "Asia/Tashkent", "Asia/Tbilisi", "Asia/Tehran", "Asia/Thimphu", "Asia/Tokyo", "Asia/Tomsk",
        "Asia/Ulaanbaatar", "Asia/Urumqi", "Asia/Ust-Nera", "Asia/Vientiane", "Asia/Vladivostok",
        "Asia/Yakutsk", "Asia/Yekaterinburg", "Asia/Yerevan", "Atlantic/Azores", "Atlantic/Bermuda",
        "Atlantic/Canary", "Atlantic/Cape_Verde", "Atlantic/Faeroe", "Atlantic/Madeira",
        "Atlantic/Reykjavik", "Atlantic/South_Georgia", "Atlantic/St_Helena", "Atlantic/Stanley",
        "Australia/Adelaide", "Australia/Brisbane", "Australia/Broken_Hill", "Australia/Darwin",
        "Australia/Eucla", "Australia/Hobart", "Australia/Lindeman", "Australia/Lord_Howe",
        "Australia/Melbourne", "Australia/Perth", "Australia/Sydney", "Europe/Amsterdam", "Europe/Andorra",
        "Europe/Astrakhan", "Europe/Athens", "Europe/Belgrade", "Europe/Berlin", "Europe/Bratislava",
        "Europe/Brussels", "Europe/Bucharest", "Europe/Budapest", "Europe/Busingen", "Europe/Chisinau",
        "Europe/Copenhagen", "Europe/Dublin", "Europe/Gibraltar", "Europe/Guernsey", "Europe/Helsinki",
        "Europe/Isle_of_Man", "Europe/Istanbul", "Europe/Jersey", "Europe/Kaliningrad", "Europe/Kiev",
        "Europe/Kirov", "Europe/Lisbon", "Europe/Ljubljana", "Europe/London", "Europe/Luxembourg",
        "Europe/Madrid", "Europe/Malta", "Europe/Mariehamn", "Europe/Minsk", "Europe/Monaco",
        "Europe/Moscow", "Europe/Oslo", "Europe/Paris", "Europe/Podgorica", "Europe/Prague", "Europe/Riga",
        "Europe/Rome", "Europe/Samara", "Europe/San_Marino", "Europe/Sarajevo", "Europe/Saratov",
        "Europe/Simferopol", "Europe/Skopje", "Europe/Sofia", "Europe/Stockholm", "Europe/Tallinn",
        "Europe/Tirane", "Europe/Ulyanovsk", "Europe/Vaduz", "Europe/Vatican", "Europe/Vienna",
        "Europe/Vilnius", "Europe/Volgograd", "Europe/Warsaw", "Europe/Zagreb", "Europe/Zurich",
        "Indian/Antananarivo", "Indian/Chagos", "Indian/Christmas", "Indian/Cocos", "Indian/Comoro",
        "Indian/Kerguelen", "Indian/Mahe", "Indian/Maldives", "Indian/Mauritius", "Indian/Mayotte",
        "Indian/Reunion", "Pacific/Apia", "Pacific/Auckland", "Pacific/Bougainville", "Pacific/Chatham",
        "Pacific/Easter", "Pacific/Efate", "Pacific/Enderbury", "Pacific/Fakaofo", "Pacific/Fiji",
        "Pacific/Funafuti", "Pacific/Galapagos", "Pacific/Gambier", "Pacific/Guadalcanal", "Pacific/Guam",
        "Pacific/Honolulu", "Pacific/Kiritimati", "Pacific/Kosrae", "Pacific/Kwajalein", "Pacific/Majuro",
        "Pacific/Marquesas", "Pacific/Midway", "Pacific/Nauru", "Pacific/Niue", "Pacific/Norfolk",
        "Pacific/Noumea", "Pacific/Pago_Pago", "Pacific/Palau", "Pacific/Pitcairn", "Pacific/Ponape",
        "Pacific/Port_Moresby", "Pacific/Rarotonga", "Pacific/Saipan", "Pacific/Tahiti", "Pacific/Tarawa",
        "Pacific/Tongatapu", "Pacific/Truk", "Pacific/Wake", "Pacific/Wallis",
    ],
    unit: [
        "acre", "bit", "byte", "celsius", "centimeter", "day", "degree", "fahrenheit", "fluid-ounce", "foot",
        "gallon", "gigabit", "gigabyte", "gram", "hectare", "hour", "inch", "kilobit", "kilobyte",
        "kilogram", "kilometer", "liter", "megabit", "megabyte", "meter", "microsecond", "mile",
        "mile-scandinavian", "milliliter", "millimeter", "millisecond", "minute", "month", "nanosecond",
        "ounce", "percent", "petabyte", "pound", "second", "stone", "terabit", "terabyte", "week", "yard",
        "year",
    ],
  };

  function supportedValuesOf(key) {
    const name = builtins.string(key);
    if (!builtins.hasOwn(SUPPORTED_VALUES, name)) throw new RangeError("Invalid key : " + name);
    return builtins.sliceOf(SUPPORTED_VALUES[name]);
  }

  function canonicalTag(text) {
    const singletons = builtins.filter(builtins.split(builtins.split(builtins.toLowerCase(text), "-x-")[0], "-"), (subtag) => subtag.length === 1);
    if (!builtins.test(LANGUAGE_TAG, text) || builtins.some(singletons, (subtag, at) => builtins.indexOfIn(singletons, subtag) !== at)) {
      throw new RangeError("Invalid language tag: " + text);
    }
    return new Locale(text).toString();
  }

  // Each tag of the list in the form Intl.Locale writes it, and a tag given twice once.
  function getCanonicalLocales(locales) {
    if (locales === null) throw new TypeError("Cannot convert undefined or null to object");
    if (locales === undefined) return [];
    const list = typeof locales === "string" || locales instanceof Locale ? [locales] : Object(locales);

    const found = new Set();
    const length = builtins.number(list.length) || 0;
    for (let i = 0; i < length; i++) {
      if (!(i in list)) continue;
      const item = list[i];
      if (item === null || (typeof item !== "string" && typeof item !== "object" && typeof item !== "function")) {
        throw new TypeError("Language ID should be string or object.");
      }
      builtins.setAdd(found, canonicalTag(builtins.string(item)));
    }

    return [...found];
  }

  const Intl = {};
  define(Intl, "NumberFormat", callable(NumberFormat));
  define(Intl, "Collator", callable(Collator));
  define(Intl, "DateTimeFormat", callable(DateTimeFormat));
  define(Intl, "PluralRules", PluralRules);
  define(Intl, "ListFormat", ListFormat);
  define(Intl, "RelativeTimeFormat", RelativeTimeFormat);
  define(Intl, "Segmenter", Segmenter);
  define(Intl, "DisplayNames", requiresNew(DisplayNames, "DisplayNames"));
  define(Intl, "Locale", requiresNew(Locale, "Locale"));
  define(Intl, "supportedValuesOf", supportedValuesOf);
  define(Intl, "getCanonicalLocales", getCanonicalLocales);
  builtins.defineProperty(Intl, Symbol.toStringTag, { value: "Intl", configurable: true });

  return { Intl };
})
