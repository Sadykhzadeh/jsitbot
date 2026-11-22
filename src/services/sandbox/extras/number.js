// Number.prototype.toLocaleString and BigInt.prototype.toLocaleString, for the
// guest. The engine has no number formatting of its own: it answered
// (1234567.891).toLocaleString() with "1234567.891" and ignored every option.
// Evaluated the first time one of them is called; see lazyMethod in guest.js.
//
// Formats the way English does (a comma between thousands, a point before the
// decimals) for the style decimal, percent and currency, with the options
// minimumIntegerDigits, minimumFractionDigits, maximumFractionDigits,
// minimumSignificantDigits, maximumSignificantDigits, useGrouping, signDisplay
// and notation "compact" (with compactDisplay), "scientific" and "engineering",
// and for currencies currencyDisplay "symbol", "narrowSymbol", "code" and "name"
// (the name for the currencies CURRENCY_NAMES lists, the code for any other) and
// currencySign. The
// number is rounded on the digits it is written with, half away from zero by
// default, so 1.005 gives 1.01, and the roundingMode option picks another rule.
// For the style unit, the units are the ones Intl.supportedValuesOf lists for
// units and the three per units that are most used, in the short, narrow and long
// forms of English.
// Anything else, another language or an option that is not listed, is left to
// the engine's own method, which is the `original` it is given, together with
// the prototype it belongs to.
(function (original, owner, zoneInfo, builtins) {
  "use strict";

  const ENGLISH = /^en(-(US|GB|AU|CA|NZ|IE))?$/i;

  // The grammar of a language tag, as the engine reads it, with no singleton given twice.
  // Node refuses a tag that fails either check with "Invalid language tag".
  const LANGUAGE_TAG = /^(?:[a-z]{2,3}|[a-z]{5,8})(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?(?:-(?:[a-z\d]{5,8}|\d[a-z\d]{3}))*(?:-[\da-wy-z](?:-[a-z\d]{2,8})+)*(?:-x(?:-[a-z\d]{1,8})+)?$/i;

  function checkLocales(locales) {
    const tags = builtins.isArray(locales) ? locales : [locales];
    for (let i = 0; i < tags.length; i++) {
      if (tags[i] === undefined) continue;
      const tag = builtins.string(tags[i]);
      const singletons = builtins.filter(builtins.split(builtins.split(builtins.toLowerCase(tag), "-x-")[0], "-"), (subtag) => subtag.length === 1);
      if (!builtins.test(LANGUAGE_TAG, tag) || new Set(singletons).size !== singletons.length) {
        throw new RangeError("Invalid language tag: " + tag);
      }
    }
  }
  const SYMBOLS = {
    USD: "$", EUR: "€", GBP: "£", JPY: "¥", INR: "₹", KRW: "₩", CNY: "CN¥", CAD: "CA$", AUD: "A$",
    BRL: "R$", HKD: "HK$", ILS: "₪", MXN: "MX$", NZD: "NZ$", PHP: "₱", TWD: "NT$", VND: "₫",
    XAF: "FCFA", XCD: "EC$", XCG: "Cg.", XOF: "F\u202fCFA", XPF: "CFPF",
  };
  const NARROW_SYMBOLS = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", INR: "₹", KRW: "₩", CNY: "¥", CAD: "$", AUD: "$" };
  // The name of each currency in NARROW_SYMBOLS: singular, then plural, as English writes it.
  const CURRENCY_NAMES = {
    USD: ["US dollar", "US dollars"],
    EUR: ["euro", "euros"],
    GBP: ["British pound", "British pounds"],
    JPY: ["Japanese yen", "Japanese yen"],
    INR: ["Indian rupee", "Indian rupees"],
    KRW: ["South Korean won", "South Korean won"],
    CNY: ["Chinese yuan", "Chinese yuan"],
    CAD: ["Canadian dollar", "Canadian dollars"],
    AUD: ["Australian dollar", "Australian dollars"],
  };
  // The currencies whose amounts have no minor unit, and the three-digit ones, as Node's ICU data has them.
  const WHOLE_CURRENCIES = ["AFN", "ALL", "BIF", "CLP", "COP", "DJF", "GNF", "HUF", "IDR", "IQD", "IRR", "ISK", "JPY", "KMF", "KPW", "KRW", "LAK", "LBP", "MGA", "MMK", "PKR", "PYG", "RWF", "SLL", "SOS", "SYP", "UGX", "VND", "VUV", "XAF", "XOF", "XPF", "YER"];
  const THREE_DIGIT_CURRENCIES = ["BHD", "JOD", "KWD", "LYD", "OMR", "TND"];
  // What follows the number in each unit: the short form for one and for more,
  // the narrow form, and the long form for one and for more.
  const UNITS = {
    "acre": [" ac", " ac", "ac", " acre", " acres"],
    "bit": [" bit", " bit", "bit", " bit", " bits"],
    "byte": [" byte", " byte", "B", " byte", " bytes"],
    "celsius": ["°C", "°C", "°C", " degree Celsius", " degrees Celsius"],
    "centimeter": [" cm", " cm", "cm", " centimeter", " centimeters"],
    "day": [" day", " days", "d", " day", " days"],
    "degree": [" deg", " deg", "°", " degree", " degrees"],
    "fahrenheit": ["°F", "°F", "°", " degree Fahrenheit", " degrees Fahrenheit"],
    "fluid-ounce": [" fl oz", " fl oz", "fl oz", " fluid ounce", " fluid ounces"],
    "foot": [" ft", " ft", "′", " foot", " feet"],
    "gallon": [" gal", " gal", "gal", " gallon", " gallons"],
    "gigabit": [" Gb", " Gb", "Gb", " gigabit", " gigabits"],
    "gigabyte": [" GB", " GB", "GB", " gigabyte", " gigabytes"],
    "gram": [" g", " g", "g", " gram", " grams"],
    "hectare": [" ha", " ha", "ha", " hectare", " hectares"],
    "hour": [" hr", " hr", "h", " hour", " hours"],
    "inch": [" in", " in", "″", " inch", " inches"],
    "kilobit": [" kb", " kb", "kb", " kilobit", " kilobits"],
    "kilobyte": [" kB", " kB", "kB", " kilobyte", " kilobytes"],
    "kilogram": [" kg", " kg", "kg", " kilogram", " kilograms"],
    "kilometer": [" km", " km", "km", " kilometer", " kilometers"],
    "liter": [" L", " L", "L", " liter", " liters"],
    "megabit": [" Mb", " Mb", "Mb", " megabit", " megabits"],
    "megabyte": [" MB", " MB", "MB", " megabyte", " megabytes"],
    "meter": [" m", " m", "m", " meter", " meters"],
    "microsecond": [" μs", " μs", "μs", " microsecond", " microseconds"],
    "mile": [" mi", " mi", "mi", " mile", " miles"],
    "mile-scandinavian": [" smi", " smi", "smi", " mile-scandinavian", " miles-scandinavian"],
    "milliliter": [" mL", " mL", "mL", " milliliter", " milliliters"],
    "millimeter": [" mm", " mm", "mm", " millimeter", " millimeters"],
    "millisecond": [" ms", " ms", "ms", " millisecond", " milliseconds"],
    "minute": [" min", " min", "m", " minute", " minutes"],
    "month": [" mth", " mths", "m", " month", " months"],
    "nanosecond": [" ns", " ns", "ns", " nanosecond", " nanoseconds"],
    "ounce": [" oz", " oz", "oz", " ounce", " ounces"],
    "percent": ["%", "%", "%", " percent", " percent"],
    "petabyte": [" PB", " PB", "PB", " petabyte", " petabytes"],
    "pound": [" lb", " lb", "#", " pound", " pounds"],
    "second": [" sec", " sec", "s", " second", " seconds"],
    "stone": [" st", " st", "st", " stone", " stones"],
    "terabit": [" Tb", " Tb", "Tb", " terabit", " terabits"],
    "terabyte": [" TB", " TB", "TB", " terabyte", " terabytes"],
    "week": [" wk", " wks", "w", " week", " weeks"],
    "yard": [" yd", " yd", "yd", " yard", " yards"],
    "year": [" yr", " yrs", "y", " year", " years"],
    "kilometer-per-hour": [" km/h", " km/h", "km/h", " kilometer per hour", " kilometers per hour"],
    "mile-per-hour": [" mph", " mph", "mph", " mile per hour", " miles per hour"],
    "meter-per-second": [" m/s", " m/s", "m/s", " meter per second", " meters per second"],
  };
  const UNIT_DISPLAYS = ["short", "narrow", "long"];
  // The values an option of a number format takes, as Node 26 reads them. Any other
  // value is refused, whatever the locale, and a currency is a code of three letters.
  const OPTION_VALUES = {
    style: ["decimal", "percent", "currency", "unit"],
    currencyDisplay: ["code", "symbol", "narrowSymbol", "name"],
    currencySign: ["standard", "accounting"],
    unitDisplay: UNIT_DISPLAYS,
    notation: ["standard", "scientific", "engineering", "compact"],
    compactDisplay: ["short", "long"],
    signDisplay: ["auto", "never", "always", "exceptZero", "negative"],
    roundingMode: ["ceil", "floor", "expand", "trunc", "halfCeil", "halfFloor", "halfExpand", "halfTrunc", "halfEven"],
    trailingZeroDisplay: ["auto", "stripIfInteger"],
    roundingPriority: ["auto", "morePrecision", "lessPrecision"],
  };
  const UNSUPPORTED = ["roundingIncrement"];
  const SHORT_UNITS = ["", "K", "M", "B", "T"];
  const LONG_UNITS = ["", " thousand", " million", " billion", " trillion"];

  function digitsOption(options, name, fallback, lowest, highest) {
    const given = options[name];
    if (given === undefined) return fallback;
    const number = builtins.number(given);
    if (!(number >= lowest && number <= highest)) throw new RangeError(name + " value is out of range.");
    return builtins.floor(number);
  }

  // One more at the last digit of a string of digits.
  function increment(digits) {
    let i = digits.length - 1;
    while (i >= 0 && digits[i] === "9") i--;
    if (i < 0) return "1" + builtins.repeat("0", digits.length);
    return builtins.slice(digits, 0, i) + builtins.fromCharCode(builtins.charCodeAt(digits, i) + 1) + builtins.repeat("0", digits.length - 1 - i);
  }

  // The digits of a non-negative finite number as it is written, moved
  // `shift` places to the left.
  function split(value, shift) {
    const parts = builtins.split(builtins.string(value), "e");
    const written = builtins.split(parts[0], ".");
    const whole = written[0];
    let digits = whole + (written[1] || "");
    let point = whole.length + (builtins.number(parts[1]) || 0) + shift;

    if (point < 0) {
      digits = builtins.repeat("0", -point) + digits;
      point = 0;
    } else if (point > digits.length) {
      digits += builtins.repeat("0", point - digits.length);
    }
    return { whole: builtins.slice(digits, 0, point), fraction: builtins.slice(digits, point) };
  }

  // Whether the digits kept by a rounding step take one more, given the digits it
  // drops, for the rounding mode the options name and a number that is negative or not.
  function roundingRule(mode, negative) {
    return function (kept, dropped) {
      const first = dropped[0];
      const beyondHalf = builtins.test(/[1-9]/, builtins.slice(dropped, 1));
      const above = first > "5" || (first === "5" && beyondHalf);
      const half = first === "5" && !beyondHalf;
      const any = builtins.test(/[1-9]/, dropped);
      const odd = builtins.number(builtins.slice(kept, -1)) % 2 === 1;
      switch (mode) {
        case "ceil":
          return any && !negative;
        case "floor":
          return any && negative;
        case "expand":
          return any;
        case "trunc":
          return false;
        case "halfCeil":
          return above || (half && !negative);
        case "halfFloor":
          return above || (half && negative);
        case "halfTrunc":
          return above;
        case "halfEven":
          return above || (half && odd);
        default:
          return first >= "5";
      }
    };
  }

  // Keeps `places` digits after the point, rounding by `rule` on the digits; a
  // negative number of places rounds to tens, hundreds and so on.
  function roundAt(parts, places, rule) {
    if (places >= parts.fraction.length) return parts;

    const all = parts.whole + parts.fraction;
    const cut = parts.whole.length + places;
    let kept = cut > 0 ? builtins.slice(all, 0, cut) : "";
    const dropped = cut >= 0 ? builtins.slice(all, cut) : builtins.repeat("0", -cut) + all;
    if (rule(kept, dropped)) kept = increment(kept);
    if (kept === "") kept = "0";

    if (places >= 0) {
      kept = builtins.repeat("0", builtins.max(0, places + 1 - kept.length)) + kept;
      return { whole: builtins.slice(kept, 0, kept.length - places), fraction: builtins.slice(kept, kept.length - places) };
    }
    return { whole: kept === "0" ? "0" : kept + builtins.repeat("0", -places), fraction: "" };
  }

  // How many digits a number is written with, not counting the zeros in front.
  function significant(parts) {
    const whole = builtins.replace(parts.whole, /^0+/, "");
    return whole === "" ? builtins.replace(parts.fraction, /^0+/, "").length : whole.length + parts.fraction.length;
  }

  // Rounds to at most `maximum` significant digits and writes at least `minimum`.
  function roundSignificant(parts, minimum, maximum, rule) {
    const whole = builtins.replace(parts.whole, /^0+/, "");
    let places;
    if (whole !== "") {
      places = maximum - whole.length;
    } else {
      const zeros = parts.fraction.length - builtins.replace(parts.fraction, /^0+/, "").length;
      places = zeros === parts.fraction.length ? 0 : zeros + maximum;
    }

    const rounded = roundAt(parts, places, rule);
    let fraction = rounded.fraction;
    let count = significant(rounded);
    if (count === 0) {
      count = 1;
      if (minimum > 1) fraction = builtins.repeat("0", minimum - 1);
    } else {
      while (count > minimum && fraction[fraction.length - 1] === "0") {
        fraction = builtins.slice(fraction, 0, -1);
        count--;
      }
      if (count < minimum) fraction += builtins.repeat("0", minimum - count);
    }
    return { whole: rounded.whole, fraction };
  }

  function group(whole) {
    let out = "";
    for (let i = 0; i < whole.length; i++) {
      if (i > 0 && (whole.length - i) % 3 === 0) out += ",";
      out += whole[i];
    }
    return out;
  }

  // The power of ten a number is written with in scientific notation, or the
  // nearest multiple of three below it in engineering notation.
  function exponentOf(parts, engineering) {
    const whole = builtins.replace(parts.whole, /^0+/, "");
    let exponent = 0;
    if (whole !== "") exponent = whole.length - 1;
    else if (builtins.test(/[1-9]/, parts.fraction)) exponent = -(parts.fraction.length - builtins.replace(parts.fraction, /^0+/, "").length + 1);
    return engineering ? builtins.floor(exponent / 3) * 3 : exponent;
  }

  // The digits of a number, rounded and grouped as the options say. A compact
  // number is written as a smaller number with a word or a letter after it, and
  // one in scientific or engineering notation as a smaller number and a power
  // of ten.
  function digits(magnitude, negative, style, options, defaultMin, defaultMax, compact, notation) {
    let minimum = digitsOption(options, "minimumFractionDigits", undefined, 0, 100);
    let maximum = digitsOption(options, "maximumFractionDigits", undefined, 0, 100);
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      throw new RangeError("maximumFractionDigits value is out of range.");
    }
    const fractionGiven = minimum !== undefined || maximum !== undefined;
    if (minimum === undefined) minimum = maximum === undefined ? defaultMin : builtins.min(defaultMin, maximum);
    if (maximum === undefined) maximum = builtins.max(defaultMax, minimum);
    const integers = digitsOption(options, "minimumIntegerDigits", 1, 1, 21);

    let leastSignificant = digitsOption(options, "minimumSignificantDigits", undefined, 1, 21);
    let mostSignificant = digitsOption(options, "maximumSignificantDigits", undefined, 1, 21);
    const bySignificant = leastSignificant !== undefined || mostSignificant !== undefined;
    if (leastSignificant === undefined) leastSignificant = 1;
    if (mostSignificant === undefined) mostSignificant = 21;
    if (leastSignificant > mostSignificant) throw new RangeError("maximumSignificantDigits value is out of range.");

    const shift = style === "percent" ? 2 : 0;
    const rule = roundingRule(options.roundingMode, negative);
    const priority = options.roundingPriority === undefined ? "auto" : builtins.string(options.roundingPriority);
    const compactRounding = compact && !fractionGiven && priority === "auto";
    // With morePrecision or lessPrecision, the rounding that keeps the finer
    // digits wins (the significant one on a tie for morePrecision, the fraction one for lessPrecision).
    const round = function (parts) {
      const finer = exponentOf(parts, false) - mostSignificant + 1 <= -maximum;
      const significant = priority === "auto" ? bySignificant : (priority === "morePrecision") === finer;
      if (significant) return { ...roundSignificant(parts, leastSignificant, mostSignificant, rule), significant };
      if (compactRounding) {
        return builtins.replace(parts.whole, /^0+/, "").length >= 2 ? roundAt(parts, 0, rule) : roundSignificant(parts, 1, 2, rule);
      }
      return roundAt(parts, maximum, rule);
    };

    let parts = split(magnitude, shift);
    let exponent = 0;
    const engineering = notation === "engineering";
    if (notation === "scientific" || engineering) {
      exponent = exponentOf(parts, engineering);
      for (;;) {
        parts = round(split(magnitude, shift - exponent));
        const mantissa = builtins.replace(parts.whole, /^0+/, "").length;
        if (mantissa <= (engineering ? 3 : 1)) break;
        exponent = engineering ? exponent + 3 : exponent + 1;
      }
    } else if (compact) {
      const length = builtins.replace(parts.whole, /^0+/, "").length;
      exponent = length > 3 ? builtins.min(builtins.floor((length - 1) / 3), 4) : 0;
      for (;;) {
        parts = round(exponent === 0 ? split(magnitude, shift) : split(magnitude, shift - exponent * 3));
        if (builtins.replace(parts.whole, /^0+/, "").length <= 3 || exponent === 4) break;
        exponent++;
      }
    } else {
      parts = round(parts);
    }

    let whole = builtins.replace(parts.whole, /^0+/, "");
    let fraction = parts.fraction;
    if (!parts.significant && !compactRounding) {
      while (fraction.length > minimum && fraction[fraction.length - 1] === "0") fraction = builtins.slice(fraction, 0, -1);
      if (fraction.length < minimum) fraction += builtins.repeat("0", minimum - fraction.length);
    }
    // A number that is whole once rounded loses its fraction zeros too when asked to.
    if (options.trailingZeroDisplay === "stripIfInteger" && !builtins.test(/[1-9]/, fraction)) fraction = "";
    if (whole.length < integers) whole = builtins.repeat("0", integers - whole.length) + whole;

    const grouping = groupingOf(options.useGrouping);
    // A compact number is only grouped when there are five digits to group, unless it is asked to always be.
    // With min2 a number is grouped from five digits, as a group of one digit at the front is not written.
    const short = compact && whole.length < 5 && grouping !== "always";
    const text = grouping === false || short || (grouping === "min2" && whole.length < 5) ? whole : group(whole);
    const written = fraction === "" ? text : text + "." + fraction;
    if (notation === "scientific" || engineering) return written + "E" + exponent;
    return compact ? written + (options.compactDisplay === "long" && style !== "currency" ? LONG_UNITS : SHORT_UNITS)[exponent] : written;
  }

  // The sign in front of a number, as signDisplay asks for it. A number that is
  // written as zero counts as zero, whatever it was before it was rounded.
  function signOf(negative, text, options) {
    const mode = options.signDisplay === undefined ? "auto" : builtins.string(options.signDisplay);
    const zero = !builtins.test(/[1-9∞N]/, text);
    switch (mode) {
      case "auto":
        return negative ? "-" : "";
      case "always":
        return negative ? "-" : "+";
      case "exceptZero":
        return zero || text === "NaN" ? "" : negative ? "-" : "+";
      case "negative":
        return negative && !zero ? "-" : "";
      case "never":
        return "";
    }
    throw new RangeError("Value " + mode + " out of range for Intl.NumberFormat options property signDisplay");
  }

  function format(negative, magnitude, options) {
    const style = options.style === undefined ? "decimal" : builtins.string(options.style);
    let currency;
    if (style === "currency") {
      if (options.currency === undefined) throw new TypeError("Currency code is required with currency style.");
      currency = builtins.toUpperCase(builtins.string(options.currency));
    }

    let defaultMin = 0;
    let defaultMax = 3;
    if (style === "percent") defaultMax = 0;
    if (style === "currency") {
      defaultMin = defaultMax = builtins.indexOfIn(WHOLE_CURRENCIES, currency) >= 0 ? 0 : builtins.indexOfIn(THREE_DIGIT_CURRENCIES, currency) >= 0 ? 3 : 2;
    }

    const notation = options.notation;
    if (notation === "scientific" || notation === "engineering") {
      defaultMin = 0;
      defaultMax = style === "percent" ? 0 : 3;
    }
    if (notation === "compact" && style === "currency") {
      defaultMin = 0;
      defaultMax = 3;
    }

    let text;
    if (magnitude !== magnitude) text = "NaN";
    else if (magnitude === Infinity) text = "∞";
    else text = digits(magnitude, negative, style, options, defaultMin, defaultMax, notation === "compact", notation);
    const sign = signOf(negative, text, options);
    if (style === "percent") text += "%";
    if (style === "unit") text += unitSuffix(options, text);
    if (style === "currency") {
      const display = options.currencyDisplay;
      if (display === "name") {
        const names = CURRENCY_NAMES[currency];
        text += " " + (names === undefined ? currency : names[text === "1" ? 0 : 1]);
      } else {
        const symbol = display === "code" ? undefined : display === "narrowSymbol" ? NARROW_SYMBOLS[currency] : SYMBOLS[currency];
        const label = symbol === undefined ? currency : symbol;
        // A label that ends in a letter or a point, such as the code or F CFA, is set apart from the digits by a no-break space.
        const gap = builtins.test(/^\d/, text) && !builtins.test(/\p{S}$/u, label) ? "\u00a0" : "";
        text = label + gap + text;
      }
    }
    // A compact number keeps its minus sign, as ICU writes it. A currency name is not put in brackets.
    if (sign === "-" && style === "currency" && options.currencySign === "accounting" && options.currencyDisplay !== "name" && options.notation !== "compact") {
      return "(" + text + ")";
    }
    return sign + text;
  }

  function handled(locales, options) {
    const tag = builtins.isArray(locales) ? locales[0] : locales;
    if (tag !== undefined && !builtins.test(ENGLISH, builtins.string(tag))) return false;
    if (options === undefined || options === null) return true;
    for (let i = 0; i < UNSUPPORTED.length; i++) {
      if (options[UNSUPPORTED[i]] !== undefined) return false;
    }
    const notation = options.notation;
    if (notation !== undefined && notation !== "standard" && notation !== "compact" && notation !== "scientific" && notation !== "engineering") return false;
    if (options.compactDisplay !== undefined && options.compactDisplay !== "short" && options.compactDisplay !== "long") return false;
    if (options.currencySign !== undefined && options.currencySign !== "standard" && options.currencySign !== "accounting") return false;
    if (options.style === "unit") return unitKnown(options);
    return options.style === undefined || options.style === "decimal" || options.style === "percent" || options.style === "currency";
  }

  function unitDisplayOf(options) {
    return options.unitDisplay === undefined ? "short" : builtins.string(options.unitDisplay);
  }

  function unitKnown(options) {
    return builtins.hasOwn(UNITS, builtins.string(options.unit)) && builtins.indexOfIn(UNIT_DISPLAYS, unitDisplayOf(options)) !== -1;
  }

  // A unit is well formed when it is a simple unit, or two simple units joined by
  // "per"; any other unit is refused, as Node refuses it.
  function isSimpleUnit(unit) {
    return builtins.hasOwn(UNITS, unit) && builtins.indexOf(unit, "-per-") === -1;
  }

  function unitWellFormed(unit) {
    if (isSimpleUnit(unit)) return true;
    const at = builtins.indexOf(unit, "-per-");
    return at !== -1 && isSimpleUnit(builtins.slice(unit, 0, at)) && isSimpleUnit(builtins.slice(unit, at + 5));
  }

  // The unit after the number, with its space when the form has one. A number of
  // exactly one takes the singular, with no fraction digits shown: 001 and 1E0
  // are one, as 1.0 is not.
  function unitSuffix(options, text) {
    const forms = UNITS[builtins.string(options.unit)];
    const display = unitDisplayOf(options);
    const one = builtins.test(/^0*1(E0)?$/, builtins.replace(text, /,/g, ""));
    if (display === "narrow") return forms[2];
    if (display === "long") return forms[one ? 3 : 4];
    return forms[one ? 0 : 1];
  }

  // What useGrouping asks for: true is always, a falsy value is never, and of the
  // strings "always", "auto" and "min2" are read as they are, "true" and "false" as
  // auto. Anything else is undefined, which is refused.
  function groupingOf(value) {
    if (value === undefined) return "auto";
    if (value === true) return "always";
    if (!value) return false;
    const text = builtins.string(value);
    if (text === "true" || text === "false") return "auto";
    return text === "always" || text === "auto" || text === "min2" ? text : undefined;
  }

  function checkOptions(options, owner) {
    if (options === undefined || options === null) return;
    for (const name of builtins.keys(OPTION_VALUES)) {
      const value = options[name];
      if (value !== undefined && builtins.indexOfIn(OPTION_VALUES[name], builtins.string(value)) === -1) {
        throw new RangeError("Value " + builtins.string(value) + " out of range for " + owner + " options property " + name);
      }
    }
    if (options.useGrouping !== undefined && groupingOf(options.useGrouping) === undefined) {
      throw new RangeError("Value " + builtins.string(options.useGrouping) + " out of range for " + owner + " options property useGrouping");
    }
    if (options.currency !== undefined && !builtins.test(/^[A-Za-z]{3}$/, builtins.string(options.currency))) {
      throw new RangeError("Invalid currency code : " + builtins.string(options.currency));
    }
    if (options.style === "unit" && options.unit === undefined) {
      throw new TypeError("Invalid unit argument for " + owner + "() ''");
    }
    if (options.unit !== undefined && !unitWellFormed(builtins.string(options.unit))) {
      throw new RangeError("Invalid unit argument for " + owner + "() '" + builtins.string(options.unit) + "'");
    }
  }

  function numberToLocaleString(locales, options) {
    const value = Number.prototype.valueOf.call(this);
    checkLocales(locales);
    checkOptions(options, "Number.prototype.toLocaleString");
    if (!handled(locales, options)) return original.call(value, locales, options);

    return format(value < 0 || builtins.is(value, -0), builtins.abs(value), options || {});
  }

  function bigintToLocaleString(locales, options) {
    const value = BigInt.prototype.valueOf.call(this);
    checkLocales(locales);
    checkOptions(options, "BigInt.prototype.toLocaleString");
    if (!handled(locales, options)) return original.call(value, locales, options);

    return format(value < 0n, value < 0n ? -value : value, options || {});
  }

  return { toLocaleString: owner === BigInt.prototype ? bigintToLocaleString : numberToLocaleString };
})
