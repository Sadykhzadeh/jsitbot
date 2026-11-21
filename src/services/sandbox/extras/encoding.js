// TextEncoder, TextDecoder, atob and btoa, for the guest. Evaluated the first
// time the code asks for one of them; see lazyGlobals in guest.js.
(function (register, seed, host, builtins) {
  "use strict";

  const REPLACEMENT = 0xfffd;

  // An error of the kind Node throws, with the code it sets on it.
  function nodeError(Type, code, message) {
    const error = new Type(message);
    error.code = code;
    return error;
  }

  function argumentError(name, expected, value) {
    let received;
    if (value === undefined || value === null) {
      received = "Received " + value;
    } else if (typeof value === "object" || typeof value === "function") {
      received = "Received an instance of " + (value.constructor && value.constructor.name ? value.constructor.name : "Object");
    } else {
      received = "Received type " + typeof value + " (" + builtins.string(value) + ")";
    }
    return nodeError(TypeError, "ERR_INVALID_ARG_TYPE", 'The "' + name + '" argument must be ' + expected + ". " + received);
  }

  function domError(message) {
    return new (host.extra("events").DOMException)(message, "InvalidCharacterError");
  }

  // The UTF-8 bytes of a string, as many as fit in `limit` when it is given.
  // A lone surrogate becomes U+FFFD, as it does in a browser.
  function encode(text, target, limit) {
    let written = 0;
    let read = 0;

    for (let i = 0; i < text.length; ) {
      let code = builtins.charCodeAt(text, i);
      let units = 1;
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        const next = builtins.charCodeAt(text, i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
          units = 2;
        }
      }
      if (code >= 0xd800 && code <= 0xdfff) code = REPLACEMENT;

      const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      if (written + size > limit) break;

      if (size === 1) {
        target[written++] = code;
      } else if (size === 2) {
        target[written++] = 0xc0 | (code >> 6);
        target[written++] = 0x80 | (code & 0x3f);
      } else if (size === 3) {
        target[written++] = 0xe0 | (code >> 12);
        target[written++] = 0x80 | ((code >> 6) & 0x3f);
        target[written++] = 0x80 | (code & 0x3f);
      } else {
        target[written++] = 0xf0 | (code >> 18);
        target[written++] = 0x80 | ((code >> 12) & 0x3f);
        target[written++] = 0x80 | ((code >> 6) & 0x3f);
        target[written++] = 0x80 | (code & 0x3f);
      }
      i += units;
      read += units;
    }

    return { read, written };
  }

  class TextEncoder {
    get encoding() {
      return "utf-8";
    }

    get [Symbol.toStringTag]() {
      return "TextEncoder";
    }

    encode(input = "") {
      const text = builtins.string(input);
      const bytes = new Uint8Array(text.length * 3);
      const { written } = encode(text, bytes, bytes.length);

      return bytes.slice(0, written);
    }

    encodeInto(source, destination) {
      if (!(destination instanceof Uint8Array)) {
        throw argumentError("dest", "an instance of Uint8Array", destination);
      }
      return encode(builtins.string(source), destination, destination.length);
    }
  }

  function bytesOf(input) {
    if (input === undefined) return new Uint8Array(0);
    if (input instanceof ArrayBuffer || (typeof SharedArrayBuffer === "function" && input instanceof SharedArrayBuffer)) {
      return new Uint8Array(input);
    }
    if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    throw nodeError(
      TypeError,
      "ERR_INVALID_ARG_TYPE",
      'The "list" argument must be an instance of SharedArrayBuffer, ArrayBuffer or ArrayBufferView.',
    );
  }

  // The decoder of the Encoding Standard: an invalid sequence gives one U+FFFD
  // for the bytes that were valid so far, and decoding goes on at the byte that
  // broke it. With `stream`, a sequence that the bytes end in the middle of is
  // not an error yet: its start is given back as `rest`, for the next chunk.
  function decode(bytes, fatal, dropBom, stream, label = "utf-8") {
    const units = [];
    const pieces = [];
    let i = 0;
    let rest = null;

    function flush() {
      builtins.push(pieces, builtins.apply(builtins.fromCharCode, null, units));
      units.length = 0;
    }

    function invalid() {
      if (fatal) throw nodeError(TypeError, "ERR_ENCODING_INVALID_ENCODED_DATA", "The encoded data was not valid for encoding " + label);
      builtins.push(units, REPLACEMENT);
    }

    if (dropBom && bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;

    while (i < bytes.length) {
      const start = i;
      const first = bytes[i++];
      if (first < 0x80) {
        builtins.push(units, first);
      } else {
        let needed = 0;
        let code = 0;
        let lower = 0x80;
        let upper = 0xbf;
        if (first >= 0xc2 && first <= 0xdf) {
          needed = 1;
          code = first & 0x1f;
        } else if (first >= 0xe0 && first <= 0xef) {
          needed = 2;
          code = first & 0xf;
          if (first === 0xe0) lower = 0xa0;
          if (first === 0xed) upper = 0x9f;
        } else if (first >= 0xf0 && first <= 0xf4) {
          needed = 3;
          code = first & 0x7;
          if (first === 0xf0) lower = 0x90;
          if (first === 0xf4) upper = 0x8f;
        }

        if (needed === 0) {
          invalid();
        } else {
          let complete = true;
          for (let seen = 0; seen < needed; seen++) {
            if (i >= bytes.length && stream) {
              rest = bytes.slice(start);
              break;
            }
            if (i >= bytes.length || bytes[i] < lower || bytes[i] > upper) {
              complete = false;
              break;
            }
            code = (code << 6) | (bytes[i++] & 0x3f);
            lower = 0x80;
            upper = 0xbf;
          }
          if (rest) {
            break;
          } else if (!complete) {
            invalid();
          } else if (code >= 0x10000) {
            builtins.push(units, 0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff));
          } else {
            builtins.push(units, code);
          }
        }
      }
      if (units.length >= 8192) flush();
    }
    flush();

    return { text: builtins.join(pieces, ""), rest };
  }

  // UTF-16 little endian. A lone surrogate is an error, and so is a last byte
  // without its pair; with `stream` they are kept for the next chunk instead.
  function decodeUtf16(bytes, fatal, dropBom, stream, label, bigEndian) {
    const units = [];
    let i = 0;
    let rest = null;

    function invalid() {
      if (fatal) throw nodeError(TypeError, "ERR_ENCODING_INVALID_ENCODED_DATA", "The encoded data was not valid for encoding " + label);
      builtins.push(units, REPLACEMENT);
    }

    const at = (index) => (bigEndian ? (bytes[index] << 8) | bytes[index + 1] : bytes[index] | (bytes[index + 1] << 8));
    const bom = bigEndian ? [0xfe, 0xff] : [0xff, 0xfe];
    if (dropBom && bytes.length >= 2 && bytes[0] === bom[0] && bytes[1] === bom[1]) i = 2;

    while (i + 1 < bytes.length) {
      const unit = at(i);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        if (i + 3 >= bytes.length) {
          if (stream) {
            rest = bytes.slice(i);
            break;
          }
          i += 2;
          invalid();
          continue;
        }
        const next = at(i + 2);
        if (next >= 0xdc00 && next <= 0xdfff) {
          builtins.push(units, unit, next);
          i += 4;
        } else {
          i += 2;
          invalid();
        }
      } else if (unit >= 0xdc00 && unit <= 0xdfff) {
        i += 2;
        invalid();
      } else {
        builtins.push(units, unit);
        i += 2;
      }
    }

    if (!rest && i < bytes.length) {
      if (stream) rest = bytes.slice(i);
      else invalid();
    }

    const pieces = [];
    for (let k = 0; k < units.length; k += 8192) builtins.push(pieces, builtins.apply(builtins.fromCharCode, null, builtins.sliceOf(units, k, k + 8192)));

    return { text: builtins.join(pieces, ""), rest };
  }

  // What windows-1252 has in place of the control characters 0x80 to 0x9f.
  const WINDOWS_1252 = [
    0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
    0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
  ];

  function decodeWindows1252(bytes) {
    const pieces = [];
    for (let k = 0; k < bytes.length; k += 8192) {
      const chunk = builtins.sliceOf(bytes, k, k + 8192);
      for (let j = 0; j < chunk.length; j++) {
        if (chunk[j] >= 0x80 && chunk[j] <= 0x9f) chunk[j] = WINDOWS_1252[chunk[j] - 0x80];
      }
      builtins.push(pieces, builtins.apply(builtins.fromCharCode, null, chunk));
    }

    return { text: builtins.join(pieces, ""), rest: null };
  }

  // The labels of the Encoding Standard for the encodings that are there.
  const LABELS = {
    "utf-8": ["unicode-1-1-utf-8", "unicode11utf8", "unicode20utf8", "utf-8", "utf8", "x-unicode20utf8"],
    "utf-16be": ["unicodefffe", "utf-16be"],
    "utf-16le": ["csunicode", "iso-10646-ucs-2", "ucs-2", "unicode", "unicodefeff", "utf-16", "utf-16le"],
    "windows-1252": [
      "ansi_x3.4-1968", "ascii", "cp1252", "cp819", "csisolatin1", "ibm819", "iso-8859-1", "iso-ir-100", "iso8859-1",
      "iso88591", "iso_8859-1", "iso_8859-1:1987", "l1", "latin1", "us-ascii", "windows-1252", "x-cp1252",
    ],
  };

  function encodingOf(label) {
    const name = builtins.toLowerCase(builtins.trim(builtins.string(label)));
    for (const encoding in LABELS) {
      if (builtins.indexOfIn(LABELS[encoding], name) !== -1) return encoding;
    }
    throw nodeError(RangeError, "ERR_ENCODING_NOT_SUPPORTED", 'The "' + label + '" encoding is not supported');
  }

  class TextDecoder {
    #encoding;
    #fatal;
    #ignoreBOM;
    #pending = null;
    #started = false;

    constructor(label = "utf-8", options = {}) {
      this.#encoding = encodingOf(label);
      if (options !== null && typeof options !== "object" && typeof options !== "function") {
        throw argumentError("options", "of type object", options);
      }
      this.#fatal = Boolean(options && options.fatal);
      this.#ignoreBOM = Boolean(options && options.ignoreBOM);
    }

    get [Symbol.toStringTag]() {
      return "TextDecoder";
    }

    get encoding() {
      return this.#encoding;
    }

    get fatal() {
      return this.#fatal;
    }

    get ignoreBOM() {
      return this.#ignoreBOM;
    }

    decode(input, options) {
      let bytes = bytesOf(input);
      const stream = Boolean(options && options.stream);
      if (this.#pending) {
        const joined = new Uint8Array(this.#pending.length + bytes.length);
        joined.set(this.#pending);
        joined.set(bytes, this.#pending.length);
        bytes = joined;
      }

      let result;
      try {
        const dropBom = !this.#ignoreBOM && !this.#started;
        result =
          this.#encoding === "utf-16le" || this.#encoding === "utf-16be"
            ? decodeUtf16(bytes, this.#fatal, dropBom, stream, this.#encoding, this.#encoding === "utf-16be")
            : this.#encoding === "windows-1252"
              ? decodeWindows1252(bytes)
              : decode(bytes, this.#fatal, dropBom, stream);
      } catch (error) {
        this.#pending = null;
        this.#started = false;
        throw error;
      }

      this.#pending = result.rest;
      this.#started = stream && (this.#started || bytes.length > (result.rest ? result.rest.length : 0));

      return result.text;
    }
  }

  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function btoa(input) {
    if (arguments.length === 0) throw nodeError(TypeError, "ERR_MISSING_ARGS", 'The "input" argument must be specified');
    const text = `${input}`;
    let out = "";

    for (let i = 0; i < text.length; i += 3) {
      const a = builtins.charCodeAt(text, i);
      const b = i + 1 < text.length ? builtins.charCodeAt(text, i + 1) : -1;
      const c = i + 2 < text.length ? builtins.charCodeAt(text, i + 2) : -1;
      if (a > 255 || b > 255 || c > 255) {
        throw domError("Invalid character");
      }

      out += ALPHABET[a >> 2];
      out += ALPHABET[((a & 3) << 4) | (b < 0 ? 0 : b >> 4)];
      out += b < 0 ? "=" : ALPHABET[((b & 15) << 2) | (c < 0 ? 0 : c >> 6)];
      out += c < 0 ? "=" : ALPHABET[c & 63];
    }

    return out;
  }

  function atob(input) {
    if (arguments.length === 0) throw nodeError(TypeError, "ERR_MISSING_ARGS", 'The "input" argument must be specified');
    let text = builtins.replace(`${input}`, /[\t\n\f\r ]+/g, "");
    if (text.length % 4 === 0) text = builtins.replace(text, /==?$/, "");
    if (builtins.test(/[^A-Za-z0-9+/]/, text)) throw domError("Invalid character");
    if (text.length % 4 === 1) {
      throw domError("The string to be decoded is not correctly encoded.");
    }

    let out = "";
    let buffer = 0;
    let bits = 0;
    for (let i = 0; i < text.length; i++) {
      buffer = (buffer << 6) | builtins.indexOf(ALPHABET, text[i]);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out += builtins.fromCharCode((buffer >> bits) & 255);
      }
    }

    return out;
  }

  return { TextEncoder, TextDecoder, atob, btoa };
})
