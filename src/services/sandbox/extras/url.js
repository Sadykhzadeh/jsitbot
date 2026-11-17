// URL and URLSearchParams, for the guest. Evaluated the first time the code asks
// for one of them; see lazyGlobals in guest.js. The parser follows the WHATWG
// basic URL parser: special schemes, relative references against a base, dot
// segments, percent-encoding per component, IPv4 and IPv6 hosts, and host names
// in ASCII with non-ASCII labels written as punycode. The mapping of
// internationalised names is limited to compatibility normalisation, lower case
// and the ideographic full stops.
(function (register) {
  "use strict";

  const SPECIAL_PORTS = { http: "80", https: "443", ws: "80", wss: "443", ftp: "21", file: "" };

  function isSpecial(scheme) {
    return Object.prototype.hasOwnProperty.call(SPECIAL_PORTS, scheme);
  }

  function invalidUrl(input, base) {
    const error = new TypeError("Invalid URL");
    error.code = "ERR_INVALID_URL";
    error.input = String(input).toWellFormed();
    if (base !== undefined) error.base = String(base).toWellFormed();
    return error;
  }

  function hex(code) {
    return "%" + (code < 16 ? "0" : "") + code.toString(16).toUpperCase();
  }

  // Percent-encodes the characters that are outside printable ASCII, plus the
  // characters of `set`. A "%" already in the text is left alone.
  const SAFE_PATTERNS = new Map();

  function pct(text, set) {
    let pattern = SAFE_PATTERNS.get(set);
    if (pattern === undefined) {
      pattern = new RegExp("[\\u0000-\\u0020\\u007f-\\uffff" + set.replace(/[\\\]\[^-]/g, "\\$&") + "]");
      SAFE_PATTERNS.set(set, pattern);
    }
    if (!pattern.test(text)) return text;
    let out = "";
    for (const char of text) {
      const code = char.codePointAt(0);
      if (code >= 0x20 && code < 0x7f && set.indexOf(char) === -1) {
        out += char;
      } else if (code < 0x80) {
        out += hex(code);
      } else {
        out += encodeURIComponent(char);
      }
    }
    return out;
  }

  const FRAGMENT_SET = ' "<>`';
  const QUERY_SET = ' "#<>';
  const SPECIAL_QUERY_SET = ' "#<>\'';
  const PATH_SET = ' "#<>?`{}^';
  const USERINFO_SET = ' "#<>?`{}/:;=@[\\]^|';

  const isAlpha = (c) => c !== undefined && /^[a-zA-Z]$/.test(c);
  const isDigit = (c) => c !== undefined && /^[0-9]$/.test(c);
  const isHex = (c) => c !== undefined && /^[0-9a-fA-F]$/.test(c);
  const isWindowsDriveLetter = (text) => text.length === 2 && isAlpha(text[0]) && (text[1] === ":" || text[1] === "|");
  const isNormalizedDriveLetter = (text) => text.length === 2 && isAlpha(text[0]) && text[1] === ":";

  // The path segments of a parsed URL, which keeps its path as one string.
  function segmentsOf(record) {
    return record.path === "" ? [] : record.path.slice(1).split("/");
  }

  function startsWithDriveLetter(text, from) {
    if (text.length - from < 2 || !isAlpha(text[from]) || (text[from + 1] !== ":" && text[from + 1] !== "|")) return false;
    if (text.length - from === 2) return true;
    const third = text[from + 2];
    return third === "/" || third === "\\" || third === "?" || third === "#";
  }

  function isSingleDot(text) {
    return text === "." || (text[0] === "%" && text.toLowerCase() === "%2e");
  }

  function isDoubleDot(text) {
    if (text[0] !== "." && text[0] !== "%") return false;
    const lower = text.toLowerCase();
    return lower === ".." || lower === ".%2e" || lower === "%2e." || lower === "%2e%2e";
  }

  function shortenPath(url) {
    if (url.scheme === "file" && url.path.length === 1 && isNormalizedDriveLetter(url.path[0])) return;
    url.path.pop();
  }

  // Decodes a run of %XX escapes as UTF-8. A byte that does not start or continue a
  // character becomes U+FFFD, and a valid character is kept whole.
  function decodeRun(run) {
    try {
      return decodeURIComponent(run);
    } catch (error) {
      const bytes = run.match(/%[0-9a-fA-F]{2}/g).map((escape) => parseInt(escape.slice(1), 16));
      let out = "";
      for (let i = 0; i < bytes.length; ) {
        const first = bytes[i];
        const length = first < 0x80 ? 1 : first >= 0xc2 && first < 0xe0 ? 2 : first >= 0xe0 && first < 0xf0 ? 3 : first >= 0xf0 && first < 0xf5 ? 4 : 0;
        let whole = length > 0 && i + length <= bytes.length;
        for (let k = 1; whole && k < length; k++) if ((bytes[i + k] & 0xc0) !== 0x80) whole = false;
        if (whole && length > 1) {
          const piece = bytes.slice(i, i + length).map((byte) => "%" + byte.toString(16).padStart(2, "0")).join("");
          try {
            out += decodeURIComponent(piece);
            i += length;
            continue;
          } catch (inner) {
            // Not a character after all: the first byte is replaced below.
          }
        }
        out += length === 1 ? String.fromCharCode(first) : "�";
        i++;
      }
      return out;
    }
  }

  // Decodes the %XX escapes of a host name.
  function percentDecode(text) {
    return text.replace(/(?:%[0-9a-fA-F]{2})+/g, decodeRun);
  }

  // RFC 3492, for a label that is not ASCII.
  function punycode(input) {
    const base = 36;
    const tMin = 1;
    const tMax = 26;
    const skew = 38;
    const damp = 700;
    const codes = Array.from(input, (char) => char.codePointAt(0));
    let n = 128;
    let delta = 0;
    let bias = 72;
    let output = codes.filter((code) => code < 0x80).map((code) => String.fromCharCode(code)).join("");
    const basicCount = output.length;
    let handled = basicCount;
    if (basicCount > 0) output += "-";

    const digit = (value) => String.fromCharCode(value + 22 + 75 * (value < 26));
    const threshold = (k, current) => (k <= current ? tMin : k >= current + tMax ? tMax : k - current);
    const adapt = (change, count, first) => {
      let d = first ? Math.floor(change / damp) : Math.floor(change / 2);
      d += Math.floor(d / count);
      let k = 0;
      while (d > Math.floor(((base - tMin) * tMax) / 2)) {
        d = Math.floor(d / (base - tMin));
        k += base;
      }
      return k + Math.floor(((base - tMin + 1) * d) / (d + skew));
    };

    while (handled < codes.length) {
      let next = Infinity;
      for (const code of codes) if (code >= n && code < next) next = code;
      delta += (next - n) * (handled + 1);
      n = next;
      for (const code of codes) {
        if (code < n) delta++;
        if (code === n) {
          let q = delta;
          for (let k = base; ; k += base) {
            const t = threshold(k, bias);
            if (q < t) break;
            output += digit(t + ((q - t) % (base - t)));
            q = Math.floor((q - t) / (base - t));
          }
          output += digit(q);
          bias = adapt(delta, handled + 1, handled === basicCount);
          delta = 0;
          handled++;
        }
      }
      delta++;
      n++;
    }
    return output;
  }

  // Compatibility normalisation and lower case, the ideographic full stops as dots,
  // and punycode for labels that are not ASCII.
  function domainToAscii(domain) {
    return domain
      .replace(/[。．｡]/g, ".")
      .normalize("NFKC")
      .toLowerCase()
      .split(".")
      .map((label) => (/[^\x00-\x7f]/.test(label) ? "xn--" + punycode(label) : label))
      .join(".");
  }

  function parseIPv4Number(text) {
    if (text === "") return null;
    let radix = 10;
    let digits = text;
    if (digits.length >= 2 && (digits.startsWith("0x") || digits.startsWith("0X"))) {
      digits = digits.slice(2);
      radix = 16;
    } else if (digits.length >= 2 && digits.startsWith("0")) {
      digits = digits.slice(1);
      radix = 8;
    }
    if (digits === "") return 0;
    const valid = radix === 10 ? /^[0-9]+$/ : radix === 16 ? /^[0-9a-fA-F]+$/ : /^[0-7]+$/;
    return valid.test(digits) ? parseInt(digits, radix) : null;
  }

  function endsInNumber(host) {
    const parts = host.split(".");
    if (parts[parts.length - 1] === "") {
      if (parts.length === 1) return false;
      parts.pop();
    }
    const last = parts[parts.length - 1];
    if (/^[0-9]+$/.test(last)) return true;
    return parseIPv4Number(last) !== null;
  }

  function parseIPv4(host) {
    const parts = host.split(".");
    if (parts[parts.length - 1] === "" && parts.length > 1) parts.pop();
    if (parts.length > 4) return null;
    const numbers = [];
    for (const part of parts) {
      const value = parseIPv4Number(part);
      if (value === null) return null;
      numbers.push(value);
    }
    for (let i = 0; i < numbers.length - 1; i++) if (numbers[i] > 255) return null;
    if (numbers[numbers.length - 1] >= 256 ** (5 - numbers.length)) return null;
    let address = numbers[numbers.length - 1];
    for (let i = 0; i < numbers.length - 1; i++) address += numbers[i] * 256 ** (3 - i);
    const octets = [];
    for (let i = 0; i < 4; i++) {
      octets.unshift(address % 256);
      address = Math.floor(address / 256);
    }
    return octets.join(".");
  }

  function parseIPv6(input) {
    const address = [0, 0, 0, 0, 0, 0, 0, 0];
    let pieceIndex = 0;
    let compress = null;
    let p = 0;

    if (input[0] === ":") {
      if (input[1] !== ":") return null;
      p += 2;
      pieceIndex++;
      compress = pieceIndex;
    }
    while (p < input.length) {
      if (pieceIndex === 8) return null;
      if (input[p] === ":") {
        if (compress !== null) return null;
        p++;
        pieceIndex++;
        compress = pieceIndex;
        continue;
      }
      let value = 0;
      let length = 0;
      while (length < 4 && isHex(input[p])) {
        value = value * 16 + parseInt(input[p], 16);
        p++;
        length++;
      }
      if (input[p] === ".") {
        if (length === 0) return null;
        p -= length;
        if (pieceIndex > 6) return null;
        let numbersSeen = 0;
        while (p < input.length) {
          let piece = null;
          if (numbersSeen > 0) {
            if (input[p] === "." && numbersSeen < 4) p++;
            else return null;
          }
          if (!isDigit(input[p])) return null;
          while (isDigit(input[p])) {
            const digit = parseInt(input[p], 10);
            if (piece === null) piece = digit;
            else if (piece === 0) return null;
            else piece = piece * 10 + digit;
            if (piece > 255) return null;
            p++;
          }
          address[pieceIndex] = address[pieceIndex] * 0x100 + piece;
          numbersSeen++;
          if (numbersSeen === 2 || numbersSeen === 4) pieceIndex++;
        }
        if (numbersSeen !== 4) return null;
        break;
      } else if (input[p] === ":") {
        p++;
        if (p >= input.length) return null;
      } else if (p < input.length) {
        return null;
      }
      address[pieceIndex] = value;
      pieceIndex++;
    }
    if (compress !== null) {
      let swaps = pieceIndex - compress;
      pieceIndex = 7;
      while (pieceIndex !== 0 && swaps > 0) {
        const other = compress + swaps - 1;
        const kept = address[pieceIndex];
        address[pieceIndex] = address[other];
        address[other] = kept;
        pieceIndex--;
        swaps--;
      }
    } else if (pieceIndex !== 8) {
      return null;
    }

    let bestStart = -1;
    let bestLength = 0;
    for (let i = 0; i < 8; ) {
      if (address[i] !== 0) {
        i++;
        continue;
      }
      let j = i;
      while (j < 8 && address[j] === 0) j++;
      if (j - i > bestLength && j - i > 1) {
        bestStart = i;
        bestLength = j - i;
      }
      i = j;
    }
    let out = "";
    let skipping = false;
    for (let i = 0; i < 8; i++) {
      if (skipping && address[i] === 0) continue;
      skipping = false;
      if (bestStart === i) {
        out += i === 0 ? "::" : ":";
        skipping = true;
        continue;
      }
      out += address[i].toString(16);
      if (i !== 7) out += ":";
    }
    return out;
  }

  const FORBIDDEN_HOST = /[\u0000\t\n\r #\/:<>?@\[\\\]^|]/;
  const FORBIDDEN_DOMAIN = /[\u0000-\u001f #%\/:<>?@\[\\\]^|\u007f]/;

  // The host of a URL as it is written in the serialised form, or null when the text is not a host.
  function parseHost(input, opaque) {
    if (input.startsWith("[")) {
      if (!input.endsWith("]")) return null;
      const address = parseIPv6(input.slice(1, -1));
      return address === null ? null : "[" + address + "]";
    }
    if (opaque) return FORBIDDEN_HOST.test(input) ? null : pct(input, "");

    const domain = percentDecode(input);
    if (domain.indexOf("�") !== -1) return null;
    const ascii = /^[a-zA-Z0-9.-]+$/.test(domain) ? domain.toLowerCase() : domainToAscii(domain);
    if (FORBIDDEN_DOMAIN.test(ascii)) return null;
    if (endsInNumber(ascii)) return parseIPv4(ascii);
    return ascii;
  }

  // The path a pathname setter gives a URL, serialised as the parser keeps it.
  function pathOf(text, special) {
    const body = text.replace(/[\t\n\r]/g, "");
    if (!special && body === "") return "";
    const parts = (special ? body.replace(/\\/g, "/") : body).split("/");
    if (parts[0] === "" && parts.length > 1) parts.shift();
    const segments = [];
    parts.forEach((part, index) => {
      const last = index === parts.length - 1;
      if (isDoubleDot(part)) {
        segments.pop();
        if (last) segments.push("");
      } else if (isSingleDot(part)) {
        if (last) segments.push("");
      } else {
        segments.push(pct(part, PATH_SET));
      }
    });
    return segments.map((segment) => "/" + segment).join("");
  }

  // Runs of characters that no state treats one by one, so that a long host or path
  // is read in a few steps. Each one is sticky and matches from the position it is given.
  const RUN_AUTHORITY = /[^@\/?#]*/y;
  const RUN_AUTHORITY_SPECIAL = /[^@\/?#\\]*/y;
  const RUN_HOST = /[^:\/?#\\\[\]]*/y;
  const RUN_PORT = /[0-9]*/y;
  const RUN_PATH = /[^\/?#]*/y;
  const RUN_PATH_SPECIAL = /[^\/\\?#]*/y;
  const RUN_OPAQUE = /[^?#]*/y;
  const RUN_QUERY = /[^#]*/y;
  const RUN_FILE_HOST = /[^\/\\?#]*/y;

  // The end of the run that `run` matches at `from`, and at least one character on.
  function runEnd(run, text, from) {
    run.lastIndex = from;
    run.exec(text);
    return Math.max(run.lastIndex, from + 1);
  }

  // The states of the basic URL parser, as numbers: a switch on strings is slow in the engine.
  const ST_SCHEME_START = 0,
    ST_SCHEME = 1,
    ST_NO_SCHEME = 2,
    ST_SPECIAL_RELATIVE_OR_AUTHORITY = 3,
    ST_PATH_OR_AUTHORITY = 4,
    ST_RELATIVE = 5,
    ST_RELATIVE_SLASH = 6,
    ST_SPECIAL_AUTHORITY_SLASHES = 7,
    ST_SPECIAL_AUTHORITY_IGNORE_SLASHES = 8,
    ST_AUTHORITY = 9,
    ST_HOST = 10,
    ST_PORT = 11,
    ST_FILE = 12,
    ST_FILE_SLASH = 13,
    ST_FILE_HOST = 14,
    ST_PATH_START = 15,
    ST_PATH = 16,
    ST_OPAQUE_PATH = 17,
    ST_QUERY = 18,
    ST_FRAGMENT = 19;

  // The basic URL parser. Returns the record of the URL, or null when the input is not a URL.
  function parse(input, base) {
    const raw = String(input).toWellFormed();
    let start = 0;
    let end = raw.length;
    while (start < end && raw.charCodeAt(start) <= 0x20) start++;
    while (end > start && raw.charCodeAt(end - 1) <= 0x20) end--;
    const text = raw.slice(start, end).replace(/[\t\n\r]/g, "");
    const url = {
      scheme: "", username: "", password: "", host: null, port: "", path: [], opaque: false, query: null, fragment: null,
    };
    let state = ST_SCHEME_START;
    let buffer = "";
    let atSignSeen = false;
    let passwordSeen = false;
    let insideBrackets = false;

    let special = false;
    for (let p = 0; ; ) {
      const c = text[p];
      const ends = c === undefined || c === "/" || c === "?" || c === "#" || (special && c === "\\");

      switch (state) {
        case ST_SCHEME_START:
          if (isAlpha(c)) {
            buffer += c.toLowerCase();
            state = ST_SCHEME;
          } else {
            state = ST_NO_SCHEME;
            p--;
          }
          break;

        case ST_SCHEME:
          if (c !== undefined && /^[a-zA-Z0-9+\-.]$/.test(c)) {
            buffer += c.toLowerCase();
          } else if (c === ":") {
            url.scheme = buffer;
            special = isSpecial(url.scheme);
            buffer = "";
            if (url.scheme === "file") {
              state = ST_FILE;
            } else if (isSpecial(url.scheme) && base && base.scheme === url.scheme) {
              state = ST_SPECIAL_RELATIVE_OR_AUTHORITY;
            } else if (isSpecial(url.scheme)) {
              state = ST_SPECIAL_AUTHORITY_SLASHES;
            } else if (text[p + 1] === "/") {
              state = ST_PATH_OR_AUTHORITY;
              p++;
            } else {
              url.opaque = true;
              url.path = "";
              state = ST_OPAQUE_PATH;
            }
          } else {
            buffer = "";
            state = ST_NO_SCHEME;
            p = -1;
          }
          break;

        case ST_NO_SCHEME:
          if (!base || (base.opaque && c !== "#")) return null;
          if (base.opaque) {
            url.scheme = base.scheme;
            special = isSpecial(url.scheme);
            url.opaque = true;
            url.path = base.path;
            url.query = base.query;
            url.fragment = "";
            state = ST_FRAGMENT;
          } else if (base.scheme !== "file") {
            state = ST_RELATIVE;
            p--;
          } else {
            state = ST_FILE;
            p--;
          }
          break;

        case ST_SPECIAL_RELATIVE_OR_AUTHORITY:
          if (c === "/" && text[p + 1] === "/") {
            state = ST_SPECIAL_AUTHORITY_IGNORE_SLASHES;
            p++;
          } else {
            state = ST_RELATIVE;
            p--;
          }
          break;

        case ST_PATH_OR_AUTHORITY:
          if (c === "/") {
            state = ST_AUTHORITY;
          } else {
            state = ST_PATH;
            p--;
          }
          break;

        case ST_RELATIVE:
          url.scheme = base.scheme;
          special = isSpecial(url.scheme);
          if (c === "/" || (special && c === "\\")) {
            state = ST_RELATIVE_SLASH;
          } else {
            url.username = base.username;
            url.password = base.password;
            url.host = base.host;
            url.port = base.port;
            url.path = segmentsOf(base);
            url.query = base.query;
            if (c === "?") {
              url.query = "";
              state = ST_QUERY;
            } else if (c === "#") {
              url.fragment = "";
              state = ST_FRAGMENT;
            } else if (c !== undefined) {
              url.query = null;
              shortenPath(url);
              state = ST_PATH;
              p--;
            }
          }
          break;

        case ST_RELATIVE_SLASH:
          if (special && (c === "/" || c === "\\")) {
            state = ST_SPECIAL_AUTHORITY_IGNORE_SLASHES;
          } else if (c === "/") {
            state = ST_AUTHORITY;
          } else {
            url.username = base.username;
            url.password = base.password;
            url.host = base.host;
            url.port = base.port;
            state = ST_PATH;
            p--;
          }
          break;

        case ST_SPECIAL_AUTHORITY_SLASHES:
          if (c === "/" && text[p + 1] === "/") p++;
          else p--;
          state = ST_SPECIAL_AUTHORITY_IGNORE_SLASHES;
          break;

        case ST_SPECIAL_AUTHORITY_IGNORE_SLASHES:
          if (c !== "/" && c !== "\\") {
            state = ST_AUTHORITY;
            p--;
          }
          break;

        case ST_AUTHORITY:
          if (c === "@") {
            if (atSignSeen) buffer = "%40" + buffer;
            atSignSeen = true;
            const colon = passwordSeen ? -1 : buffer.indexOf(":");
            if (colon !== -1) {
              url.username += pct(buffer.slice(0, colon), USERINFO_SET);
              url.password += pct(buffer.slice(colon + 1), USERINFO_SET);
              passwordSeen = true;
            } else if (passwordSeen) {
              url.password += pct(buffer, USERINFO_SET);
            } else {
              url.username += pct(buffer, USERINFO_SET);
            }
            buffer = "";
          } else if (ends) {
            if (atSignSeen && buffer === "") return null;
            p -= buffer.length + 1;
            buffer = "";
            state = ST_HOST;
          } else {
            const next = runEnd(special ? RUN_AUTHORITY_SPECIAL : RUN_AUTHORITY, text, p);
            buffer += text.slice(p, next);
            p = next - 1;
          }
          break;

        case ST_HOST:
          if (c === ":" && !insideBrackets) {
            if (buffer === "") return null;
            const host = parseHost(buffer, !special);
            if (host === null) return null;
            url.host = host;
            buffer = "";
            state = ST_PORT;
          } else if (ends) {
            p--;
            if (special && buffer === "") return null;
            const host = parseHost(buffer, !special);
            if (host === null) return null;
            url.host = host;
            buffer = "";
            state = ST_PATH_START;
          } else if (c === "[" || c === "]") {
            insideBrackets = c === "[";
            buffer += c;
          } else {
            const next = runEnd(RUN_HOST, text, p);
            buffer += text.slice(p, next);
            p = next - 1;
          }
          break;

        case ST_PORT:
          if (isDigit(c)) {
            const next = runEnd(RUN_PORT, text, p);
            buffer += text.slice(p, next);
            p = next - 1;
          } else if (ends) {
            if (buffer !== "") {
              const port = parseInt(buffer, 10);
              if (port > 65535) return null;
              url.port = String(port) === SPECIAL_PORTS[url.scheme] ? "" : String(port);
              buffer = "";
            }
            state = ST_PATH_START;
            p--;
          } else {
            return null;
          }
          break;

        case ST_FILE:
          url.scheme = "file";
          special = true;
          url.host = "";
          if (c === "/" || c === "\\") {
            state = ST_FILE_SLASH;
          } else if (base && base.scheme === "file") {
            url.host = base.host;
            url.path = segmentsOf(base);
            url.query = base.query;
            if (c === "?") {
              url.query = "";
              state = ST_QUERY;
            } else if (c === "#") {
              url.fragment = "";
              state = ST_FRAGMENT;
            } else if (c !== undefined) {
              url.query = null;
              if (!startsWithDriveLetter(text, p)) shortenPath(url);
              else url.path = [];
              state = ST_PATH;
              p--;
            }
          } else {
            state = ST_PATH;
            p--;
          }
          break;

        case ST_FILE_SLASH:
          if (c === "/" || c === "\\") {
            state = ST_FILE_HOST;
          } else {
            if (base && base.scheme === "file") {
              url.host = base.host;
              const first = segmentsOf(base)[0];
              if (!startsWithDriveLetter(text, p) && first !== undefined && isNormalizedDriveLetter(first)) {
                url.path.push(first);
              }
            }
            state = ST_PATH;
            p--;
          }
          break;

        case ST_FILE_HOST:
          if (ends) {
            p--;
            if (isWindowsDriveLetter(buffer)) {
              state = ST_PATH;
            } else if (buffer === "") {
              url.host = "";
              state = ST_PATH_START;
            } else {
              let host = parseHost(buffer, false);
              if (host === null) return null;
              if (host === "localhost") host = "";
              url.host = host;
              buffer = "";
              state = ST_PATH_START;
            }
          } else {
            const next = runEnd(RUN_FILE_HOST, text, p);
            buffer += text.slice(p, next);
            p = next - 1;
          }
          break;

        case ST_PATH_START:
          if (special) {
            state = ST_PATH;
            if (c !== "/" && c !== "\\") p--;
          } else if (c === "?") {
            url.query = "";
            state = ST_QUERY;
          } else if (c === "#") {
            url.fragment = "";
            state = ST_FRAGMENT;
          } else if (c !== undefined) {
            state = ST_PATH;
            if (c !== "/") p--;
          }
          break;

        case ST_PATH: {
          if (ends) {
            const slashLike = c === "/" || (special && c === "\\");
            if (isDoubleDot(buffer)) {
              shortenPath(url);
              if (!slashLike) url.path.push("");
            } else if (isSingleDot(buffer)) {
              if (!slashLike) url.path.push("");
            } else {
              const segment = pct(buffer, PATH_SET);
              if (url.scheme === "file" && url.path.length === 0 && isWindowsDriveLetter(segment)) {
                url.path.push(segment[0] + ":");
              } else {
                url.path.push(segment);
              }
            }
            buffer = "";
            if (c === "?") {
              url.query = "";
              state = ST_QUERY;
            }
            if (c === "#") {
              url.fragment = "";
              state = ST_FRAGMENT;
            }
          } else {
            const next = runEnd(special ? RUN_PATH_SPECIAL : RUN_PATH, text, p);
            buffer += text.slice(p, next);
            p = next - 1;
          }
          break;
        }

        case ST_OPAQUE_PATH:
          if (c === "?") {
            url.query = "";
            state = ST_QUERY;
          } else if (c === "#") {
            url.fragment = "";
            state = ST_FRAGMENT;
          } else if (c !== undefined) {
            const next = runEnd(RUN_OPAQUE, text, p);
            url.path += pct(text.slice(p, next), "");
            p = next - 1;
          }
          break;

        case ST_QUERY:
          if (c === "#" || c === undefined) {
            url.query += pct(buffer, special ? SPECIAL_QUERY_SET : QUERY_SET);
            buffer = "";
            if (c === "#") {
              url.fragment = "";
              state = ST_FRAGMENT;
            }
          } else {
            const next = runEnd(RUN_QUERY, text, p);
            buffer += text.slice(p, next);
            p = next - 1;
          }
          break;

        case ST_FRAGMENT:
          if (c !== undefined) {
            url.fragment += pct(text.slice(p), FRAGMENT_SET);
            p = text.length;
          }
          break;
      }

      if (p >= text.length) break;
      p++;
    }

    return {
      scheme: url.scheme,
      username: url.username,
      password: url.password,
      host: url.host,
      port: url.port,
      opaque: url.opaque,
      path: url.opaque ? url.path : url.path.map((segment) => "/" + segment).join(""),
      query: url.query,
      fragment: url.fragment,
    };
  }

  // The origin of a blob URL is the origin of the URL after "blob:", when that is http or https.
  function originOf(record) {
    let source = record;
    if (record.scheme === "blob") {
      source = parse(record.path);
      if (source === null || (source.scheme !== "http" && source.scheme !== "https")) return "null";
    }
    if (!isSpecial(source.scheme) || source.scheme === "file") return "null";
    return source.scheme + "://" + source.host + (source.port !== "" ? ":" + source.port : "");
  }

  function serialize(record) {
    let out = record.scheme + ":";
    if (record.host !== null) {
      out += "//";
      if (record.username !== "" || record.password !== "") {
        out += record.username + (record.password !== "" ? ":" + record.password : "") + "@";
      }
      out += record.host + (record.port !== "" ? ":" + record.port : "");
    } else if (!record.opaque && record.path.startsWith("//")) {
      out += "/.";
    }
    out += record.path;
    if (record.query !== null) out += "?" + record.query;
    if (record.fragment !== null) out += "#" + record.fragment;
    return out;
  }

  // URLSearchParams ----------------------------------------------------------

  const lists = new WeakMap();
  const links = new WeakMap();

  function formEncode(text) {
    return encodeURIComponent(String(text).toWellFormed())
      .replace(/[!'()~]/g, (char) => hex(char.charCodeAt(0)))
      .replace(/%20/g, "+");
  }

  function formDecode(text) {
    return text.replace(/\+/g, " ").replace(/(?:%[0-9a-fA-F]{2})+/g, decodeRun);
  }

  function parseQuery(text) {
    const list = [];
    for (const piece of text.split("&")) {
      if (piece === "") continue;
      const equals = piece.indexOf("=");
      list.push(
        equals === -1
          ? [formDecode(piece), ""]
          : [formDecode(piece.slice(0, equals)), formDecode(piece.slice(equals + 1))],
      );
    }
    return list;
  }

  function changed(params) {
    const link = links.get(params);
    if (link) link(params.toString());
  }

  class URLSearchParams {
    constructor(init) {
      let list = [];

      if (init === undefined || init === null) {
        list = [];
      } else if (typeof init === "object" || typeof init === "function") {
        if (init instanceof URLSearchParams) {
          list = lists.get(init).map((pair) => [pair[0], pair[1]]);
        } else if (typeof init[Symbol.iterator] === "function") {
          for (const pair of init) {
            const items = Array.from(pair);
            if (items.length !== 2) {
              throw new TypeError("Each query pair must be an iterable [name, value] tuple");
            }
            list.push([String(items[0]).toWellFormed(), String(items[1]).toWellFormed()]);
          }
        } else {
          for (const key of Object.keys(init)) {
            list.push([key.toWellFormed(), String(init[key]).toWellFormed()]);
          }
        }
      } else {
        const text = String(init);
        list = parseQuery(text.startsWith("?") ? text.slice(1) : text);
      }

      lists.set(this, list);
    }

    get size() {
      return lists.get(this).length;
    }

    append(name, value) {
      if (arguments.length < 2) throw new TypeError("The name and value arguments are required");
      lists.get(this).push([String(name).toWellFormed(), String(value).toWellFormed()]);
      changed(this);
    }

    delete(name, value) {
      if (arguments.length < 1) throw new TypeError("The name argument is required");
      const key = String(name).toWellFormed();
      const wanted = value === undefined ? undefined : String(value).toWellFormed();
      lists.set(this, lists.get(this).filter((pair) => !(pair[0] === key && (wanted === undefined || pair[1] === wanted))));
      changed(this);
    }

    get(name) {
      if (arguments.length < 1) throw new TypeError("The name argument is required");
      const key = String(name).toWellFormed();
      const found = lists.get(this).find((pair) => pair[0] === key);
      return found === undefined ? null : found[1];
    }

    getAll(name) {
      if (arguments.length < 1) throw new TypeError("The name argument is required");
      const key = String(name).toWellFormed();
      return lists.get(this).filter((pair) => pair[0] === key).map((pair) => pair[1]);
    }

    has(name, value) {
      if (arguments.length < 1) throw new TypeError("The name argument is required");
      const key = String(name).toWellFormed();
      const wanted = value === undefined ? undefined : String(value).toWellFormed();
      return lists.get(this).some((pair) => pair[0] === key && (wanted === undefined || pair[1] === wanted));
    }

    set(name, value) {
      if (arguments.length < 2) throw new TypeError("The name and value arguments are required");
      const key = String(name).toWellFormed();
      const text = String(value).toWellFormed();
      const list = lists.get(this);
      const first = list.findIndex((pair) => pair[0] === key);

      if (first === -1) {
        list.push([key, text]);
      } else {
        list[first][1] = text;
        lists.set(this, list.filter((pair, index) => index <= first || pair[0] !== key));
      }
      changed(this);
    }

    sort() {
      const list = lists.get(this);
      const order = list.map((pair, index) => [pair, index]);
      order.sort((a, b) => (a[0][0] < b[0][0] ? -1 : a[0][0] > b[0][0] ? 1 : a[1] - b[1]));
      lists.set(this, order.map((entry) => entry[0]));
      changed(this);
    }

    forEach(callback, thisArg) {
      if (typeof callback !== "function") throw new TypeError("The callback must be a function");
      for (const pair of lists.get(this).slice()) {
        callback.call(thisArg, pair[1], pair[0], this);
      }
    }

    keys() {
      return lists.get(this).map((pair) => pair[0])[Symbol.iterator]();
    }

    values() {
      return lists.get(this).map((pair) => pair[1])[Symbol.iterator]();
    }

    entries() {
      return lists.get(this).map((pair) => [pair[0], pair[1]])[Symbol.iterator]();
    }

    [Symbol.iterator]() {
      return this.entries();
    }

    toString() {
      return lists.get(this).map((pair) => formEncode(pair[0]) + "=" + formEncode(pair[1])).join("&");
    }
  }

  Object.defineProperty(URLSearchParams.prototype, Symbol.toStringTag, { value: "URLSearchParams", configurable: true });

  // URL ----------------------------------------------------------------------

  class URL {
    #record;
    #params = null;

    constructor(url, base) {
      if (arguments.length === 0) throw new TypeError("The url argument is required");
      let baseRecord;
      if (base !== undefined) {
        baseRecord = parse(base);
        if (baseRecord === null) throw invalidUrl(url, base);
      }
      const record = parse(url, baseRecord);
      if (record === null) throw invalidUrl(url, base);
      this.#record = record;
    }

    static canParse(url, base) {
      try {
        new URL(url, base);
        return true;
      } catch (error) {
        return false;
      }
    }

    static parse(url, base) {
      try {
        return new URL(url, base);
      } catch (error) {
        return null;
      }
    }

    #update(changes) {
      this.#record = Object.assign({}, this.#record, changes);
    }

    #resetParams() {
      if (this.#params === null) return;
      const query = this.#record.query;
      lists.set(this.#params, parseQuery(query === null ? "" : query));
    }

    get href() {
      return serialize(this.#record);
    }

    set href(value) {
      const record = parse(value);
      if (record === null) throw invalidUrl(value);
      this.#record = record;
      this.#resetParams();
    }

    get origin() {
      return originOf(this.#record);
    }

    get protocol() {
      return this.#record.scheme + ":";
    }

    set protocol(value) {
      const match = /^([a-zA-Z][a-zA-Z0-9+.\-]*):?/.exec(String(value));
      if (!match) return;
      const scheme = match[1].toLowerCase();
      if (isSpecial(scheme) !== isSpecial(this.#record.scheme) || this.#record.opaque) return;
      if (this.#record.scheme === "file" && this.#record.host === "") return;
      if (scheme === "file" && (this.#record.username !== "" || this.#record.password !== "" || this.#record.port !== "")) return;
      this.#update({
        scheme,
        port: this.#record.port === SPECIAL_PORTS[scheme] ? "" : this.#record.port,
      });
    }

    get username() {
      return this.#record.username;
    }

    set username(value) {
      if (this.#record.host === null || this.#record.host === "" || this.#record.scheme === "file") return;
      this.#update({ username: pct(String(value), USERINFO_SET) });
    }

    get password() {
      return this.#record.password;
    }

    set password(value) {
      if (this.#record.host === null || this.#record.host === "" || this.#record.scheme === "file") return;
      this.#update({ password: pct(String(value), USERINFO_SET) });
    }

    get host() {
      const record = this.#record;
      return record.host === null ? "" : record.host + (record.port !== "" ? ":" + record.port : "");
    }

    set host(value) {
      const record = this.#record;
      if (record.opaque) return;
      const special = isSpecial(record.scheme);
      const text = String(value).replace(/[\t\n\r]/g, "");
      const end = text.search(special ? /[\/\\?#]/ : /[\/?#]/);
      const authority = end === -1 ? text : text.slice(0, end);
      const colon = authority.lastIndexOf(":");
      const hasPort = colon > authority.lastIndexOf("]");
      const hostText = hasPort ? authority.slice(0, colon) : authority;
      if (hostText === "" && special) return;
      const host = hostText === "" ? "" : parseHost(hostText, !special);
      if (host === null) return;
      this.#update({ host: record.scheme === "file" && host === "localhost" ? "" : host });
      const digits = hasPort ? /^[0-9]+/.exec(authority.slice(colon + 1)) : null;
      if (digits === null) return;
      const number = parseInt(digits[0], 10);
      if (number > 65535) return;
      this.#update({ port: String(number) === SPECIAL_PORTS[record.scheme] ? "" : String(number) });
    }

    get hostname() {
      return this.#record.host === null ? "" : this.#record.host;
    }

    set hostname(value) {
      const record = this.#record;
      if (record.opaque) return;
      const special = isSpecial(record.scheme);
      const text = String(value).replace(/[\t\n\r]/g, "");
      const end = text.search(special ? /[\/\\?#:]/ : /[\/?#:]/);
      if (end !== -1 && text[end] === ":") return;
      const hostText = end === -1 ? text : text.slice(0, end);
      if (hostText === "" && special) return;
      const host = hostText === "" ? "" : parseHost(hostText, !special);
      if (host !== null) this.#update({ host: record.scheme === "file" && host === "localhost" ? "" : host });
    }

    get port() {
      return this.#record.port;
    }

    set port(value) {
      const record = this.#record;
      if (record.host === null || record.host === "" || record.scheme === "file") return;
      const text = String(value);
      if (text === "") {
        this.#update({ port: "" });
        return;
      }
      const digits = /^[0-9]+/.exec(text);
      if (!digits || Number(digits[0]) > 65535) return;
      const port = String(Number(digits[0]));
      this.#update({ port: port === SPECIAL_PORTS[record.scheme] ? "" : port });
    }

    get pathname() {
      return this.#record.path;
    }

    set pathname(value) {
      if (this.#record.opaque) return;
      this.#update({ path: pathOf(String(value), isSpecial(this.#record.scheme)) });
    }

    get search() {
      const query = this.#record.query;
      return query === null || query === "" ? "" : "?" + query;
    }

    set search(value) {
      const text = String(value);
      const query = text === "" ? null : pct(text.startsWith("?") ? text.slice(1) : text, isSpecial(this.#record.scheme) ? SPECIAL_QUERY_SET : QUERY_SET);
      this.#update({ query });
      this.#resetParams();
    }

    get searchParams() {
      if (this.#params === null) {
        const params = new URLSearchParams(this.#record.query === null ? "" : this.#record.query);
        links.set(params, (query) => {
          this.#record = Object.assign({}, this.#record, { query: query === "" ? null : query });
        });
        this.#params = params;
      }
      return this.#params;
    }

    get hash() {
      const fragment = this.#record.fragment;
      return fragment === null || fragment === "" ? "" : "#" + fragment;
    }

    set hash(value) {
      const text = String(value);
      this.#update({ fragment: text === "" ? null : pct(text.startsWith("#") ? text.slice(1) : text, FRAGMENT_SET) });
    }

    toString() {
      return this.href;
    }

    toJSON() {
      return this.href;
    }
  }

  Object.defineProperty(URL.prototype, Symbol.toStringTag, { value: "URL", configurable: true });

  register(URLSearchParams, function (params) {
    return { entries: lists.get(params), map: true };
  });
  const readHref = Object.getOwnPropertyDescriptor(URL.prototype, "href").get;

  register(URL, function (url) {
    // Throws for anything that is not a real URL, such as a proxy that says it is.
    readHref.call(url);
    return {
      entries: [
        ["href", url.href],
        ["origin", url.origin],
        ["protocol", url.protocol],
        ["username", url.username],
        ["password", url.password],
        ["host", url.host],
        ["hostname", url.hostname],
        ["port", url.port],
        ["pathname", url.pathname],
        ["search", url.search],
        ["searchParams", url.searchParams],
        ["hash", url.hash],
      ],
      map: false,
    };
  });

  return { URL, URLSearchParams };
})
