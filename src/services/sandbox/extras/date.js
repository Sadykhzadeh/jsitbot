// Date.prototype.toLocaleString, toLocaleDateString and toLocaleTimeString, for
// the guest. The engine answered all three with a zero-padded numeric form
// ("01/05/2024, 04:07:09 AM") and ignored every option and every locale.
// Evaluated the first time one of them is called; see lazyMethod in guest.js.
//
// Writes dates and times the way English (United States) does, for the options
// weekday, year, month, day, hour, minute, second, fractionalSecondDigits,
// hour12, hourCycle, dateStyle, timeStyle and timeZoneName, in the local time
// zone, in UTC or in any zone by name. The engine only has the first two, so a
// named zone is looked up with `zoneInfo`, which the host answers from its own
// time zone data: how far the zone is from UTC at a moment, and what it is
// called then. Anything else, another language, an era, a day period, a
// calendar or a numbering system, or a year outside 1 to 9999, is left to the
// engine's own method, which is the `original` it is given.
(function (original, owner, zoneInfo) {
  "use strict";

  const ENGLISH = /^en(-US)?$/i;
  const UTC_ZONES = ["utc", "gmt", "etc/utc", "etc/gmt"];
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const DATE_FIELDS = ["weekday", "year", "month", "day"];
  const TIME_FIELDS = ["hour", "minute", "second", "fractionalSecondDigits"];
  const STYLES = ["full", "long", "medium", "short"];

  const DATE_STYLES = {
    full: { weekday: "long", month: "long", day: "numeric", year: "numeric" },
    long: { month: "long", day: "numeric", year: "numeric" },
    medium: { month: "short", day: "numeric", year: "numeric" },
    short: { month: "numeric", day: "numeric", year: "2-digit" },
  };

  function choice(options, name, allowed) {
    const given = options[name];
    if (given === undefined) return undefined;
    const text = String(given);
    if (allowed.indexOf(text) === -1) {
      throw new RangeError("Value " + text + " out of range for Intl.DateTimeFormat options property " + name);
    }
    return text;
  }

  function pad(number) {
    return number < 10 ? "0" + number : String(number);
  }

  function has(fields, names) {
    for (let i = 0; i < names.length; i++) {
      if (fields[names[i]] !== undefined) return true;
    }
    return false;
  }

  // What to write, from the options and the method that was called: the fields
  // with their widths, and how the time is counted. Null for what is left to the
  // engine.
  function resolve(options, required, defaults) {
    if (options === null) throw new TypeError("Cannot convert undefined or null to object");
    options = options === undefined ? {} : Object(options);

    const f = {
      weekday: choice(options, "weekday", ["narrow", "short", "long"]),
      year: choice(options, "year", ["2-digit", "numeric"]),
      month: choice(options, "month", ["2-digit", "numeric", "narrow", "short", "long"]),
      day: choice(options, "day", ["2-digit", "numeric"]),
      hour: choice(options, "hour", ["2-digit", "numeric"]),
      minute: choice(options, "minute", ["2-digit", "numeric"]),
      second: choice(options, "second", ["2-digit", "numeric"]),
      fractionalSecondDigits: undefined,
      timeZoneName: choice(options, "timeZoneName", ["short", "long", "shortOffset", "longOffset", "shortGeneric", "longGeneric"]),
    };
    if (options.fractionalSecondDigits !== undefined) {
      const digits = Number(options.fractionalSecondDigits);
      if (!(digits >= 1 && digits <= 3)) throw new RangeError("fractionalSecondDigits value is out of range.");
      f.fractionalSecondDigits = Math.floor(digits);
    }
    const hourCycle = choice(options, "hourCycle", ["h11", "h12", "h23", "h24"]);
    const dateStyle = choice(options, "dateStyle", STYLES);
    const timeStyle = choice(options, "timeStyle", STYLES);

    let utc = false;
    let zone;
    if (options.timeZone !== undefined) {
      const given = String(options.timeZone);
      if (UTC_ZONES.indexOf(given.toLowerCase()) !== -1) {
        utc = true;
      } else {
        if (zoneInfo(given, 0, "") === "") throw new RangeError("Invalid time zone specified: " + given);
        zone = given;
      }
    }
    if (options.era !== undefined || options.dayPeriod !== undefined || options.calendar !== undefined || options.numberingSystem !== undefined) {
      return null;
    }
    // The names that are not "UTC" or its long form are the host's to give, even for UTC.
    if (utc && f.timeZoneName !== undefined && f.timeZoneName !== "short" && f.timeZoneName !== "long") {
      utc = false;
      zone = "UTC";
    }

    let cycle = hourCycle === undefined ? "h12" : hourCycle;
    if (options.hour12 !== undefined) cycle = options.hour12 ? "h12" : "h23";
    // the engines write h11 and h24 inconsistently, so they are not imitated
    if (cycle === "h11") return null;

    let glue;
    if (dateStyle !== undefined || timeStyle !== undefined) {
      const clash = DATE_FIELDS.concat(TIME_FIELDS, ["timeZoneName"]);
      for (let i = 0; i < clash.length; i++) {
        if (f[clash[i]] !== undefined) {
          throw new TypeError("Can't set option " + clash[i] + " when " + (dateStyle !== undefined ? "dateStyle" : "timeStyle") + " is used");
        }
      }
      if (dateStyle !== undefined && required === "time") throw new TypeError("Invalid option : dateStyle");
      if (timeStyle !== undefined && required === "date") throw new TypeError("Invalid option : timeStyle");

      if (dateStyle !== undefined) Object.assign(f, DATE_STYLES[dateStyle]);
      if (timeStyle !== undefined) {
        f.hour = "numeric";
        f.minute = "2-digit";
        if (timeStyle !== "short") f.second = "2-digit";
        if (timeStyle === "full" || timeStyle === "long") {
          f.timeZoneName = timeStyle === "full" ? "long" : "short";
        }
      }
      glue = dateStyle === "full" || dateStyle === "long" ? " at " : ", ";
    } else {
      let needDefaults = true;
      if (required !== "time" && has(f, DATE_FIELDS)) needDefaults = false;
      if (required !== "date" && has(f, TIME_FIELDS)) needDefaults = false;
      if (needDefaults && defaults !== "time") {
        f.year = f.month = f.day = "numeric";
      }
      if (needDefaults && defaults !== "date") {
        f.hour = f.minute = f.second = "numeric";
      }
    }

    // What the engine's formats have no sensible form for
    if (f.fractionalSecondDigits !== undefined && f.second === undefined) return null;
    if (f.second !== undefined && f.hour !== undefined && f.minute === undefined) return null;
    if (f.timeZoneName !== undefined && !has(f, ["hour", "minute", "second"])) return null;
    if (f.day !== undefined && f.month === undefined && f.year !== undefined) return null;
    if (f.month === "narrow" && (f.weekday !== undefined || f.day !== undefined || f.year !== undefined)) return null;

    return { f, utc, zone, cycle, glue };
  }

  function name(full, width) {
    return width === "long" ? full : full.slice(0, width === "short" ? 3 : 1);
  }

  function datePart(f, c) {
    let text;
    let month;
    if (f.month !== undefined) {
      if (f.month === "numeric") month = String(c.month + 1);
      else if (f.month === "2-digit") month = pad(c.month + 1);
      else month = name(MONTHS[c.month], f.month);
    }
    const day = f.day === undefined ? undefined : f.day === "2-digit" ? pad(c.day) : String(c.day);
    const year = f.year === undefined ? undefined : f.year === "2-digit" ? pad(c.year % 100) : String(c.year);

    if (f.month === "long" || f.month === "short" || f.month === "narrow") {
      text = month;
      if (day !== undefined) text += " " + day;
      if (year !== undefined) text += (day === undefined ? " " : ", ") + year;
    } else {
      const parts = [];
      if (month !== undefined) parts[parts.length] = month;
      if (day !== undefined) parts[parts.length] = day;
      if (year !== undefined) parts[parts.length] = year;
      text = parts.join("/");
    }

    if (f.weekday !== undefined) {
      const weekday = name(WEEKDAYS[c.weekday], f.weekday);
      if (text === "") text = weekday;
      else if (f.day !== undefined && f.month !== undefined) text = weekday + ", " + text;
      else text += " " + weekday;
    }
    return text;
  }

  function timePart(f, c, cycle, zoneText) {
    const parts = [];
    const twelve = cycle === "h12";
    if (f.hour !== undefined) {
      let hour = c.hours;
      if (cycle === "h12") hour = hour % 12 || 12;
      parts[parts.length] = !twelve || f.hour === "2-digit" ? pad(hour) : String(hour);
    }
    if (f.minute !== undefined) {
      parts[parts.length] = f.hour !== undefined || f.second !== undefined ? pad(c.minutes) : String(c.minutes);
    }
    if (f.second !== undefined) {
      let second = f.minute !== undefined ? pad(c.seconds) : String(c.seconds);
      if (f.fractionalSecondDigits !== undefined) {
        const fraction = String(c.milliseconds + 1000).slice(1, 1 + f.fractionalSecondDigits);
        second += "." + fraction;
      }
      parts[parts.length] = second;
    }

    let text = parts.join(":");
    if (twelve && f.hour !== undefined) text += c.hours < 12 ? " AM" : " PM";
    if (f.timeZoneName !== undefined) text += " " + zoneText;
    return text;
  }

  function format(date, locales, options, required, defaults) {
    const tag = Array.isArray(locales) ? locales[0] : locales;
    if (tag !== undefined && !ENGLISH.test(String(tag))) return original.call(date, locales, options);

    const time = Date.prototype.getTime.call(date);
    const resolved = resolve(options, required, defaults);
    if (resolved === null) return original.call(date, locales, options);
    if (time !== time) return "Invalid Date";

    const { f, utc, zone, cycle } = resolved;
    let zoneText = f.timeZoneName === "long" ? "Coordinated Universal Time" : "UTC";
    // A named zone is read as UTC on a date moved by its offset. The name of the
    // zone local time is in comes from the host as well.
    let moved = date;
    if (!utc) {
      const info = zoneInfo(zone === undefined ? "" : zone, time, f.timeZoneName === undefined ? "" : f.timeZoneName);
      const bar = info.indexOf("|");
      if (info === "" || (f.timeZoneName !== undefined && bar === -1)) return original.call(date, locales, options);
      if (zone !== undefined) {
        moved = new Date(time + Number(bar === -1 ? info : info.slice(0, bar)));
        if (Date.prototype.getTime.call(moved) !== Date.prototype.getTime.call(moved)) return original.call(date, locales, options);
      }
      if (bar !== -1) zoneText = info.slice(bar + 1);
    }
    const c = utc || zone !== undefined
      ? {
          year: moved.getUTCFullYear(), month: moved.getUTCMonth(), day: moved.getUTCDate(), weekday: moved.getUTCDay(),
          hours: moved.getUTCHours(), minutes: moved.getUTCMinutes(), seconds: moved.getUTCSeconds(), milliseconds: moved.getUTCMilliseconds(),
        }
      : {
          year: date.getFullYear(), month: date.getMonth(), day: date.getDate(), weekday: date.getDay(),
          hours: date.getHours(), minutes: date.getMinutes(), seconds: date.getSeconds(), milliseconds: date.getMilliseconds(),
        };
    if (c.year < 1 || c.year > 9999) return original.call(date, locales, options);

    const dateText = has(f, DATE_FIELDS) ? datePart(f, c) : "";
    const timeText = has(f, ["hour", "minute", "second"]) ? timePart(f, c, cycle, zoneText) : "";
    if (dateText === "" || timeText === "") return dateText + timeText;

    let glue = resolved.glue;
    if (glue === undefined) {
      if (f.month === "long") glue = " at ";
      else if (f.month === undefined && f.day === undefined && f.year === undefined && f.hour !== undefined) glue = " ";
      else glue = ", ";
    }
    return dateText + glue + timeText;
  }

  const methods = {
    toLocaleString(locales, options) {
      return format(this, locales, options, "any", "all");
    },
    toLocaleDateString(locales, options) {
      return format(this, locales, options, "date", "date");
    },
    toLocaleTimeString(locales, options) {
      return format(this, locales, options, "time", "time");
    },
  };

  return { [original.name]: methods[original.name] };
})
