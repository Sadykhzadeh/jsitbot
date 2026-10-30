// String.prototype.localeCompare, for the guest. The engine compares code units
// and answers with their difference, so "a".localeCompare("B") was positive and
// a list sorted with it put every capital before every small letter. Evaluated
// the first time the code calls localeCompare; see lazyMethod in guest.js.
//
// Orders strings as the root collation of Unicode does for the scripts people
// type in a chat: white space, punctuation and symbols, then digits, then
// letters, with the letters compared apart from their accents and case first.
// Accents decide next and case last, small letters before capitals. The
// locale is not looked at, and neither are the rules of one language for what
// comes after "z". The options numeric, sensitivity, caseFirst and
// ignorePunctuation are honoured.
(function () {
  "use strict";

  // The order the root collation gives the ASCII punctuation and symbols.
  const PUNCTUATION = " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";
  // Letters the engine does not take apart, with what they stand for.
  const EXPANSIONS = { "\u00df": "ss", "\u00e6": "ae", "\u0153": "oe" };
  const STROKED = { "\u00f8": "o", "\u0111": "d", "\u0142": "l", "\u0127": "h" };
  const STROKE = "\u0338";

  const GROUP = 0x200000;
  const WHITE_SPACE = 0;
  const PUNCTUATION_GROUP = 1;
  const SYMBOL_GROUP = 2;
  const DIGIT_GROUP = 3;
  const LETTER_GROUP = 4;

  const MARK = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/;
  const LETTER = /^\p{L}$/u;
  const NUMBER = /^\p{N}$/u;
  const SEPARATOR = /^[\p{Z}\p{C}]$/u;
  const SIGN = /^\p{P}$/u;

  function weight(letter) {
    const code = letter.codePointAt(0);
    const index = PUNCTUATION.indexOf(letter);
    if (index >= 0) return (index === 0 ? WHITE_SPACE : PUNCTUATION_GROUP) * GROUP + index;
    if (code >= 48 && code <= 57) return DIGIT_GROUP * GROUP + code;
    if (SEPARATOR.test(letter)) return WHITE_SPACE * GROUP + code;
    if (LETTER.test(letter)) return LETTER_GROUP * GROUP + code;
    if (NUMBER.test(letter)) return DIGIT_GROUP * GROUP + code;
    return (SIGN.test(letter) ? PUNCTUATION_GROUP : SYMBOL_GROUP) * GROUP + code;
  }

  function isDigit(letter) {
    return letter >= "0" && letter <= "9";
  }

  // The text as a list of characters with their accents and case set apart.
  // With numeric, a run of digits is one element that has its number in `digits`.
  function elements(text, numeric, ignorePunctuation) {
    const list = [];
    const letters = Array.from(String(text).normalize("NFD"));

    for (let i = 0; i < letters.length; i++) {
      const letter = letters[i];
      const last = list[list.length - 1];

      if (MARK.test(letter)) {
        if (last) last.marks.push(letter.codePointAt(0));
        else list.push({ weight: 0, marks: [letter.codePointAt(0)], upper: false });
        continue;
      }

      if (numeric && isDigit(letter)) {
        let end = i;
        while (end + 1 < letters.length && isDigit(letters[end + 1])) end++;
        const run = letters.slice(i, end + 1).join("").replace(/^0+(?=\d)/, "");
        list.push({ weight: DIGIT_GROUP * GROUP + 48, marks: [], upper: false, digits: run });
        i = end;
        continue;
      }

      const lower = letter.toLowerCase();
      const upper = lower !== letter;
      const expansion = EXPANSIONS[lower];
      const marks = [];
      let base = lower;
      if (expansion) {
        // Compared as the two letters it stands for, and after them when those are all there is.
        list.push({ weight: weight(expansion[0]), marks: [], upper });
        base = expansion[1];
        marks.push(1);
      } else if (STROKED[lower]) {
        base = STROKED[lower];
        marks.push(STROKE.codePointAt(0));
      }

      const element = { weight: weight(base), marks, upper };
      if (ignorePunctuation && element.weight < DIGIT_GROUP * GROUP) continue;
      list.push(element);
    }

    return list;
  }

  function sign(difference) {
    return difference < 0 ? -1 : difference > 0 ? 1 : 0;
  }

  function compareDigits(a, b) {
    return a.length !== b.length ? sign(a.length - b.length) : a < b ? -1 : a > b ? 1 : 0;
  }

  function compareMarks(a, b) {
    for (let i = 0; i < a.length && i < b.length; i++) {
      if (a[i] !== b[i]) return sign(a[i] - b[i]);
    }
    return sign(a.length - b.length);
  }

  function localeCompare(that) {
    // The runtime is evaluated as a script, where a function called on null or
    // undefined is given the global object instead.
    if (this === undefined || this === null || this === globalThis) {
      throw new TypeError("String.prototype.localeCompare called on null or undefined");
    }

    const options = arguments[2];
    const numeric = options != null && !!options.numeric;
    const ignorePunctuation = options != null && !!options.ignorePunctuation;
    const sensitivity = options != null && options.sensitivity !== undefined ? String(options.sensitivity) : "variant";
    const upperFirst = options != null && String(options.caseFirst) === "upper";

    const a = elements(this, numeric, ignorePunctuation);
    const b = elements(that, numeric, ignorePunctuation);

    for (let i = 0; i < a.length && i < b.length; i++) {
      if (a[i].weight !== b[i].weight) return sign(a[i].weight - b[i].weight);
      if (a[i].digits !== undefined && b[i].digits !== undefined) {
        const order = compareDigits(a[i].digits, b[i].digits);
        if (order !== 0) return order;
      }
    }
    if (a.length !== b.length) return sign(a.length - b.length);
    if (sensitivity === "base") return 0;

    if (sensitivity !== "case") {
      for (let i = 0; i < a.length; i++) {
        const order = compareMarks(a[i].marks, b[i].marks);
        if (order !== 0) return order;
      }
    }
    if (sensitivity === "accent") return 0;

    for (let i = 0; i < a.length; i++) {
      if (a[i].upper !== b[i].upper) return a[i].upper === upperFirst ? -1 : 1;
    }
    return 0;
  }

  return { localeCompare };
})
