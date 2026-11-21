// String.prototype.toLocaleUpperCase and toLocaleLowerCase, for the guest. The
// engine maps case the same way for every locale, so "i".toLocaleUpperCase("tr")
// gave "I" where Node gives "İ". Turkish and Azeri keep the dotted and the
// dotless i apart, as the locale data does, and every other locale gets the
// engine's mapping. Evaluated the first time one of the two is called; see
// lazyMethod in guest.js.
(function (original, owner) {
  "use strict";

  const upper = original.name === "toLocaleUpperCase";

  // The engine's own case mapping, which ignores the locale, is applied after the
  // Turkish letters are settled, so the rest of the text is mapped as it is elsewhere.
  function mapTurkish(text) {
    if (upper) return original.call(text.replace(/i/g, "İ"));
    // The first replace takes an I with a dot above (I + U+0307), the second the capital dotted I (U+0130).
    return original.call(text.replace(/İ/g, "i").replace(/İ/g, "i").replace(/I/g, "ı"));
  }

  function isTurkish(locales) {
    const first = Array.isArray(locales) ? locales[0] : locales;
    return first !== undefined && /^(tr|az)(-|$)/i.test(String(first));
  }

  return {
    [original.name]() {
      if (this == null || !isTurkish(arguments[0])) return original.apply(this, arguments);
      return mapTurkish(`${this}`);
    },
  };
})
