// Number.prototype.toLocaleString and BigInt.prototype.toLocaleString, for the
// guest. The engine has no number formatting of its own: it answered
// (1234567.891).toLocaleString() with "1234567.891" and ignored every option.
// Evaluated the first time one of them is called; see lazyMethod in guest.js.
//
// Formats the way English does (a comma between thousands, a point before the
// decimals) for the style decimal, percent and currency, with the options
// minimumIntegerDigits, minimumFractionDigits, maximumFractionDigits and
// useGrouping. The number is rounded on the digits it is written with, half
// away from zero, so 1.005 gives 1.01. Anything else, another language or an
// option that is not listed, is left to the engine's own method, which is the
// `original` it is given, together with the prototype it belongs to.
(function (original, owner) {
  "use strict";

  const ENGLISH = /^en(-(US|GB|AU|CA|NZ|IE))?$/i;
  const SYMBOLS = { USD: "$", EUR: "\u20ac", GBP: "\u00a3", JPY: "\u00a5", INR: "\u20b9", KRW: "\u20a9", CNY: "CN\u00a5", CAD: "CA$", AUD: "A$" };
  const WHOLE_CURRENCIES = ["JPY", "KRW"];
  const UNSUPPORTED = [
    "notation", "compactDisplay", "signDisplay", "unit", "unitDisplay", "currencyDisplay", "currencySign",
    "minimumSignificantDigits", "maximumSignificantDigits", "roundingMode", "roundingIncrement",
  ];

  function digitsOption(options, name, fallback) {
    const given = options[name];
    if (given === undefined) return fallback;
    const number = Number(given);
    if (!(number >= 0 && number <= 100)) throw new RangeError(name + " value is out of range.");
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

  function group(whole) {
    let out = "";
    for (let i = 0; i < whole.length; i++) {
      if (i > 0 && (whole.length - i) % 3 === 0) out += ",";
      out += whole[i];
    }
    return out;
  }

  // The digits of a number, rounded and grouped as the options say.
  function digits(magnitude, style, options, defaultMin, defaultMax) {
    let minimum = digitsOption(options, "minimumFractionDigits", undefined);
    let maximum = digitsOption(options, "maximumFractionDigits", undefined);
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      throw new RangeError("maximumFractionDigits value is out of range.");
    }
    if (minimum === undefined) minimum = maximum === undefined ? defaultMin : Math.min(defaultMin, maximum);
    if (maximum === undefined) maximum = Math.max(defaultMax, minimum);
    const integers = digitsOption(options, "minimumIntegerDigits", 1);

    const parts = typeof magnitude === "bigint" ? { whole: String(magnitude) + (style === "percent" ? "00" : ""), fraction: "" } : split(magnitude, style === "percent" ? 2 : 0);
    let whole = parts.whole;
    let fraction = parts.fraction;
    if (fraction.length > maximum) {
      const up = fraction[maximum] >= "5";
      let kept = whole + fraction.slice(0, maximum);
      if (up) kept = increment(kept);
      whole = kept.slice(0, kept.length - maximum);
      fraction = kept.slice(kept.length - maximum);
    }
    whole = whole.replace(/^0+/, "");
    while (fraction.length > minimum && fraction[fraction.length - 1] === "0") fraction = fraction.slice(0, -1);
    if (fraction.length < minimum) fraction += "0".repeat(minimum - fraction.length);
    if (whole.length < integers) whole = "0".repeat(integers - whole.length) + whole;

    const grouping = options.useGrouping;
    const text = grouping === false || grouping === "false" ? whole : group(whole);
    return fraction === "" ? text : text + "." + fraction;
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
    else if (magnitude === Infinity) text = "\u221e";
    else text = digits(magnitude, style, options, defaultMin, defaultMax);
    if (style === "percent") text += "%";
    if (style === "currency") {
      const symbol = SYMBOLS[currency];
      text = (symbol === undefined ? currency + (/^\d/.test(text) ? "\u00a0" : "") : symbol) + text;
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
