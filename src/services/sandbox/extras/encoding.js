// TextEncoder, TextDecoder, atob and btoa, for the guest. Evaluated the first
// time the code asks for one of them; see lazyGlobals in guest.js.
(function () {
  "use strict";

  const REPLACEMENT = 0xfffd;

  function domError(name, message) {
    const error = new Error(message);
    error.name = name;
    return error;
  }

  // The UTF-8 bytes of a string, as many as fit in `limit` when it is given.
  // A lone surrogate becomes U+FFFD, as it does in a browser.
  function encode(text, target, limit) {
    let written = 0;
    let read = 0;

    for (let i = 0; i < text.length; ) {
      let code = text.charCodeAt(i);
      let units = 1;
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        const next = text.charCodeAt(i + 1);
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

    encode(input = "") {
      const text = String(input);
      const bytes = new Uint8Array(text.length * 3);
      const { written } = encode(text, bytes, bytes.length);

      return bytes.slice(0, written);
    }

    encodeInto(source, destination) {
      return encode(String(source), destination, destination.length);
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
    throw new TypeError("The input must be an ArrayBuffer or a view of one");
  }

  // The decoder of the Encoding Standard: an invalid sequence gives one U+FFFD
  // for the bytes that were valid so far, and decoding goes on at the byte that
  // broke it.
  function decode(bytes, fatal, keepBom) {
    const units = [];
    const pieces = [];
    let i = 0;

    function flush() {
      pieces.push(String.fromCharCode.apply(null, units));
      units.length = 0;
    }

    function invalid() {
      if (fatal) throw new TypeError("The encoded data was not valid for encoding utf-8");
      units.push(REPLACEMENT);
    }

    if (!keepBom && bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;

    while (i < bytes.length) {
      const first = bytes[i++];
      if (first < 0x80) {
        units.push(first);
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
            if (i >= bytes.length || bytes[i] < lower || bytes[i] > upper) {
              complete = false;
              break;
            }
            code = (code << 6) | (bytes[i++] & 0x3f);
            lower = 0x80;
            upper = 0xbf;
          }
          if (!complete) {
            invalid();
          } else if (code >= 0x10000) {
            units.push(0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff));
          } else {
            units.push(code);
          }
        }
      }
      if (units.length >= 8192) flush();
    }
    flush();

    return pieces.join("");
  }

  class TextDecoder {
    #fatal;
    #ignoreBOM;

    constructor(label = "utf-8", options = {}) {
      const name = String(label).trim().toLowerCase();
      if (name !== "utf-8" && name !== "utf8" && name !== "unicode-1-1-utf-8") {
        throw new RangeError('The "' + label + '" encoding is not supported');
      }
      this.#fatal = Boolean(options && options.fatal);
      this.#ignoreBOM = Boolean(options && options.ignoreBOM);
    }

    get encoding() {
      return "utf-8";
    }

    get fatal() {
      return this.#fatal;
    }

    get ignoreBOM() {
      return this.#ignoreBOM;
    }

    decode(input) {
      return decode(bytesOf(input), this.#fatal, this.#ignoreBOM);
    }
  }

  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function btoa(input) {
    if (arguments.length === 0) throw new TypeError("The string argument is required");
    const text = String(input);
    let out = "";

    for (let i = 0; i < text.length; i += 3) {
      const a = text.charCodeAt(i);
      const b = i + 1 < text.length ? text.charCodeAt(i + 1) : -1;
      const c = i + 2 < text.length ? text.charCodeAt(i + 2) : -1;
      if (a > 255 || b > 255 || c > 255) {
        throw domError("InvalidCharacterError", "Invalid character");
      }

      out += ALPHABET[a >> 2];
      out += ALPHABET[((a & 3) << 4) | (b < 0 ? 0 : b >> 4)];
      out += b < 0 ? "=" : ALPHABET[((b & 15) << 2) | (c < 0 ? 0 : c >> 6)];
      out += c < 0 ? "=" : ALPHABET[c & 63];
    }

    return out;
  }

  function atob(input) {
    if (arguments.length === 0) throw new TypeError("The string argument is required");
    let text = String(input).replace(/[\t\n\f\r ]+/g, "");
    if (text.length % 4 === 0) text = text.replace(/==?$/, "");
    if (text.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(text)) {
      throw domError("InvalidCharacterError", "The string to be decoded is not correctly encoded.");
    }

    let out = "";
    let buffer = 0;
    let bits = 0;
    for (let i = 0; i < text.length; i++) {
      buffer = (buffer << 6) | ALPHABET.indexOf(text[i]);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out += String.fromCharCode((buffer >> bits) & 255);
      }
    }

    return out;
  }

  return { TextEncoder, TextDecoder, atob, btoa };
})
