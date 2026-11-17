// The base64 and hex methods of Uint8Array, for the guest. Evaluated the first time
// a program calls one of them; see lazyMethods in guest.js. Returns the methods by
// name. Each one follows the Uint8Array base64 and hex proposal, with the messages
// Node 26 gives.
(function () {
  "use strict";

  const STANDARD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const URL_SAFE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const SPACE = " \t\n\f\r";
  const HEX = "0123456789abcdef";

  function typeError(message, code) {
    const error = new TypeError(message);
    if (code !== undefined) error.code = code;
    return error;
  }

  function syntaxError(message) {
    return new SyntaxError(message);
  }

  function isSpace(char) {
    return SPACE.indexOf(char) !== -1;
  }

  function isDetached(array) {
    return array.buffer.detached;
  }

  function checkReceiver(array, method) {
    if (Object.prototype.toString.call(array) !== "[object Uint8Array]") {
      throw typeError("Method Uint8Array.prototype." + method + " called on incompatible receiver " + Object.prototype.toString.call(array));
    }
    if (isDetached(array)) {
      throw typeError("Cannot perform Uint8Array.prototype." + method + " on a detached or out-of-bounds ArrayBuffer");
    }
  }

  // The options object of a base64 method: undefined is the defaults, and anything
  // that is not an object is refused, as Node refuses it.
  function readOptions(options) {
    if (options === undefined) return {};
    if (options === null || (typeof options !== "object" && typeof options !== "function")) {
      throw typeError("invalid_argument");
    }
    return options;
  }

  function alphabetOption(options) {
    const alphabet = options.alphabet === undefined ? "base64" : options.alphabet;
    if (alphabet === "base64") return STANDARD;
    if (alphabet === "base64url") return URL_SAFE;
    throw typeError("invalid option " + String(alphabet));
  }

  function lastChunkOption(options) {
    const handling = options.lastChunkHandling === undefined ? "loose" : options.lastChunkHandling;
    if (handling === "loose" || handling === "strict" || handling === "stop-before-partial") return handling;
    throw typeError("invalid option " + String(handling));
  }

  // Decodes base64 text into at most `limit` bytes. Returns the bytes and how many
  // characters of the text they came from. A chunk that does not fit in the room
  // left is not decoded, and nothing after it is read.
  function decodeBase64(text, options, limit) {
    const table = alphabetOption(options);
    const handling = lastChunkOption(options);
    const significant = [];
    for (let i = 0; i < text.length; i++) {
      if (!isSpace(text[i])) significant.push(i);
    }

    const bytes = [];
    let read = 0;
    for (let k = 0; k < significant.length; k += 4) {
      const group = significant.slice(k, k + 4);
      const size = group.length;
      let data = size;
      for (let j = 0; j < size; j++) {
        const char = text[group[j]];
        if (char !== "=") continue;
        // Padding ends the text: "xx==" or "xxx=", and nothing may follow it.
        const padded = size === 4 && j >= 2 && (j === 3 || text[group[3]] === "=");
        if (!padded || k + 4 < significant.length) {
          throw syntaxError("Found a character that cannot be part of a valid base64 string.");
        }
        data = j;
        break;
      }

      const values = [];
      for (let j = 0; j < data; j++) {
        const value = table.indexOf(text[group[j]]);
        if (value === -1) {
          throw syntaxError("Found a character that cannot be part of a valid base64 string.");
        }
        values.push(value);
      }

      // A group without padding that is not complete: one character cannot be a byte,
      // and strict mode wants the padding that two or three need.
      const partial = data === size && size < 4;
      if (partial) {
        if (handling === "stop-before-partial") break;
        if (handling === "strict" || size === 1) {
          throw syntaxError("The base64 input terminates with a single character, excluding padding (=).");
        }
      }

      const count = data === 4 ? 3 : data - 1;
      if (bytes.length + count > limit) break;

      const bits = values.reduce((acc, value) => acc * 64 + value, 0) * 64 ** (4 - data);
      for (let b = 0; b < count; b++) {
        bytes.push(Math.floor(bits / 256 ** (2 - b)) % 256);
      }
      read = group[size - 1] + 1;
      while (read < text.length && isSpace(text[read])) read++;
    }

    return { bytes, read };
  }

  // Decodes hex text, two characters a byte, into at most `limit` bytes. Like the
  // base64 decoder it stops, without reading further, when the array is full.
  function decodeHex(text, limit) {
    const bytes = [];
    let read = 0;
    for (let i = 0; i < text.length; i += 2) {
      if (bytes.length >= limit) break;
      const high = HEX.indexOf(text[i].toLowerCase());
      const low = i + 1 < text.length ? HEX.indexOf(text[i + 1].toLowerCase()) : -1;
      if (high === -1 || low === -1) {
        throw syntaxError("Input string must contain hex characters in even length");
      }
      bytes.push(high * 16 + low);
      read = i + 2;
    }
    return { bytes, read };
  }

  function requireString(value) {
    if (typeof value !== "string") throw typeError("input argument must be a string");
    return value;
  }

  function fromBase64(string, options) {
    const text = requireString(string);
    return new Uint8Array(decodeBase64(text, readOptions(options), Infinity).bytes);
  }

  function fromHex(string) {
    const text = requireString(string);
    if (text.length % 2 !== 0) {
      throw syntaxError("Input string must contain hex characters in even length");
    }
    return new Uint8Array(decodeHex(text, Infinity).bytes);
  }

  function toBase64(options) {
    checkReceiver(this, "toBase64");
    const settings = readOptions(options);
    const table = alphabetOption(settings);
    const omitPadding = Boolean(settings.omitPadding);
    let out = "";
    for (let i = 0; i < this.length; i += 3) {
      const count = Math.min(3, this.length - i);
      const bits = (this[i] << 16) | ((count > 1 ? this[i + 1] : 0) << 8) | (count > 2 ? this[i + 2] : 0);
      for (let k = 0; k < 4; k++) {
        if (k <= count) {
          out += table[(bits >> (18 - 6 * k)) & 63];
        } else if (!omitPadding) {
          out += "=";
        }
      }
    }
    return out;
  }

  function toHex() {
    checkReceiver(this, "toHex");
    let out = "";
    for (let i = 0; i < this.length; i++) {
      out += HEX[this[i] >> 4] + HEX[this[i] & 15];
    }
    return out;
  }

  function setFromBase64(string, options) {
    checkReceiver(this, "setFromBase64");
    const text = requireString(string);
    const decoded = decodeBase64(text, readOptions(options), this.length);
    for (let i = 0; i < decoded.bytes.length; i++) this[i] = decoded.bytes[i];
    return { read: decoded.read, written: decoded.bytes.length };
  }

  function setFromHex(string) {
    checkReceiver(this, "setFromHex");
    const text = requireString(string);
    const decoded = decodeHex(text, this.length);
    for (let i = 0; i < decoded.bytes.length; i++) this[i] = decoded.bytes[i];
    return { read: decoded.read, written: decoded.bytes.length };
  }

  return { fromBase64, fromHex, toBase64, toHex, setFromBase64, setFromHex };
})
