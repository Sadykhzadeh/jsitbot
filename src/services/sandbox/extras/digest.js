// The hash functions behind crypto.subtle.digest, for the guest: SHA-1, SHA-256,
// SHA-384 and SHA-512. Evaluated the first time a digest is asked for; see
// lazyGlobals in guest.js. Returns a function from an algorithm name and the
// bytes to hash to the hash, as a Uint8Array.
//
// The round constants and the starting values are not typed in: they are the
// first 64 bits of the fractional parts of the cube roots and square roots of
// the first primes, which is how the standard defines them, and SHA-256 uses
// the first 32 bits of the same numbers.
(function () {
  "use strict";

  const MASK = (1n << 64n) - 1n;

  const primes = [];
  for (let n = 2; primes.length < 80; n++) {
    if (primes.every((p) => n % p !== 0)) primes.push(n);
  }

  // The largest whole number whose power of `degree` is at most n.
  function root(n, degree) {
    let x = 1n << BigInt(Math.ceil(n.toString(2).length / Number(degree)));
    for (;;) {
      const y = ((degree - 1n) * x + n / x ** (degree - 1n)) / degree;
      if (y >= x) return x;
      x = y;
    }
  }

  // The first 64 bits after the point of the root of a prime.
  function fraction(prime, degree) {
    return root(BigInt(prime) << (64n * degree), degree) & MASK;
  }

  const K = primes.map((prime) => fraction(prime, 3n));
  const H = primes.slice(0, 16).map((prime) => fraction(prime, 2n));

  function sha1(bytes) {
    const words = padded(bytes, 64, 8);
    const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    const w = new Int32Array(80);

    for (let at = 0; at < words.length; at += 16) {
      for (let i = 0; i < 16; i++) w[i] = words[at + i];
      for (let i = 16; i < 80; i++) {
        const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
        w[i] = (x << 1) | (x >>> 31);
      }

      let [a, b, c, d, e] = h;
      for (let i = 0; i < 80; i++) {
        let f;
        let k;
        if (i < 20) {
          f = (b & c) | (~b & d);
          k = 0x5a827999;
        } else if (i < 40) {
          f = b ^ c ^ d;
          k = 0x6ed9eba1;
        } else if (i < 60) {
          f = (b & c) | (b & d) | (c & d);
          k = 0x8f1bbcdc;
        } else {
          f = b ^ c ^ d;
          k = 0xca62c1d6;
        }
        const next = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
        e = d;
        d = c;
        c = (b << 30) | (b >>> 2);
        b = a;
        a = next;
      }
      h[0] = (h[0] + a) | 0;
      h[1] = (h[1] + b) | 0;
      h[2] = (h[2] + c) | 0;
      h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0;
    }
    return serialize(h, 4);
  }

  const K256 = K.slice(0, 64).map((k) => Number(k >> 32n) | 0);
  const H256 = H.slice(0, 8).map((h) => Number(h >> 32n) | 0);

  function sha256(bytes) {
    const words = padded(bytes, 64, 8);
    const h = H256.slice();
    const w = new Int32Array(64);

    for (let at = 0; at < words.length; at += 16) {
      for (let i = 0; i < 16; i++) w[i] = words[at + i];
      for (let i = 16; i < 64; i++) {
        const x = w[i - 15];
        const y = w[i - 2];
        const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }

      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const choose = (e & f) ^ (~e & g);
        const t1 = (hh + s1 + choose + K256[i] + w[i]) | 0;
        const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (s0 + majority) | 0;
        hh = g;
        g = f;
        f = e;
        e = (d + t1) | 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) | 0;
      }
      const sum = [a, b, c, d, e, f, g, hh];
      for (let i = 0; i < 8; i++) h[i] = (h[i] + sum[i]) | 0;
    }
    return serialize(h, 4);
  }

  function rotate(x, n) {
    return ((x >> n) | (x << (64n - n))) & MASK;
  }

  function sha512(bytes, start, size) {
    const words = padded(bytes, 128, 16);
    const h = start.slice();
    const w = new Array(80);

    for (let at = 0; at < words.length; at += 32) {
      for (let i = 0; i < 16; i++) w[i] = (BigInt(words[at + 2 * i] >>> 0) << 32n) | BigInt(words[at + 2 * i + 1] >>> 0);
      for (let i = 16; i < 80; i++) {
        const x = w[i - 15];
        const y = w[i - 2];
        const s0 = rotate(x, 1n) ^ rotate(x, 8n) ^ (x >> 7n);
        const s1 = rotate(y, 19n) ^ rotate(y, 61n) ^ (y >> 6n);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & MASK;
      }

      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 80; i++) {
        const s1 = rotate(e, 14n) ^ rotate(e, 18n) ^ rotate(e, 41n);
        const choose = (e & f) ^ (~e & MASK & g);
        const t1 = (hh + s1 + choose + K[i] + w[i]) & MASK;
        const s0 = rotate(a, 28n) ^ rotate(a, 34n) ^ rotate(a, 39n);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (s0 + majority) & MASK;
        hh = g;
        g = f;
        f = e;
        e = (d + t1) & MASK;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) & MASK;
      }
      const sum = [a, b, c, d, e, f, g, hh];
      for (let i = 0; i < 8; i++) h[i] = (h[i] + sum[i]) & MASK;
    }

    const out = new Uint8Array(64);
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) out[i * 8 + j] = Number((h[i] >> BigInt(56 - 8 * j)) & 255n);
    }
    return out.slice(0, size);
  }

  // The bytes and the 1 bit, the zeros and the length in bits, as big-endian
  // 32-bit words, in blocks of `block` bytes whose last `field` bytes hold the length.
  function padded(bytes, block, field) {
    const total = Math.ceil((bytes.length + 1 + field) / block) * block;
    const buffer = new Uint8Array(total);
    buffer.set(bytes);
    buffer[bytes.length] = 0x80;
    const bits = BigInt(bytes.length) * 8n;
    for (let i = 0; i < 8; i++) buffer[total - 1 - i] = Number((bits >> BigInt(8 * i)) & 255n);

    const words = new Int32Array(total / 4);
    for (let i = 0; i < words.length; i++) {
      words[i] = (buffer[4 * i] << 24) | (buffer[4 * i + 1] << 16) | (buffer[4 * i + 2] << 8) | buffer[4 * i + 3];
    }
    return words;
  }

  function serialize(words, size) {
    const out = new Uint8Array(words.length * size);
    for (let i = 0; i < words.length; i++) {
      for (let j = 0; j < size; j++) out[i * size + j] = (words[i] >>> (8 * (size - 1 - j))) & 255;
    }
    return out;
  }

  const algorithms = {
    "SHA-1": sha1,
    "SHA-256": sha256,
    "SHA-384": (bytes) => sha512(bytes, H.slice(8, 16), 48),
    "SHA-512": (bytes) => sha512(bytes, H.slice(0, 8), 64),
  };

  return function digest(name, bytes) {
    return algorithms[name](bytes);
  };
})
