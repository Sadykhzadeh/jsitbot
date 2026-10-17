// crypto.getRandomValues and crypto.randomUUID, for the guest. Evaluated the
// first time the code asks for `crypto`; see lazyGlobals in guest.js.
//
// The numbers come from a small generator (xoshiro128**) that the guest runs
// itself, started from 128 bits the host picked for this run. They are well
// spread and different in every run, and they are not secure: anyone who sees
// enough of them can work out the rest. Nothing here reaches the host.
(function (register, seed) {
  "use strict";

  let a = seed[0] | 0;
  let b = seed[1] | 0;
  let c = seed[2] | 0;
  let d = seed[3] | 0;
  if ((a | b | c | d) === 0) a = 1;

  function next() {
    const result = Math.imul((Math.imul(b, 5) << 7) | (Math.imul(b, 5) >>> 25), 9) >>> 0;
    const t = b << 9;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = (d << 11) | (d >>> 21);
    return result;
  }

  const INTEGER_ARRAYS = [
    "[object Int8Array]", "[object Uint8Array]", "[object Uint8ClampedArray]",
    "[object Int16Array]", "[object Uint16Array]", "[object Int32Array]", "[object Uint32Array]",
    "[object BigInt64Array]", "[object BigUint64Array]",
  ];

  function fill(bytes) {
    for (let i = 0; i < bytes.length; ) {
      let word = next();
      for (let k = 0; k < 4 && i < bytes.length; k++, i++) {
        bytes[i] = word & 255;
        word >>>= 8;
      }
    }
  }

  class Crypto {
    getRandomValues(array) {
      if (INTEGER_ARRAYS.indexOf(Object.prototype.toString.call(array)) === -1) {
        throw new TypeError("The data argument must be an integer-type TypedArray");
      }
      if (array.byteLength > 65536) {
        const error = new Error("The requested length exceeds 65536 bytes");
        error.name = "QuotaExceededError";
        throw error;
      }
      fill(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
      return array;
    }

    randomUUID() {
      const bytes = new Uint8Array(16);
      fill(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;

      let out = "";
      for (let i = 0; i < 16; i++) {
        if (i === 4 || i === 6 || i === 8 || i === 10) out += "-";
        out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
      }
      return out;
    }
  }

  Object.defineProperty(Crypto.prototype, Symbol.toStringTag, { value: "Crypto", configurable: true });

  return { crypto: new Crypto() };
})
