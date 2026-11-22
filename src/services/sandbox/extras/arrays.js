// Array.prototype.join, and the toLocaleString of arrays and typed arrays, for the
// guest. The engine recurses into an array that contains itself until the stack runs
// out, where Node writes the array that is met again as nothing: an array of 1 and
// itself is "1,". toString goes through join, as the specification says, so it is
// covered too. The engine does not give the locales and the options to the elements,
// so toLocaleString asks each element for its own text with them, as the specification
// says. Evaluated the first time one of them is called; see lazyMethod in guest.js.
(function (original, owner, zoneInfo, builtins) {
  "use strict";

  // The arrays being written now, the innermost last.
  const writing = [];

  function guarded(write) {
    return function () {
      if (this === undefined || this === null) return builtins.apply(original, this, arguments);
      if (builtins.indexOfIn(writing, this) !== -1) return "";
      builtins.push(writing, this);
      try {
        return builtins.apply(write, this, arguments);
      } finally {
        builtins.pop(writing);
      }
    };
  }

  function localeText(locales, options) {
    const parts = [];
    for (let i = 0; i < this.length; i++) {
      const element = this[i];
      builtins.push(parts, element === undefined || element === null ? "" : builtins.string(element.toLocaleString(locales, options)));
    }
    return builtins.join(parts, ",");
  }

  if (original.name === "toLocaleString") {
    return { toLocaleString: guarded(localeText) };
  }
  return {
    [original.name]: guarded(original),
  };
})
