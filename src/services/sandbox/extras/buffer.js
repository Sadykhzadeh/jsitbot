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
    if (typeof value === "bigint") return "type bigint (" + String(value) + "n)";
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
    if (value !== null && typeof value === "object") {
      const primitive = typeof value.valueOf === "function" ? value.valueOf() : undefined;
      if (primitive != null && primitive !== value && (typeof primitive === "string" || typeof primitive === "object")) {
        return from(primitive, encodingOrOffset, length);
      }
      if (Array.isArray(value) || typeof value.length === "number") {
        return asBuffer(new Uint8Array(value));
      }
      if (value.type === "Buffer" && Array.isArray(value.data)) {
        return asBuffer(new Uint8Array(value.data));
      }
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
        'The value of "size" is out of range. It must be >= 0 && <= ' + MAX_SAFE + ". Received " + received(size),
      );
    }
  }

  function alloc(size, fill, encoding) {
    checkSize(size);
    const out = asBuffer(new Uint8Array(size));
    if (fill === undefined) return out;
    return out.fill(fill, 0, size, encoding);
  }

  function concat(list, totalLength) {
    if (!Array.isArray(list)) throw argumentError("list", "must be an instance of Array", list);
    if (list.length === 0) return asBuffer(new Uint8Array(0));
    let total = 0;
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!(item instanceof Uint8Array)) {
        throw argumentError("list[" + i + "]", "must be an instance of Buffer or Uint8Array", item);
      }
      total += item.length;
    }
    if (totalLength !== undefined) {
      total = checkPosition(totalLength, "length", 0, MAX_SAFE);
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

  // A position taken as Node takes one: a number rounded down, and 0 for anything
  // that is not a finite number.
  function integerOf(value) {
    const number = +value;
    return Number.isFinite(number) ? Math.floor(number) : 0;
  }

  function outOfRange(name, range, value) {
    return nodeError(
      RangeError,
      "ERR_OUT_OF_RANGE",
      'The value of "' + name + '" is out of range. It must be ' + range + ". Received " + received(value),
    );
  }

  // A position that is given as a number: a whole number from min to max, or a range error.
  function checkPosition(value, name, min, max) {
    if (typeof value !== "number") throw argumentError(name, "must be of type number", value);
    if (!Number.isInteger(value)) throw outOfRange(name, "an integer", value);
    if (value < min || value > max) throw outOfRange(name, ">= " + min + " && <= " + max, value);
    return value;
  }

  // Reverses the bytes of each group of `width` bytes, in place.
  function swapBytes(buffer, width) {
    if (buffer.length % width !== 0) {
      throw nodeError(RangeError, "ERR_INVALID_BUFFER_SIZE", "Buffer size must be a multiple of " + width * 8 + "-bits");
    }
    for (let start = 0; start < buffer.length; start += width) {
      for (let a = start, b = start + width - 1; a < b; a++, b--) {
        const byte = buffer[a];
        buffer[a] = buffer[b];
        buffer[b] = byte;
      }
    }
    return buffer;
  }

  // The checks of the fixed-width reads and writes: an offset that is a whole
  // number, and room for `bytes` bytes after it.
  function checkOffset(buffer, offset, bytes, name) {
    if (typeof offset !== "number") throw argumentError(name, "must be of type number", offset);
    if (Math.floor(offset) !== offset) {
      throw nodeError(RangeError, "ERR_OUT_OF_RANGE", 'The value of "' + name + '" is out of range. It must be an integer. Received ' + received(offset));
    }
    const length = buffer.length - bytes;
    if (length < 0) throw nodeError(RangeError, "ERR_BUFFER_OUT_OF_BOUNDS", "Attempt to access memory outside buffer bounds");
    if (offset < 0 || offset > length) {
      throw nodeError(
        RangeError,
        "ERR_OUT_OF_RANGE",
        'The value of "' + name + '" is out of range. It must be >= 0 and <= ' + length + ". Received " + received(offset),
      );
    }
  }

  // What a range error shows as the value: Node groups the digits of a whole number
  // above 2 ** 32 in threes, and a bigint gets its n.
  function groupDigits(text) {
    const start = text[0] === "-" ? 1 : 0;
    let end = text.length;
    let groups = "";
    for (; end >= start + 4; end -= 3) groups = "_" + text.slice(end - 3, end) + groups;
    return text.slice(0, end) + groups;
  }

  function received(value) {
    if (typeof value === "bigint") {
      const text = String(value);
      return (value > 4294967296n || value < -4294967296n ? groupDigits(text) : text) + "n";
    }
    if (Number.isInteger(value) && Math.abs(value) > 4294967296) return groupDigits(String(value));
    return Object.is(value, -0) ? "-0" : String(value);
  }

  // Node refuses only a value above max or below min, so NaN is written as 0.
  function checkValue(value, min, max, range) {
    if (value > max || value < min) {
      const shown = range === undefined ? ">= " + min + " and <= " + max : range;
      throw nodeError(
        RangeError,
        "ERR_OUT_OF_RANGE",
        'The value of "value" is out of range. It must be ' + shown + ". Received " + received(value),
      );
    }
  }

  // The DataView over the bytes of a buffer, so that offsets count from its start.
  function viewOf(buffer) {
    return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  // The bytes indexOf and lastIndexOf look for: a byte, the bytes of a string in an
  // encoding, or the bytes of a view.
  function needleOf(value, encoding) {
    if (typeof value === "number") return Uint8Array.of(value & 255);
    if (typeof value === "string") return bytesOfString(value, encodingOf(encoding));
    if (value instanceof Uint8Array) return value;
    throw nodeError(
      TypeError,
      "ERR_INVALID_ARG_TYPE",
      'The "value" argument must be one of type number or string or an instance of Buffer or Uint8Array. Received ' + describe(value),
    );
  }

  function matchesAt(haystack, needle, at) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[at + j] !== needle[j]) return false;
    }
    return true;
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

  // The limits of an integer of `bytes` bytes. Node names them as numbers up to four
  // bytes, and as powers of two above that.
  function integerLimits(bytes, signed) {
    const span = 2 ** (8 * bytes);
    const max = signed ? span / 2 - 1 : span - 1;
    const min = signed ? -(span / 2) : 0;
    if (bytes <= 4) return { min, max };
    const bits = 8 * bytes;
    const range = signed ? ">= -(2 ** " + (bits - 1) + ") and < 2 ** " + (bits - 1) : ">= 0 and < 2 ** " + bits;
    return { min, max, range };
  }

  // The integer of `bytes` bytes at start, read as two's complement when signed.
  function readInteger(buffer, start, bytes, littleEndian, signed) {
    let value = 0;
    for (let i = 0; i < bytes; i++) {
      const index = littleEndian ? start + bytes - 1 - i : start + i;
      value = value * 256 + buffer[index];
    }
    const span = 2 ** (8 * bytes);
    return signed && value >= span / 2 ? value - span : value;
  }

  // Writes a number, already checked against the limits, as its bytes. NaN is written as 0.
  // Node takes the low 32 bits from the truncated value and the bytes above them from the
  // floor, so a negative fraction in a five or six byte integer sets its high bytes.
  function writeInteger(buffer, start, bytes, littleEndian, value) {
    let low = wrapInto(Math.trunc(value), 2 ** 32);
    let high = bytes > 4 ? wrapInto(Math.floor(value / 2 ** 32), 2 ** (8 * (bytes - 4))) : 0;
    for (let i = 0; i < bytes; i++) {
      const index = littleEndian ? start + i : start + bytes - 1 - i;
      if (i < 4) {
        buffer[index] = low % 256;
        low = Math.floor(low / 256);
      } else {
        buffer[index] = high % 256;
        high = Math.floor(high / 256);
      }
    }
  }

  function wrapInto(number, span) {
    return number < 0 ? number + span * Math.ceil(-number / span) : number % span;
  }

  // Defines the reads and writes of one width and byte order. A signed one reads
  // and writes two's complement.
  function numeric(bytes, littleEndian, signed) {
    const { min, max, range } = integerLimits(bytes, signed);
    return {
      read(buffer, offset) {
        const start = offset === undefined ? 0 : offset;
        checkOffset(buffer, start, bytes, "offset");
        return readInteger(buffer, start, bytes, littleEndian, signed);
      },
      write(buffer, value, offset) {
        const number = +value;
        checkValue(number, min, max, range);
        const start = offset === undefined ? 0 : offset;
        checkOffset(buffer, start, bytes, "offset");
        writeInteger(buffer, start, bytes, littleEndian, number);
        return start + bytes;
      },
    };
  }

  // The reads and writes whose byte length is given: from 1 to 6 bytes.
  function variable(littleEndian, signed) {
    return {
      read(buffer, offset, byteLength) {
        checkByteLength(byteLength);
        checkOffset(buffer, offset, byteLength, "offset");
        return readInteger(buffer, offset, byteLength, littleEndian, signed);
      },
      write(buffer, value, offset, byteLength) {
        checkByteLength(byteLength);
        const number = +value;
        const { min, max, range } = integerLimits(byteLength, signed);
        checkValue(number, min, max, range);
        checkOffset(buffer, offset, byteLength, "offset");
        writeInteger(buffer, offset, byteLength, littleEndian, number);
        return offset + byteLength;
      },
    };
  }

  function checkByteLength(byteLength) {
    if (typeof byteLength !== "number") throw argumentError("byteLength", "must be of type number", byteLength);
    if (!Number.isInteger(byteLength)) {
      throw nodeError(RangeError, "ERR_OUT_OF_RANGE", 'The value of "byteLength" is out of range. It must be an integer. Received ' + byteLength);
    }
    if (byteLength < 1 || byteLength > 6) {
      throw nodeError(RangeError, "ERR_OUT_OF_RANGE", 'The value of "byteLength" is out of range. It must be >= 1 and <= 6. Received ' + byteLength);
    }
  }

  // Floats and doubles, read and written through a DataView over the buffer.
  function floating(bytes, littleEndian) {
    const getter = bytes === 4 ? "getFloat32" : "getFloat64";
    const setter = bytes === 4 ? "setFloat32" : "setFloat64";
    return {
      read(buffer, offset) {
        const start = offset === undefined ? 0 : offset;
        checkOffset(buffer, start, bytes, "offset");
        return viewOf(buffer)[getter](start, littleEndian);
      },
      write(buffer, value, offset) {
        const number = +value;
        const start = offset === undefined ? 0 : offset;
        checkOffset(buffer, start, bytes, "offset");
        viewOf(buffer)[setter](start, number, littleEndian);
        return start + bytes;
      },
    };
  }

  // Signed and unsigned 64-bit integers, which take and give bigints only.
  function bigint(littleEndian, signed) {
    const min = signed ? -(2n ** 63n) : 0n;
    const max = signed ? 2n ** 63n - 1n : 2n ** 64n - 1n;
    const range = signed ? ">= -(2n ** 63n) and < 2n ** 63n" : ">= 0n and < 2n ** 64n";
    return {
      read(buffer, offset) {
        const start = offset === undefined ? 0 : offset;
        checkOffset(buffer, start, 8, "offset");
        const view = viewOf(buffer);
        return signed ? view.getBigInt64(start, littleEndian) : view.getBigUint64(start, littleEndian);
      },
      write(buffer, value, offset) {
        checkValue(value, min, max, range);
        if (typeof value !== "bigint") {
          throw new TypeError("Cannot mix BigInt and other types, use explicit conversions");
        }
        const start = offset === undefined ? 0 : offset;
        checkOffset(buffer, start, 8, "offset");
        const view = viewOf(buffer);
        if (signed) view.setBigInt64(start, value, littleEndian);
        else view.setBigUint64(start, value, littleEndian);
        return start + 8;
      },
    };
  }

  const widths = {
    UInt8: numeric(1, true, false),
    UInt16LE: numeric(2, true, false),
    UInt16BE: numeric(2, false, false),
    UInt32LE: numeric(4, true, false),
    UInt32BE: numeric(4, false, false),
    Int8: numeric(1, true, true),
    Int16LE: numeric(2, true, true),
    Int16BE: numeric(2, false, true),
    Int32LE: numeric(4, true, true),
    Int32BE: numeric(4, false, true),
    FloatLE: floating(4, true),
    FloatBE: floating(4, false),
    DoubleLE: floating(8, true),
    DoubleBE: floating(8, false),
    BigInt64LE: bigint(true, true),
    BigInt64BE: bigint(false, true),
    BigUInt64LE: bigint(true, false),
    BigUInt64BE: bigint(false, false),
    UIntLE: variable(true, false),
    UIntBE: variable(false, false),
    IntLE: variable(true, true),
    IntBE: variable(false, true),
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

    toLocaleString(encoding, start, end) {
      return this.toString(encoding, start, end);
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
      if (typeof value === "string" && typeof offsetArgument === "string") {
        encoding = offsetArgument;
      } else {
        if (offsetArgument !== undefined) offset = checkPosition(offsetArgument, "offset", 0, MAX_SAFE);
        if (typeof value === "string" && typeof endArgument === "string") {
          encoding = endArgument;
        } else if (endArgument !== undefined) {
          end = checkPosition(endArgument, "end", 0, this.length);
        }
      }
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
      const needle = needleOf(value, encoding);
      let from = byteOffset === undefined ? 0 : Math.trunc(+byteOffset) || 0;
      if (from < 0) from = Math.max(0, this.length + from);
      if (needle.length === 0) return Math.min(from, this.length);
      for (let i = from; i + needle.length <= this.length; i++) {
        if (matchesAt(this, needle, i)) return i;
      }
      return -1;
    }

    lastIndexOf(value, byteOffsetArgument, encodingArgument) {
      let byteOffset = byteOffsetArgument;
      let encoding = encodingArgument;
      if (typeof byteOffset === "string") {
        encoding = byteOffset;
        byteOffset = undefined;
      }
      const needle = needleOf(value, encoding);
      // The start Node takes for a search backwards, as its C++ does: an offset
      // before the buffer is no match unless the needle is empty.
      let from = Math.floor(byteOffset === undefined ? NaN : +byteOffset);
      if (Number.isNaN(from)) from = this.length;
      if (from < 0) {
        if (from + this.length >= 0) from += this.length;
        else if (needle.length === 0) from = 0;
        else return -1;
      } else if (from + needle.length > this.length) {
        from = needle.length === 0 ? this.length : this.length - 1;
      }
      if (needle.length === 0) return from;
      for (let i = Math.min(from, this.length - needle.length); i >= 0; i--) {
        if (matchesAt(this, needle, i)) return i;
      }
      return -1;
    }

    includes(value, byteOffset, encoding) {
      return this.indexOf(value, byteOffset, encoding) !== -1;
    }

    compare(target, targetStart, targetEnd, sourceStart, sourceEnd) {
      if (!(target instanceof Uint8Array)) throw argumentError("target", "must be an instance of Buffer or Uint8Array", target);
      const tfrom = targetStart === undefined ? 0 : checkPosition(targetStart, "targetStart", 0, MAX_SAFE);
      const tto = targetEnd === undefined ? target.length : checkPosition(targetEnd, "targetEnd", 0, target.length);
      const from = sourceStart === undefined ? 0 : checkPosition(sourceStart, "sourceStart", 0, MAX_SAFE);
      const to = sourceEnd === undefined ? this.length : checkPosition(sourceEnd, "sourceEnd", 0, this.length);
      return compareBytes(this.subarray(from, to), target.subarray(tfrom, tto));
    }

    copy(target, targetStart, sourceStart, sourceEnd) {
      if (!(target instanceof Uint8Array)) throw argumentError("target", "must be an instance of Buffer or Uint8Array", target);
      const to = targetStart === undefined ? 0 : integerOf(targetStart);
      if (to < 0) throw outOfRange("targetStart", ">= 0", to);
      const from = sourceStart === undefined ? 0 : integerOf(sourceStart);
      if (from < 0 || from > this.length) throw outOfRange("sourceStart", ">= 0 && <= " + this.length, from);
      const end = sourceEnd === undefined ? this.length : integerOf(sourceEnd);
      if (end < 0) throw outOfRange("sourceEnd", ">= 0", end);
      if (to >= target.length || from >= end) return 0;

      const count = Math.min(end - from, target.length - to, this.length - from);
      target.set(this.subarray(from, from + count), to);
      return count;
    }

    swap16() {
      return swapBytes(this, 2);
    }

    swap32() {
      return swapBytes(this, 4);
    }

    swap64() {
      return swapBytes(this, 8);
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

    readInt8(offset) {
      return widths.Int8.read(this, offset);
    }

    readInt16LE(offset) {
      return widths.Int16LE.read(this, offset);
    }

    readInt16BE(offset) {
      return widths.Int16BE.read(this, offset);
    }

    readInt32LE(offset) {
      return widths.Int32LE.read(this, offset);
    }

    readInt32BE(offset) {
      return widths.Int32BE.read(this, offset);
    }

    readFloatLE(offset) {
      return widths.FloatLE.read(this, offset);
    }

    readFloatBE(offset) {
      return widths.FloatBE.read(this, offset);
    }

    readDoubleLE(offset) {
      return widths.DoubleLE.read(this, offset);
    }

    readDoubleBE(offset) {
      return widths.DoubleBE.read(this, offset);
    }

    readBigInt64LE(offset) {
      return widths.BigInt64LE.read(this, offset);
    }

    readBigInt64BE(offset) {
      return widths.BigInt64BE.read(this, offset);
    }

    readBigUInt64LE(offset) {
      return widths.BigUInt64LE.read(this, offset);
    }

    readBigUInt64BE(offset) {
      return widths.BigUInt64BE.read(this, offset);
    }

    writeInt8(value, offset) {
      return widths.Int8.write(this, value, offset);
    }

    writeInt16LE(value, offset) {
      return widths.Int16LE.write(this, value, offset);
    }

    writeInt16BE(value, offset) {
      return widths.Int16BE.write(this, value, offset);
    }

    writeInt32LE(value, offset) {
      return widths.Int32LE.write(this, value, offset);
    }

    writeInt32BE(value, offset) {
      return widths.Int32BE.write(this, value, offset);
    }

    writeFloatLE(value, offset) {
      return widths.FloatLE.write(this, value, offset);
    }

    writeFloatBE(value, offset) {
      return widths.FloatBE.write(this, value, offset);
    }

    writeDoubleLE(value, offset) {
      return widths.DoubleLE.write(this, value, offset);
    }

    writeDoubleBE(value, offset) {
      return widths.DoubleBE.write(this, value, offset);
    }

    writeBigInt64LE(value, offset) {
      return widths.BigInt64LE.write(this, value, offset);
    }

    writeBigInt64BE(value, offset) {
      return widths.BigInt64BE.write(this, value, offset);
    }

    writeBigUInt64LE(value, offset) {
      return widths.BigUInt64LE.write(this, value, offset);
    }

    writeBigUInt64BE(value, offset) {
      return widths.BigUInt64BE.write(this, value, offset);
    }

    readUIntLE(offset, byteLength) {
      return widths.UIntLE.read(this, offset, byteLength);
    }

    readUIntBE(offset, byteLength) {
      return widths.UIntBE.read(this, offset, byteLength);
    }

    readIntLE(offset, byteLength) {
      return widths.IntLE.read(this, offset, byteLength);
    }

    readIntBE(offset, byteLength) {
      return widths.IntBE.read(this, offset, byteLength);
    }

    writeUIntLE(value, offset, byteLength) {
      return widths.UIntLE.write(this, value, offset, byteLength);
    }

    writeUIntBE(value, offset, byteLength) {
      return widths.UIntBE.write(this, value, offset, byteLength);
    }

    writeIntLE(value, offset, byteLength) {
      return widths.IntLE.write(this, value, offset, byteLength);
    }

    writeIntBE(value, offset, byteLength) {
      return widths.IntBE.write(this, value, offset, byteLength);
    }
  }

  // The offset or length of write(), which must be a number in 0 to the length of the buffer.
  function checkWriteOffset(value, max, name) {
    if (typeof value !== "number") throw argumentError(name, "must be of type number", value);
    if (Math.floor(value) !== value) {
      throw nodeError(RangeError, "ERR_OUT_OF_RANGE", 'The value of "' + name + '" is out of range. It must be an integer. Received ' + received(value));
    }
    if (!(value >= 0 && value <= max)) {
      throw nodeError(
        RangeError,
        "ERR_OUT_OF_RANGE",
        'The value of "' + name + '" is out of range. It must be >= 0 && <= ' + max + ". Received " + received(value),
      );
    }
  }

  // Node names the unsigned reads and writes with a lowercase "int" as well, and both names
  // are the same function.
  const LOWERCASE_NAMES = [
    "Uint8", "Uint16LE", "Uint16BE", "Uint32LE", "Uint32BE", "BigUint64LE", "BigUint64BE", "UintLE", "UintBE",
  ];
  for (const name of LOWERCASE_NAMES) {
    for (const verb of ["read", "write"]) {
      const original = verb + name.replace("Uint", "UInt");
      Object.defineProperty(Buffer.prototype, verb + name, {
        value: Buffer.prototype[original],
        writable: true,
        configurable: true,
        enumerable: false,
      });
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
