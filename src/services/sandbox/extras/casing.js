// String.prototype.toLocaleUpperCase and toLocaleLowerCase, for the guest. The
// engine maps case the same way for every locale, so "i".toLocaleUpperCase("tr")
// gave "I" where Node gives "İ". Turkish and Azeri keep the dotted and the
// dotless i apart, as the locale data does, and every other locale gets the
// engine's mapping. The locale argument is read as Node reads it, so a malformed
// tag is refused with "Invalid language tag". Evaluated the first time one of the
// two is called; see lazyMethod in guest.js.
(function (original, owner, zoneInfo, builtins) {
  "use strict";

  const upper = original.name === "toLocaleUpperCase";

  // The grammar of a language tag, as the engine reads it, with no singleton given twice.
  const LANGUAGE_TAG = /^(?:[a-z]{2,3}|[a-z]{5,8})(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?(?:-(?:[a-z\d]{5,8}|\d[a-z\d]{3}))*(?:-[\da-wy-z](?:-[a-z\d]{2,8})+)*(?:-x(?:-[a-z\d]{1,8})+)?$/i;

  // Tags that have passed the check, so a program that repeats one does not pay for the check each time.
  const checked = new Map();

  // The language subtag of a tag that passes the check, which Node refuses with "Invalid language tag" otherwise.
  // The tag and language of the last call, which is the one a loop repeats.
  let lastTag;
  let lastLanguage;

  function languageOfTag(tag) {
    if (tag === lastTag) return lastLanguage;
    const known = checked.get(tag);
    if (known !== undefined) {
      lastTag = tag;
      lastLanguage = known;
      return known;
    }

    if (builtins.includes(tag, "-")) {
      const singletons = builtins.filter(builtins.split(builtins.split(builtins.toLowerCase(tag), "-x-")[0], "-"), (subtag) => subtag.length === 1);
      if (new Set(singletons).size !== singletons.length) throw new RangeError("Invalid language tag: " + tag);
    }
    if (!builtins.test(LANGUAGE_TAG, tag)) throw new RangeError("Invalid language tag: " + tag);

    const language = builtins.split(builtins.toLowerCase(tag), "-")[0];
    if (checked.size >= 256) checked.clear();
    checked.set(tag, language);
    lastTag = tag;
    lastLanguage = language;
    return language;
  }

  // The language of the locale a call uses, read as Node reads the argument: a string is the tag,
  // and anything else is taken from its first element, which is converted to a tag when it is an
  // object. Returns "" when the call uses the default locale.
  function languageOf(locales) {
    if (typeof locales === "string" && locales === lastTag) return lastLanguage;
    if (locales === undefined) return "";
    if (locales === null) throw new TypeError("Cannot convert undefined or null to object");

    let first = locales;
    if (typeof locales !== "string") {
      const list = Object(locales);
      if (!(builtins.number(list.length) > 0)) return "";
      first = list[0];
    }

    if (typeof first === "string") return languageOfTag(first);
    if ((typeof first === "object" && first !== null) || typeof first === "function") return languageOfTag(builtins.string(first));
    throw new TypeError("Language ID should be string or object.");
  }

  // The engine's own case mapping, which ignores the locale, is applied after the
  // Turkish letters are settled, so the rest of the text is mapped as it is elsewhere.
  function mapTurkish(text) {
    if (upper) return builtins.apply(original, builtins.replace(text, /i/g, "İ"), []);
    // The first replace takes an I with a dot above (I + U+0307), the second the capital dotted I (U+0130).
    return builtins.apply(original, builtins.replace(builtins.replace(builtins.replace(text, /İ/g, "i"), /İ/g, "i"), /I/g, "ı"), []);
  }

  return {
    [original.name](locales) {
      if (this == null) throw new TypeError(`String.prototype.${original.name} called on null or undefined`);
      if (locales === undefined) return builtins.apply(original, this, []);
      const language = languageOf(locales);
      if (language !== "tr" && language !== "az") return builtins.apply(original, this, []);
      return mapTurkish(`${this}`);
    },
  };
})
