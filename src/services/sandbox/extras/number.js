// Number.prototype.toLocaleString and BigInt.prototype.toLocaleString, for the
// guest. The engine has no number formatting of its own: it answered
// (1234567.891).toLocaleString() with "1234567.891" and ignored every option.
// Evaluated the first time one of them is called; see lazyMethod in guest.js.
//
// Formats the way English does (a comma between thousands, a point before the
// decimals) for the style decimal, percent and currency, with the options
// minimumIntegerDigits, minimumFractionDigits, maximumFractionDigits,
// minimumSignificantDigits, maximumSignificantDigits, useGrouping and
// notation "compact" (with compactDisplay). The number is rounded on the
// digits it is written with, half away from zero, so 1.005 gives 1.01.
// Anything else, another language or an option that is not listed, is left to
// the engine's own method, which is the `original` it is given, together with
// the prototype it belongs to.
(function (original, owner) {
  "use strict";

  const ENGLISH = /^en(-(US|GB|AU|CA|NZ|IE))?$/i;
  const SYMBOLS = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", INR: "₹", KRW: "₩", CNY: "CN¥", CAD: "CA$", AUD: "A$" };
  const WHOLE_CURRENCIES = ["JPY", "KRW"];
  const UNSUPPORTED = [
    "signDisplay", "unit", "unitDisplay", "currencyDisplay", "currencySign", "roundingMode", "roundingIncrement",
  ];
  const SHORT_UNITS = ["", "K", "M", "B", "T"];
  const LONG_UNITS = ["", " thousand", " million", " billion", " trillion"];

  function digitsOption(options, name, fallback, lowest, highest) {
    const given = options[name];
    if (given === undefined) return fallback;
    const number = Number(given);
    if (!(number >= lowest && number <= highest)) throw new RangeError(name + " value is out of range.");
    return Math.floor(number);
  }

  // One more at the last digit of a string of digits.
  function increment(digits) {
    let i = digits.length - 1;
    while (i >= 0 && digits[i] === "9") i--;
    if (i < 0) return "1" + "0".repeat(digits.length);
    return digits.slice(0, i) + String.fromCharCode(digits.charCodeAt(i) + 1) + "0".repeat(digits.length - 1 - i);
  }

  // The digits of a non-negative finite number as it is written, moved
  // `shift` places to the left.
  function split(value, shift) {
    const parts = String(value).split("e");
    const written = parts[0].split(".");
    const whole = written[0];
    let digits = whole + (written[1] || "");
    let point = whole.length + (Number(parts[1]) || 0) + shift;

    if (point < 0) {
      digits = "0".repeat(-point) + digits;
      point = 0;
    } else if (point > digits.length) {
      digits += "0".repeat(point - digits.length);
    }
    return { whole: digits.slice(0, point), fraction: digits.slice(point) };
  }

  // Keeps `places` digits after the point, rounding half up on the digits;
  // a negative number of places rounds to tens, hundreds and so on.
  function roundAt(parts, places) {
    if (places >= parts.fraction.length) return parts;

    const all = parts.whole + parts.fraction;
    const cut = parts.whole.length + places;
    let kept = cut > 0 ? all.slice(0, cut) : "";
    if (cut >= 0 && all[cut] >= "5") kept = increment(kept);
    if (kept === "") kept = "0";

    if (places >= 0) {
      kept = "0".repeat(Math.max(0, places + 1 - kept.length)) + kept;
      return { whole: kept.slice(0, kept.length - places), fraction: kept.slice(kept.length - places) };
    }
    return { whole: kept === "0" ? "0" : kept + "0".repeat(-places), fraction: "" };
  }

  // How many digits a number is written with, not counting the zeros in front.
  function significant(parts) {
    const whole = parts.whole.replace(/^0+/, "");
    return whole === "" ? parts.fraction.replace(/^0+/, "").length : whole.length + parts.fraction.length;
  }

  // Rounds to at most `maximum` significant digits and writes at least `minimum`.
  function roundSignificant(parts, minimum, maximum) {
    const whole = parts.whole.replace(/^0+/, "");
    let places;
    if (whole !== "") {
      places = maximum - whole.length;
    } else {
      const zeros = parts.fraction.length - parts.fraction.replace(/^0+/, "").length;
      places = zeros === parts.fraction.length ? 0 : zeros + maximum;
    }

    const rounded = roundAt(parts, places);
    let fraction = rounded.fraction;
    let count = significant(rounded);
    if (count === 0) {
      count = 1;
      if (minimum > 1) fraction = "0".repeat(minimum - 1);
    } else {
      while (count > minimum && fraction[fraction.length - 1] === "0") {
        fraction = fraction.slice(0, -1);
        count--;
      }
      if (count < minimum) fraction += "0".repeat(minimum - count);
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

  // The digits of a number, rounded and grouped as the options say. A compact
  // number is written as a smaller number with a word or a letter after it.
  function digits(magnitude, style, options, defaultMin, defaultMax, compact) {
    let minimum = digitsOption(options, "minimumFractionDigits", undefined, 0, 100);
    let maximum = digitsOption(options, "maximumFractionDigits", undefined, 0, 100);
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      throw new RangeError("maximumFractionDigits value is out of range.");
    }
    const fractionGiven = minimum !== undefined || maximum !== undefined;
    if (minimum === undefined) minimum = maximum === undefined ? defaultMin : Math.min(defaultMin, maximum);
    if (maximum === undefined) maximum = Math.max(defaultMax, minimum);
    const integers = digitsOption(options, "minimumIntegerDigits", 1, 1, 21);

    let leastSignificant = digitsOption(options, "minimumSignificantDigits", undefined, 1, 21);
    let mostSignificant = digitsOption(options, "maximumSignificantDigits", undefined, 1, 21);
    const bySignificant = leastSignificant !== undefined || mostSignificant !== undefined;
    if (leastSignificant === undefined) leastSignificant = 1;
    if (mostSignificant === undefined) mostSignificant = 21;
    if (leastSignificant > mostSignificant) throw new RangeError("maximumSignificantDigits value is out of range.");

    const shift = style === "percent" ? 2 : 0;
    const round = function (parts) {
      if (bySignificant) return roundSignificant(parts, leastSignificant, mostSignificant);
      if (compact && !fractionGiven) {
        return parts.whole.replace(/^0+/, "").length >= 2 ? roundAt(parts, 0) : roundSignificant(parts, 1, 2);
      }
      return roundAt(parts, maximum);
    };

    let parts = split(magnitude, shift);
    let exponent = 0;
    if (compact) {
      const length = parts.whole.replace(/^0+/, "").length;
      exponent = length > 3 ? Math.min(Math.floor((length - 1) / 3), 4) : 0;
      for (;;) {
        parts = round(exponent === 0 ? split(magnitude, shift) : split(magnitude, shift - exponent * 3));
        if (parts.whole.replace(/^0+/, "").length <= 3 || exponent === 4) break;
        exponent++;
      }
    } else {
      parts = round(parts);
    }

    let whole = parts.whole.replace(/^0+/, "");
    let fraction = parts.fraction;
    if (!bySignificant && !(compact && !fractionGiven)) {
      while (fraction.length > minimum && fraction[fraction.length - 1] === "0") fraction = fraction.slice(0, -1);
      if (fraction.length < minimum) fraction += "0".repeat(minimum - fraction.length);
    }
    if (whole.length < integers) whole = "0".repeat(integers - whole.length) + whole;

    const grouping = options.useGrouping;
    // A compact number is only grouped when there are five digits to group, unless it is asked to always be.
    const short = compact && whole.length < 5 && grouping !== true && grouping !== "always";
    const text = grouping === false || grouping === "false" || short ? whole : group(whole);
    const written = fraction === "" ? text : text + "." + fraction;
    return compact ? written + (options.compactDisplay === "long" && style !== "currency" ? LONG_UNITS : SHORT_UNITS)[exponent] : written;
  }

  function format(negative, magnitude, options) {
    const style = options.style === undefined ? "decimal" : String(options.style);
    let currency;
    if (style === "currency") {
      if (options.currency === undefined) throw new TypeError("Currency code is required with currency style.");
      currency = String(options.currency).toUpperCase();
    }

    let defaultMin = 0;
    let defaultMax = 3;
    if (style === "percent") defaultMax = 0;
    if (style === "currency") {
      defaultMin = defaultMax = WHOLE_CURRENCIES.indexOf(currency) >= 0 ? 0 : 2;
    }

    let text;
    if (magnitude !== magnitude) text = "NaN";
    else if (magnitude === Infinity) text = "∞";
    else text = digits(magnitude, style, options, defaultMin, defaultMax, options.notation === "compact");
    if (style === "percent") text += "%";
    if (style === "currency") {
      const symbol = SYMBOLS[currency];
      text = (symbol === undefined ? currency + (/^\d/.test(text) ? " " : "") : symbol) + text;
    }
    return (negative ? "-" : "") + text;
  }

  function handled(locales, options) {
    const tag = Array.isArray(locales) ? locales[0] : locales;
    if (tag !== undefined && !ENGLISH.test(String(tag))) return false;
    if (options === undefined || options === null) return true;
    for (let i = 0; i < UNSUPPORTED.length; i++) {
      if (options[UNSUPPORTED[i]] !== undefined) return false;
    }
    if (options.notation !== undefined && options.notation !== "standard" && options.notation !== "compact") return false;
    if (options.compactDisplay !== undefined && options.compactDisplay !== "short" && options.compactDisplay !== "long") return false;
    return options.style === undefined || options.style === "decimal" || options.style === "percent" || options.style === "currency";
  }

  function numberToLocaleString(locales, options) {
    const value = Number.prototype.valueOf.call(this);
    if (!handled(locales, options)) return original.call(value, locales, options);

    return format(value < 0 || Object.is(value, -0), Math.abs(value), options || {});
  }

  function bigintToLocaleString(locales, options) {
    const value = BigInt.prototype.valueOf.call(this);
    if (!handled(locales, options)) return original.call(value, locales, options);

    return format(value < 0n, value < 0n ? -value : value, options || {});
  }

  return { toLocaleString: owner === BigInt.prototype ? bigintToLocaleString : numberToLocaleString };
})
