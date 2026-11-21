// Time zone data for the guest. The engine knows its own local zone and UTC and
// nothing else, so a program that asks for "Asia/Tokyo" would be answered in the
// zone of the machine. The host has the whole database in Intl, and what crosses
// is a zone name, a moment and a name style in, and a short string out.

const MAX_FORMATTERS = 64;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string, style: string): Intl.DateTimeFormat {
  const key = `${style}|${zone}`;
  let formatter = formatters.get(key);

  if (formatter === undefined) {
    // Spellings of one zone each take a place, so the table is kept small.
    if (formatters.size >= MAX_FORMATTERS) {
      formatters.clear();
    }
    formatter = new Intl.DateTimeFormat("en-US", {
      ...(zone === "" ? {} : { timeZone: zone }),
      ...(style === "" ? { hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" } : { hour: "numeric", timeZoneName: style }),
    } as Intl.DateTimeFormatOptions);
    formatters.set(key, formatter);
  }

  return formatter;
}

/**
 * How far the zone is ahead of UTC at a moment, in milliseconds, and when a
 * style of zone name is asked for, the name, after a bar: "14400000|GMT+4".
 * An empty zone is the zone of this process. An empty string says the zone is
 * not one that exists, or the moment is out of range. A zero offset is named
 * GMT+0 or GMT+00:00 in the offset styles, and in the generic styles for UTC,
 * as Node names it, whatever the host's data says.
 */
export function zoneInfo(zone: string, ms: number, style: string): string {
  try {
    const parts = formatterFor(zone, "").formatToParts(ms);
    const field = (type: string) => Number(parts.find((part) => part.type === type)?.value);

    // Date.UTC reads the years 0 to 99 as 1900 to 1999, so the year is set apart.
    const moment = new Date(0);
    moment.setUTCFullYear(field("year"), field("month") - 1, field("day"));
    moment.setUTCHours(field("hour") % 24, field("minute"), field("second"), 0);
    const offset = moment.getTime() - Math.floor(ms / 1000) * 1000;
    if (!Number.isFinite(offset)) {
      return "";
    }

    if (style === "") {
      return String(offset);
    }
    if (offset === 0 && (style === "shortOffset" || style === "longOffset" || (zone === "UTC" && style.endsWith("Generic")))) {
      return `${offset}|${style.startsWith("short") ? "GMT+0" : "GMT+00:00"}`;
    }
    const name = formatterFor(zone, style).formatToParts(ms).find((part) => part.type === "timeZoneName");

    return name === undefined ? "" : `${offset}|${name.value}`;
  } catch {
    return "";
  }
}
