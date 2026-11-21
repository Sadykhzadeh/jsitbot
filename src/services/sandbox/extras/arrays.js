// Array.prototype.join and Array.prototype.toLocaleString, for the guest. The engine
// recurses into an array that contains itself until the stack runs out, where Node
// writes the array that is met again as nothing: an array of 1 and itself is "1,".
// toString goes through join, as the specification says, so it is covered too.
// Evaluated the first time one of the two is called; see lazyMethod in guest.js.
(function (original, owner, zoneInfo, builtins) {
  "use strict";

  // The arrays being written now, the innermost last.
  const writing = [];

  return {
    [original.name]() {
      if (builtins.indexOfIn(writing, this) !== -1) return "";
      builtins.push(writing, this);
      try {
        return original.apply(this, arguments);
      } finally {
        builtins.pop(writing);
      }
    },
  };
})
