// Date.prototype.toString and toTimeString, for the guest. The engine ends them
// at the offset ("Thu Jan 01 1970 04:00:00 GMT+0400"), and Node adds the name
// of the zone in brackets. The name comes from the host, which has the time
// zone data; see zoneInfo in date.js.
// Evaluated the first time one of them is called; see lazyMethod in guest.js.
(function (original, owner, zoneInfo) {
  "use strict";

  const getTime = Date.prototype.getTime;

  function named(date, text) {
    if (text === "Invalid Date") return text;

    const info = zoneInfo("", getTime.call(date), "long");
    const bar = info.indexOf("|");
    return bar === -1 ? text : text + " (" + info.slice(bar + 1) + ")";
  }

  const methods = {
    toString() {
      return named(this, original.call(this));
    },
    toTimeString() {
      return named(this, original.call(this));
    },
  };

  return { [original.name]: methods[original.name] };
})
