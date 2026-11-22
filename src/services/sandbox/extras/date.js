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
(function (engine, zoneInfo, builtins) {
  "use strict";

  const ENGLISH = /^en(-US)?$/i;

  // The grammar of a language tag, as the engine reads it, with no singleton given twice.
  // Node refuses a tag that fails either check with "Invalid language tag".
  const LANGUAGE_TAG = /^(?:[a-z]{2,3}|[a-z]{5,8})(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?(?:-(?:[a-z\d]{5,8}|\d[a-z\d]{3}))*(?:-[\da-wy-z](?:-[a-z\d]{2,8})+)*(?:-x(?:-[a-z\d]{1,8})+)?$/i;

  function checkLocales(locales) {
    const tags = builtins.isArray(locales) ? locales : [locales];
    for (let i = 0; i < tags.length; i++) {
      if (tags[i] === undefined) continue;
      const tag = builtins.string(tags[i]);
      const singletons = builtins.filter(builtins.split(builtins.split(builtins.toLowerCase(tag), "-x-")[0], "-"), (subtag) => subtag.length === 1);
      if (!builtins.test(LANGUAGE_TAG, tag) || builtins.some(singletons, (subtag, at) => builtins.indexOfIn(singletons, subtag) !== at)) {
        throw new RangeError("Invalid language tag: " + tag);
      }
    }
  }
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

  function choice(options, name, allowed, owner) {
    const given = options[name];
    if (given === undefined) return undefined;
    const text = builtins.string(given);
    if (builtins.indexOfIn(allowed, text) === -1) {
      throw new RangeError("Value " + text + " out of range for " + owner + " options property " + name);
    }
    return text;
  }

  function pad(number) {
    return number < 10 ? "0" + number : builtins.string(number);
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
  function resolve(options, required, defaults, owner) {
    if (options === null) throw new TypeError("Cannot convert undefined or null to object");
    options = options === undefined ? {} : Object(options);

    const f = {
      weekday: choice(options, "weekday", ["narrow", "short", "long"], owner),
      year: choice(options, "year", ["2-digit", "numeric"], owner),
      month: choice(options, "month", ["2-digit", "numeric", "narrow", "short", "long"], owner),
      day: choice(options, "day", ["2-digit", "numeric"], owner),
      hour: choice(options, "hour", ["2-digit", "numeric"], owner),
      minute: choice(options, "minute", ["2-digit", "numeric"], owner),
      second: choice(options, "second", ["2-digit", "numeric"], owner),
      fractionalSecondDigits: undefined,
      timeZoneName: choice(options, "timeZoneName", ["short", "long", "shortOffset", "longOffset", "shortGeneric", "longGeneric"], owner),
    };
    if (options.fractionalSecondDigits !== undefined) {
      const digits = builtins.number(options.fractionalSecondDigits);
      if (!(digits >= 1 && digits <= 3)) throw new RangeError("fractionalSecondDigits value is out of range.");
      f.fractionalSecondDigits = builtins.floor(digits);
    }
    const hourCycle = choice(options, "hourCycle", ["h11", "h12", "h23", "h24"], owner);
    const dateStyle = choice(options, "dateStyle", STYLES, owner);
    const timeStyle = choice(options, "timeStyle", STYLES, owner);
    choice(options, "era", ["narrow", "short", "long"], owner);
    choice(options, "dayPeriod", ["narrow", "short", "long"], owner);
    choice(options, "formatMatcher", ["basic", "best fit"], owner);
    choice(options, "localeMatcher", ["lookup", "best fit"], owner);

    let utc = false;
    let zone;
    if (options.timeZone !== undefined) {
      const given = builtins.string(options.timeZone);
      if (builtins.indexOfIn(UTC_ZONES, builtins.toLowerCase(given)) !== -1) {
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

    let glue;
    if (dateStyle !== undefined || timeStyle !== undefined) {
      const clash = builtins.concat(DATE_FIELDS, TIME_FIELDS, ["timeZoneName"]);
      for (let i = 0; i < clash.length; i++) {
        if (f[clash[i]] !== undefined) {
          throw new TypeError("Invalid option : option");
        }
      }
      if (dateStyle !== undefined && required === "time") throw new TypeError("Invalid option : dateStyle");
      if (timeStyle !== undefined && required === "date") throw new TypeError("Invalid option : timeStyle");

      if (dateStyle !== undefined) builtins.assign(f, DATE_STYLES[dateStyle]);
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
      // With the defaults, Node writes the hour of h11 as h12 does, and a time
      // that names its hour counts it from 0 to 11.
      if (needDefaults && cycle === "h11") cycle = "h12";
    }

    // The fraction is written in the place of the seconds, and it comes with them
    // when there is a minute. With an hour the engines write it in a form that is not
    // worth imitating, so that is left to the engine.
    if (f.fractionalSecondDigits !== undefined && f.second === undefined) {
      if (f.hour !== undefined) return null;
      if (f.minute !== undefined) f.second = "numeric";
    }
    // What the engine's formats have no sensible form for
    if (f.second !== undefined && f.hour !== undefined && f.minute === undefined) return null;
    if (f.day !== undefined && f.month === undefined && f.year !== undefined) return null;
    if (f.month === "narrow" && (f.weekday !== undefined || f.day !== undefined || f.year !== undefined)) return null;

    return { f, utc, zone, cycle, glue };
  }

  function name(full, width) {
    return width === "long" ? full : builtins.slice(full, 0, width === "short" ? 3 : 1);
  }

  // A date is written as parts: the date, then the time, then the zone name. A part
  // is its type and the text it was written with, so the parts joined are the text.
  function datePart(f, c) {
    const parts = [];
    const add = (type, value) => {
      parts[parts.length] = { type, value };
    };

    let month;
    if (f.month !== undefined) {
      if (f.month === "numeric") month = builtins.string(c.month + 1);
      else if (f.month === "2-digit") month = pad(c.month + 1);
      else month = name(MONTHS[c.month], f.month);
    }
    const day = f.day === undefined ? undefined : f.day === "2-digit" ? pad(c.day) : builtins.string(c.day);
    const year = f.year === undefined ? undefined : f.year === "2-digit" ? pad(c.year % 100) : builtins.string(c.year);

    if (f.month === "long" || f.month === "short" || f.month === "narrow") {
      add("month", month);
      if (day !== undefined) {
        add("literal", " ");
        add("day", day);
      }
      if (year !== undefined) {
        add("literal", day === undefined ? " " : ", ");
        add("year", year);
      }
    } else {
      const fields = [];
      if (month !== undefined) fields[fields.length] = ["month", month];
      if (day !== undefined) fields[fields.length] = ["day", day];
      if (year !== undefined) fields[fields.length] = ["year", year];
      builtins.forEach(fields, ([type, value], i) => {
        if (i > 0) add("literal", "/");
        add(type, value);
      });
    }

    if (f.weekday !== undefined) {
      const weekday = name(WEEKDAYS[c.weekday], f.weekday);
      if (parts.length === 0) add("weekday", weekday);
      else if (f.day !== undefined && f.month !== undefined) {
        builtins.unshift(parts, { type: "weekday", value: weekday }, { type: "literal", value: ", " });
      } else {
        add("literal", " ");
        add("weekday", weekday);
      }
    }
    return parts;
  }

  function timePart(f, c, cycle, zoneText) {
    const parts = [];
    const add = (type, value) => {
      parts[parts.length] = { type, value };
    };

    const fields = [];
    const twelve = cycle === "h12" || cycle === "h11";
    if (f.hour !== undefined) {
      let hour = c.hours;
      if (cycle === "h12") hour = hour % 12 || 12;
      else if (cycle === "h11") hour = hour % 12;
      fields[fields.length] = ["hour", !twelve || f.hour === "2-digit" ? pad(hour) : builtins.string(hour)];
    }
    if (f.minute !== undefined) {
      fields[fields.length] = ["minute", f.hour !== undefined || f.second !== undefined ? pad(c.minutes) : builtins.string(c.minutes)];
    }
    if (f.second !== undefined) {
      fields[fields.length] = ["second", f.minute !== undefined ? pad(c.seconds) : builtins.string(c.seconds)];
    }
    builtins.forEach(fields, ([type, value], i) => {
      if (i > 0) add("literal", ":");
      add(type, value);
    });

    if (f.fractionalSecondDigits !== undefined && (f.second !== undefined || fields.length === 0)) {
      if (fields.length > 0) add("literal", ".");
      add("fractionalSecond", builtins.slice(builtins.string(c.milliseconds + 1000), 1, 1 + f.fractionalSecondDigits));
    }
    if (twelve && f.hour !== undefined) {
      add("literal", " ");
      add("dayPeriod", c.hours < 12 ? "AM" : "PM");
    }
    if (f.timeZoneName !== undefined) {
      add("literal", " ");
      add("timeZoneName", zoneText);
    }
    return parts;
  }

  // What each method asks for: the fields it writes when none is given, and the
  // error messages name the method as the engine does.
  const METHODS = {
    toLocaleString: { required: "any", defaults: "all", owner: "Date.prototype.toLocaleString" },
    toLocaleDateString: { required: "date", defaults: "date", owner: "Date.prototype.toLocaleDateString" },
    toLocaleTimeString: { required: "time", defaults: "time", owner: "Date.prototype.toLocaleTimeString" },
  };

  // The parts of a date as the method named writes it, or undefined for what the
  // engine has to write.
  function layout(date, method, locales, options) {
    checkLocales(locales);
    const tag = builtins.isArray(locales) ? locales[0] : locales;
    if (tag !== undefined && !builtins.test(ENGLISH, builtins.string(tag))) return undefined;

    const time = builtins.getTime(date);
    const asked = METHODS[method];
    const resolved = resolve(options, asked.required, asked.defaults, asked.owner);
    if (resolved === null) return undefined;
    if (time !== time) return [{ type: "literal", value: "Invalid Date" }];

    const { f, utc, zone, cycle, glue: wanted } = resolved;
    let zoneText = f.timeZoneName === "long" ? "Coordinated Universal Time" : "UTC";
    // A named zone is read as UTC on a date moved by its offset. The name of the
    // zone local time is in comes from the host as well.
    let moved = date;
    if (!utc) {
      const info = zoneInfo(zone === undefined ? "" : zone, time, f.timeZoneName === undefined ? "" : f.timeZoneName);
      const bar = builtins.indexOf(info, "|");
      if (info === "" || (f.timeZoneName !== undefined && bar === -1)) return undefined;
      if (zone !== undefined) {
        moved = new Date(time + builtins.number(bar === -1 ? info : builtins.slice(info, 0, bar)));
        if (builtins.getTime(moved) !== builtins.getTime(moved)) return undefined;
      }
      if (bar !== -1) zoneText = builtins.slice(info, bar + 1);
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
    if (c.year < 1 || c.year > 9999) return undefined;

    const dateParts = has(f, DATE_FIELDS) ? datePart(f, c) : [];
    const timeParts = has(f, ["hour", "minute", "second", "fractionalSecondDigits"])
      ? timePart(f, c, cycle, zoneText)
      : f.timeZoneName !== undefined ? [{ type: "timeZoneName", value: zoneText }] : [];
    if (dateParts.length === 0 || timeParts.length === 0) return builtins.concat(dateParts, timeParts);

    let glue = wanted;
    if (glue === undefined) {
      if (f.month === "long") glue = " at ";
      else if (f.month === undefined && f.day === undefined && f.year === undefined && f.hour !== undefined && f.timeZoneName === undefined) glue = " ";
      else glue = ", ";
    }
    return [...dateParts, { type: "literal", value: glue }, ...timeParts];
  }

  function format(date, method, locales, options) {
    const parts = layout(date, method, locales, options);
    return parts === undefined ? builtins.apply(engine[method], date, [locales, options]) : builtins.join(builtins.map(parts, (part) => part.value), "");
  }

  const methods = {
    toLocaleString(locales, options) {
      return format(this, "toLocaleString", locales, options);
    },
    toLocaleDateString(locales, options) {
      return format(this, "toLocaleDateString", locales, options);
    },
    toLocaleTimeString(locales, options) {
      return format(this, "toLocaleTimeString", locales, options);
    },
  };

  return {
    toLocaleString: methods.toLocaleString,
    toLocaleDateString: methods.toLocaleDateString,
    toLocaleTimeString: methods.toLocaleTimeString,
    // The parts Intl.DateTimeFormat writes with, for the method its options pick.
    partsOf(date, method, locales, options) {
      const parts = layout(date, method, locales, options);
      return parts === undefined ? [{ type: "literal", value: builtins.apply(engine[method], date, [locales, options]) }] : parts;
    },
    // The name of a zone as Intl spells it, which resolvedOptions reports.
    timeZoneId(zone) {
      return zoneInfo(zone, 0, "id");
    },
  };
})
