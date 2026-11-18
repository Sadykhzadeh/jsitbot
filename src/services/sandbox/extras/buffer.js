// Buffer, for the guest: the part of Node's Buffer that programs use. A Buffer is a
// Uint8Array with Buffer.prototype in its chain. Evaluated the first time the code
// asks for Buffer; see lazyGlobals in guest.js. The encodings are the ones Node
// names, read the way Node reads them: base64 and hex text is decoded leniently, and
// the errors carry Node's messages and codes.
(function (register, seed, host) {
  "use strict";

  const MAX_SAFE = 9007199254740991;
  const INSPECT_MAX_BYTES = 50;
  const ENCODINGS = {
    utf8: "utf8",
    "utf-8": "utf8",
    hex: "hex",
    base64: "base64",
    base64url: "base64url",
    latin1: "latin1",
    binary: "latin1",
    ascii: "ascii",
    ucs2: "utf16le",
    "ucs-2": "utf16le",
    utf16le: "utf16le",
    "utf-16le": "utf16le",
  };

  function nodeError(Type, code, message) {
    const error = new Type(message);
    error.code = code;
    return error;
  }

  // What Node says about a value it refused, as in "Received type number (1)".
  function describe(value) {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "function") return "function " + value.name;
    if (typeof value === "object") {
      const name = value.constructor && value.constructor.name;
      return "an instance of " + (name ? name : "Object");
    }
    if (typeof value === "string") {
      const shown = value.length > 25 ? value.slice(0, 25) + "..." : value;
      return "type string ('" + shown + "')";
    }
    return "type " + typeof value + " (" + String(value) + ")";
  }

  function argumentError(name, expected, value) {
    return nodeError(TypeError, "ERR_INVALID_ARG_TYPE", 'The "' + name + '" argument ' + expected + ". Received " + describe(value));
  }

  function unknownEncoding(encoding) {
    return nodeError(TypeError, "ERR_UNKNOWN_ENCODING", "Unknown encoding: " + String(encoding));
  }

  function hasEncoding(name) {
    return Object.prototype.hasOwnProperty.call(ENCODINGS, name);
  }

  // The encoding of from(), alloc() and the other writers: anything that is not a
  // name of one is UTF-8, except a name that is not known.
  function encodingOf(encoding) {
    if (typeof encoding !== "string" || encoding === "") return "utf8";
    const name = encoding.toLowerCase();
    if (!hasEncoding(name)) throw unknownEncoding(encoding);
    return ENCODINGS[name];
  }

  // The encoding of toString() and write(): undefined is UTF-8, and nothing else
  // is taken without a name that is known.
  function strictEncodingOf(encoding) {
    if (encoding === undefined) return "utf8";
    if (typeof encoding !== "string") throw unknownEncoding(encoding);
    const name = encoding.toLowerCase();
    if (!hasEncoding(name)) throw unknownEncoding(encoding);
    return ENCODINGS[name];
  }

  function hexDigit(code) {
    if (code >= 48 && code <= 57) return code - 48;
    if (code >= 97 && code <= 102) return code - 87;
    if (code >= 65 && code <= 70) return code - 55;
    return -1;
  }

  // Hex pairs, read until the first pair that is not two digits.
  function bytesOfHex(text) {
    const out = [];
    for (let i = 0; i + 1 < text.length; i += 2) {
      const high = hexDigit(text.charCodeAt(i));
      const low = hexDigit(text.charCodeAt(i + 1));
      if (high < 0 || low < 0) break;
      out.push((high << 4) | low);
    }
    return out;
  }

  function base64Value(code) {
    if (code >= 65 && code <= 90) return code - 65;
    if (code >= 97 && code <= 122) return code - 71;
    if (code >= 48 && code <= 57) return code + 4;
    if (code === 43 || code === 45) return 62;
    if (code === 47 || code === 95) return 63;
    return -1;
  }

  // Base64 in either alphabet. Characters that are neither are skipped, and the
  // first "=" ends the text.
  function bytesOfBase64(text) {
    const out = [];
    let acc = 0;
    let bits = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code === 61) break;
      const value = base64Value(code);
      if (value < 0) continue;
      acc = ((acc << 6) | value) & 0xfffff;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((acc >> bits) & 255);
      }
    }
    return out;
  }

  function bytesOfUtf16(text) {
    const out = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      out[2 * i] = code & 255;
      out[2 * i + 1] = code >> 8;
    }
    return out;
  }

  // The bytes of a string in an encoding, as a Uint8Array.
  function bytesOfString(text, encoding) {
    switch (encoding) {
      case "utf8":
        return new TextEncoder().encode(text);
      case "hex":
        return Uint8Array.from(bytesOfHex(text));
      case "base64":
      case "base64url":
        return Uint8Array.from(bytesOfBase64(text));
      case "latin1":
      case "ascii": {
        const out = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 255;
        return out;
      }
      default:
        return bytesOfUtf16(text);
    }
  }

  // The text of some bytes in an encoding.
  function textOf(bytes, encoding) {
    switch (encoding) {
      case "utf8":
        return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
      case "hex": {
        let out = "";
        for (let i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
        return out;
      }
      case "base64":
        return bytes.toBase64();
      case "base64url":
        return bytes.toBase64({ alphabet: "base64url", omitPadding: true });
      case "latin1":
      case "ascii": {
        const mask = encoding === "ascii" ? 127 : 255;
        let out = "";
        for (let i = 0; i < bytes.length; i += 8192) {
          const chunk = Array.prototype.slice.call(bytes, i, i + 8192);
          for (let j = 0; j < chunk.length; j++) chunk[j] &= mask;
          out += String.fromCharCode.apply(null, chunk);
        }
        return out;
      }
      default: {
        const units = [];
        for (let i = 0; i + 1 < bytes.length; i += 2) units.push(bytes[i] | (bytes[i + 1] << 8));
        let out = "";
        for (let i = 0; i < units.length; i += 8192) out += String.fromCharCode.apply(null, units.slice(i, i + 8192));
        return out;
      }
    }
  }

  // A Buffer over the bytes of a Uint8Array, which it takes over when it can.
  function asBuffer(bytes) {
    Object.setPrototypeOf(bytes, Buffer.prototype);
    return bytes;
  }

  function copyBytes(source) {
    const out = new Uint8Array(source.length);
    out.set(source);
    return out;
  }

  function fromArrayBuffer(buffer, offsetArgument, lengthArgument) {
    const byteLength = buffer.byteLength;
    const offset = offsetArgument === undefined ? 0 : +offsetArgument;
    if (offset < 0 || offset !== Math.floor(offset) || Number.isNaN(offset)) {
      throw new RangeError("Start offset " + String(offsetArgument) + " is outside the bounds of the buffer");
    }
    if (offset > byteLength) {
      throw nodeError(RangeError, "ERR_BUFFER_OUT_OF_BOUNDS", '"offset" is outside of buffer bounds');
    }
    const available = byteLength - offset;
    let length = available;
    if (lengthArgument !== undefined) {
      length = Math.max(0, +lengthArgument);
      if (length > available) {
        throw nodeError(RangeError, "ERR_BUFFER_OUT_OF_BOUNDS", '"length" is outside of buffer bounds');
      }
    }
    return asBuffer(new Uint8Array(buffer, offset, length));
  }

  function from(value, encodingOrOffset, length) {
    if (typeof value === "string") return asBuffer(bytesOfString(value, encodingOf(encodingOrOffset)));
    if (value instanceof ArrayBuffer || (typeof SharedArrayBuffer === "function" && value instanceof SharedArrayBuffer)) {
      return fromArrayBuffer(value, encodingOrOffset, length);
    }
    if (ArrayBuffer.isView(value)) {
      if (Object.prototype.toString.call(value) === "[object DataView]") {
        return asBuffer(copyBytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)));
      }
      return asBuffer(new Uint8Array(value));
    }
    if (value !== null && typeof value === "object" && (Array.isArray(value) || typeof value.length === "number")) {
      return asBuffer(new Uint8Array(value));
    }
    throw nodeError(
      TypeError,
      "ERR_INVALID_ARG_TYPE",
      "The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object. Received " + describe(value),
    );
  }

  function checkSize(size) {
    if (typeof size !== "number") throw argumentError("size", "must be of type number", size);
    if (!(size >= 0 && size <= MAX_SAFE)) {
      throw nodeError(
        RangeError,
        "ERR_OUT_OF_RANGE",
        'The value of "size" is out of range. It must be >= 0 && <= ' + MAX_SAFE + ". Received " + size,
      );
    }
  }

  function alloc(size, fill, encoding) {
    checkSize(size);
    const out = new Uint8Array(size);
    if (fill === undefined) return asBuffer(out);
    if (typeof fill === "string") {
      const pattern = bytesOfString(fill, encodingOf(encoding));
      if (pattern.length === 0) return asBuffer(out);
      for (let i = 0; i < size; i++) out[i] = pattern[i % pattern.length];
      return asBuffer(out);
    }
    if (ArrayBuffer.isView(fill)) {
      const pattern = new Uint8Array(fill.buffer, fill.byteOffset, fill.byteLength);
      if (pattern.length === 0) return asBuffer(out);
      for (let i = 0; i < size; i++) out[i] = pattern[i % pattern.length];
      return asBuffer(out);
    }
    out.fill(Number(fill) & 255);
    return asBuffer(out);
  }

  function concat(list, totalLength) {
    if (!Array.isArray(list)) throw argumentError("list", "must be an instance of Array", list);
    let total = 0;
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!(item instanceof Uint8Array)) {
        throw argumentError("list[" + i + "]", "must be an instance of Buffer or Uint8Array", item);
      }
      total += item.length;
    }
    if (totalLength !== undefined) {
      if (typeof totalLength !== "number") throw argumentError("length", "must be of type number", totalLength);
      total = totalLength;
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (let i = 0; i < list.length && at < total; i++) {
      const item = list[i];
      const count = Math.min(item.length, total - at);
      out.set(item.subarray(0, count), at);
      at += count;
    }
    return asBuffer(out);
  }

  function byteLength(value, encoding) {
    if (typeof value !== "string") {
      if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || (typeof SharedArrayBuffer === "function" && value instanceof SharedArrayBuffer)) {
        return value.byteLength;
      }
      throw argumentError("string", "must be of type string or an instance of Buffer or ArrayBuffer", value);
    }
    const name = typeof encoding === "string" && hasEncoding(encoding.toLowerCase()) ? ENCODINGS[encoding.toLowerCase()] : "utf8";
    switch (name) {
      case "utf8":
        return new TextEncoder().encode(value).length;
      case "hex":
        return value.length >>> 1;
      case "base64":
      case "base64url": {
        let bytes = value.length;
        if (value.charCodeAt(bytes - 1) === 61) bytes--;
        if (bytes > 1 && value.charCodeAt(bytes - 1) === 61) bytes--;
        return (bytes * 3) >>> 2;
      }
      case "utf16le":
        return value.length * 2;
      default:
        return value.length;
    }
  }

  // The checks of the fixed-width reads and writes: an offset that is a whole
  // number, and room for `bytes` bytes after it.
  function checkOffset(buffer, offset, bytes, name) {
    if (typeof offset !== "number") throw argumentError(name, "must be of type number", offset);
    if (Math.floor(offset) !== offset) {
      throw nodeError(RangeError, "ERR_OUT_OF_RANGE", 'The value of "' + name + '" is out of range. It must be an integer. Received ' + offset);
    }
    const length = buffer.length - bytes;
    if (length < 0) throw nodeError(RangeError, "ERR_BUFFER_OUT_OF_BOUNDS", "Attempt to access memory outside buffer bounds");
    if (offset < 0 || offset > length) {
      throw nodeError(
        RangeError,
        "ERR_OUT_OF_RANGE",
        'The value of "' + name + '" is out of range. It must be >= 0 and <= ' + length + ". Received " + offset,
      );
    }
  }

  function checkValue(value, min, max) {
    if (!(value >= min && value <= max)) {
      throw nodeError(
        RangeError,
        "ERR_OUT_OF_RANGE",
        'The value of "value" is out of range. It must be >= ' + min + " and <= " + max + ". Received " + value,
      );
    }
  }

  // Bytes of a string that fit in `room`, whole characters only for UTF-8 and UTF-16.
  function writeInto(buffer, text, encoding, offset, room) {
    if (encoding === "utf8") {
      let written = 0;
      for (const char of text) {
        const piece = new TextEncoder().encode(char);
        if (written + piece.length > room) break;
        buffer.set(piece, offset + written);
        written += piece.length;
      }
      return written;
    }
    let bytes = bytesOfString(text, encoding);
    let count = Math.min(bytes.length, room);
    if (encoding === "utf16le") count -= count % 2;
    buffer.set(bytes.subarray(0, count), offset);
    return count;
  }

  // Defines the reads and writes of one width and byte order.
  function numeric(bytes, littleEndian, signed) {
    return {
      read(buffer, offset) {
        checkOffset(buffer, offset === undefined ? 0 : offset, bytes, "offset");
        const start = offset === undefined ? 0 : offset;
        let value = 0;
        for (let i = 0; i < bytes; i++) {
          const index = littleEndian ? start + bytes - 1 - i : start + i;
          value = value * 256 + buffer[index];
        }
        return value;
      },
      write(buffer, value, offset) {
        const number = +value;
        const max = bytes === 1 ? 255 : bytes === 2 ? 65535 : 4294967295;
        checkValue(number, 0, max);
        const start = offset === undefined ? 0 : offset;
        checkOffset(buffer, start, bytes, "offset");
        let rest = number;
        for (let i = 0; i < bytes; i++) {
          const index = littleEndian ? start + i : start + bytes - 1 - i;
          buffer[index] = rest % 256;
          rest = Math.floor(rest / 256);
        }
        return start + bytes;
      },
    };
  }

  const widths = {
    UInt8: numeric(1, true, false),
    UInt16LE: numeric(2, true, false),
    UInt16BE: numeric(2, false, false),
    UInt32LE: numeric(4, true, false),
    UInt32BE: numeric(4, false, false),
  };

  // -1, 0 or 1: how two byte sequences order, the shorter one first when one starts the other.
  function compareBytes(a, b) {
    const count = Math.min(a.length, b.length);
    for (let i = 0; i < count; i++) {
      if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
  }

  class Buffer extends Uint8Array {
    constructor(value, encodingOrOffset, length) {
      const made = typeof value === "number" ? alloc(value) : from(value, encodingOrOffset, length);
      Object.setPrototypeOf(made, new.target.prototype);
      return made;
    }

    static from(value, encodingOrOffset, length) {
      return from(value, encodingOrOffset, length);
    }

    static alloc(size, fill, encoding) {
      return alloc(size, fill, encoding);
    }

    static allocUnsafe(size) {
      checkSize(size);
      return asBuffer(new Uint8Array(size));
    }

    static concat(list, totalLength) {
      return concat(list, totalLength);
    }

    static compare(first, second) {
      if (!(first instanceof Uint8Array)) throw argumentError("buf1", "must be an instance of Buffer or Uint8Array", first);
      if (!(second instanceof Uint8Array)) throw argumentError("buf2", "must be an instance of Buffer or Uint8Array", second);
      return compareBytes(first, second);
    }

    static byteLength(value, encoding) {
      return byteLength(value, encoding);
    }

    static isBuffer(value) {
      return value instanceof Buffer;
    }

    static isEncoding(encoding) {
      return typeof encoding === "string" && encoding.length !== 0 && hasEncoding(encoding.toLowerCase());
    }

    toString(encoding, start, end) {
      if (arguments.length === 0) return textOf(this, "utf8");
      const length = this.length;
      let from = start;
      let to = end;
      if (from <= 0) from = 0;
      else if (from >= length) return "";
      else from = Math.trunc(from) || 0;
      if (to === undefined || to > length) to = length;
      else to = Math.trunc(to) || 0;
      if (to <= from) return "";
      const name = strictEncodingOf(encoding);
      return textOf(new Uint8Array(this.buffer, this.byteOffset + from, to - from), name);
    }

    equals(other) {
      if (!(other instanceof Uint8Array)) throw argumentError("otherBuffer", "must be an instance of Buffer or Uint8Array", other);
      if (this.length !== other.length) return false;
      for (let i = 0; i < this.length; i++) {
        if (this[i] !== other[i]) return false;
      }
      return true;
    }

    slice(start, end) {
      return this.subarray(start, end);
    }

    fill(value, offsetArgument, endArgument, encodingArgument) {
      let offset = 0;
      let end = this.length;
      let encoding = encodingArgument;
      if (typeof offsetArgument === "string") {
        encoding = offsetArgument;
      } else {
        if (offsetArgument !== undefined) offset = Math.trunc(+offsetArgument) || 0;
        if (typeof endArgument === "string") {
          encoding = endArgument;
        } else if (endArgument !== undefined) {
          end = Math.min(this.length, Math.trunc(+endArgument) || 0);
        }
      }
      if (offset < 0) offset = 0;
      if (end > this.length) end = this.length;
      if (offset >= end) return this;
      if (typeof value === "string") {
        const pattern = bytesOfString(value, encodingOf(encoding));
        if (pattern.length === 0 && value.length !== 0) {
          throw nodeError(TypeError, "ERR_INVALID_ARG_VALUE", "The argument 'value' is invalid. Received '" + value + "'");
        }
        if (pattern.length === 0) {
          this.fill(0, offset, end);
          return this;
        }
        for (let i = offset; i < end; i++) this[i] = pattern[(i - offset) % pattern.length];
        return this;
      }
      if (ArrayBuffer.isView(value)) {
        const pattern = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        for (let i = offset; i < end && pattern.length > 0; i++) this[i] = pattern[(i - offset) % pattern.length];
        return this;
      }
      for (let i = offset; i < end; i++) this[i] = Number(value) & 255;
      return this;
    }

    indexOf(value, byteOffsetArgument, encodingArgument) {
      let byteOffset = byteOffsetArgument;
      let encoding = encodingArgument;
      if (typeof byteOffset === "string") {
        encoding = byteOffset;
        byteOffset = 0;
      }
      let needle;
      if (typeof value === "number") {
        needle = Uint8Array.of(value & 255);
      } else if (typeof value === "string") {
        needle = bytesOfString(value, encodingOf(encoding));
      } else if (value instanceof Uint8Array) {
        needle = value;
      } else {
        throw nodeError(
          TypeError,
          "ERR_INVALID_ARG_TYPE",
          'The "value" argument must be one of type number or string or an instance of Buffer or Uint8Array. Received ' + describe(value),
        );
      }
      let from = byteOffset === undefined ? 0 : Math.trunc(+byteOffset) || 0;
      if (from < 0) from = Math.max(0, this.length + from);
      if (needle.length === 0) return Math.min(from, this.length);
      for (let i = from; i + needle.length <= this.length; i++) {
        let match = true;
        for (let j = 0; j < needle.length; j++) {
          if (this[i + j] !== needle[j]) {
            match = false;
            break;
          }
        }
        if (match) return i;
      }
      return -1;
    }

    includes(value, byteOffset, encoding) {
      return this.indexOf(value, byteOffset, encoding) !== -1;
    }

    compare(target, targetStart, targetEnd, sourceStart, sourceEnd) {
      if (!(target instanceof Uint8Array)) throw argumentError("target", "must be an instance of Buffer or Uint8Array", target);
      const from = sourceStart === undefined ? 0 : sourceStart;
      const to = sourceEnd === undefined ? this.length : sourceEnd;
      const tfrom = targetStart === undefined ? 0 : targetStart;
      const tto = targetEnd === undefined ? target.length : targetEnd;
      return compareBytes(this.subarray(from, to), target.subarray(tfrom, tto));
    }

    write(string, offsetArgument, lengthArgument, encodingArgument) {
      if (typeof string !== "string") throw nodeError(TypeError, "ERR_INVALID_ARG_TYPE", "argument must be a string");
      let offset = 0;
      let length = this.length;
      let encoding = "utf8";
      if (offsetArgument === undefined) {
        // write(string)
      } else if (lengthArgument === undefined && typeof offsetArgument === "string") {
        encoding = offsetArgument;
      } else {
        checkWriteOffset(offsetArgument, this.length, "offset");
        offset = offsetArgument;
        const remaining = this.length - offset;
        length = remaining;
        if (typeof lengthArgument === "string") {
          encoding = lengthArgument;
        } else if (lengthArgument !== undefined) {
          checkWriteOffset(lengthArgument, this.length, "length");
          length = Math.min(lengthArgument, remaining);
          encoding = encodingArgument === undefined ? "utf8" : encodingArgument;
        }
      }
      return writeInto(this, string, strictEncodingOf(encoding), offset, length);
    }

    toJSON() {
      return { type: "Buffer", data: Array.from(this) };
    }

    readUInt8(offset) {
      return widths.UInt8.read(this, offset);
    }

    readUInt16LE(offset) {
      return widths.UInt16LE.read(this, offset);
    }

    readUInt16BE(offset) {
      return widths.UInt16BE.read(this, offset);
    }

    readUInt32LE(offset) {
      return widths.UInt32LE.read(this, offset);
    }

    readUInt32BE(offset) {
      return widths.UInt32BE.read(this, offset);
    }

    writeUInt8(value, offset) {
      return widths.UInt8.write(this, value, offset);
    }

    writeUInt16LE(value, offset) {
      return widths.UInt16LE.write(this, value, offset);
    }

    writeUInt16BE(value, offset) {
      return widths.UInt16BE.write(this, value, offset);
    }

    writeUInt32LE(value, offset) {
      return widths.UInt32LE.write(this, value, offset);
    }

    writeUInt32BE(value, offset) {
      return widths.UInt32BE.write(this, value, offset);
    }
  }

  // The offset or length of write(), which must be a number in 0 to the length of the buffer.
  function checkWriteOffset(value, max, name) {
    if (typeof value !== "number") throw argumentError(name, "must be of type number", value);
    if (Math.floor(value) !== value) {
      throw nodeError(RangeError, "ERR_OUT_OF_RANGE", 'The value of "' + name + '" is out of range. It must be an integer. Received ' + value);
    }
    if (!(value >= 0 && value <= max)) {
      throw nodeError(
        RangeError,
        "ERR_OUT_OF_RANGE",
        'The value of "' + name + '" is out of range. It must be >= 0 && <= ' + max + ". Received " + value,
      );
    }
  }

  // Node prints at most 50 bytes, then how many are left.
  register(
    Buffer,
    function (buffer) {
      const shown = Math.min(buffer.length, INSPECT_MAX_BYTES);
      let text = "";
      for (let i = 0; i < shown; i++) text += (i > 0 ? " " : "") + (buffer[i] < 16 ? "0" : "") + buffer[i].toString(16);
      const remaining = buffer.length - shown;
      if (remaining > 0) text += " ... " + remaining + " more byte" + (remaining > 1 ? "s" : "");
      return { text: "<Buffer " + text + ">" };
    },
    true,
    true,
  );

  return { Buffer };
})
