import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

describe("globals that are evaluated when first used", () => {
  test("are there to be found, and look like any other global", async () => {
    expect(await value(`return typeof structuredClone`)).toBe("function");
    expect(await value(`return "structuredClone" in globalThis`)).toBe("true");
    expect(await value(`return Object.keys(globalThis).includes("structuredClone")`)).toBe("false");
  });

  test("can be replaced by the program", async () => {
    expect(await value(`structuredClone = 5; return structuredClone`)).toBe("5");
    expect(await value(`globalThis.structuredClone = () => "mine"; return structuredClone()`)).toBe("mine");
  });

  test("do not give the program a way to ask the host for anything", async () => {
    expect(await value(`return [typeof loadExtra, typeof guestExtras, typeof indirectEval].join()`)).toBe(
      "undefined,undefined,undefined",
    );
  });

  test("keep working when the program has replaced the built-ins they rely on", async () => {
    expect(
      await value(`
        const define = Object.defineProperty;
        Object.defineProperty = () => { throw new Error("tampered") };
        globalThis.eval = () => { throw new Error("tampered eval") };
        return typeof structuredClone;
      `),
    ).toBe("function");
  });

  test("are not carried into the next run", async () => {
    await sandbox.execute(`structuredClone = "gone"; structuredClone`);

    expect(await value(`return typeof structuredClone`)).toBe("function");
  });
});

describe("structuredClone", () => {
  test("copies plain data, containers and typed arrays", async () => {
    expect(
      await value(`
        const original = {
          list: [1, { nested: new Date(0) }],
          map: new Map([[1, new Set([2])]]),
          pattern: /x/gi,
          big: 10n,
          bytes: new Uint8Array([1, 2, 3]),
        };
        const copy = structuredClone(original);
        return [
          copy !== original, copy.list !== original.list, copy.list[1].nested instanceof Date,
          copy.list[1].nested.getTime() === 0, copy.map.get(1).has(2), copy.pattern.flags,
          copy.big === 10n, copy.bytes.join(""), copy.bytes.buffer !== original.bytes.buffer,
        ].join();
      `),
    ).toBe("true,true,true,true,true,gi,true,123,true");
  });

  test("keeps cycles and shared references", async () => {
    expect(
      await value(`
        const shared = { n: 1 };
        const original = { a: shared, b: shared, items: [] };
        original.self = original;
        original.items.push(original);
        const copy = structuredClone(original);
        return [copy.self === copy, copy.items[0] === copy, copy.a === copy.b, copy.a !== shared].join();
      `),
    ).toBe("true,true,true,true");
  });

  test("does not keep prototypes or functions on the way", async () => {
    expect(await value(`class P { x = 1 }; return structuredClone(new P()).constructor === Object`)).toBe("true");
    expect(await value(`return structuredClone(new Date(5)) instanceof Date`)).toBe("true");
  });

  test("copies errors with their type, message and cause", async () => {
    expect(
      await value(`
        const copy = structuredClone(new RangeError("r", { cause: { n: 1 } }));
        return [copy instanceof RangeError, copy.message, copy.cause.n].join();
      `),
    ).toBe("true,r,1");
  });

  test("refuses what cannot be copied, with the error name a browser uses", async () => {
    expect(await value(`structuredClone(() => 1)`)).toBe("error: DataCloneError: () => 1 could not be cloned.");
    expect(await value(`structuredClone({ f() {} })`)).toContain("DataCloneError");
    expect(await value(`structuredClone(Symbol("s"))`)).toBe("error: DataCloneError: Symbol(s) could not be cloned.");
    expect(await value(`structuredClone(new WeakMap())`)).toContain("DataCloneError");
    expect(await value(`structuredClone()`)).toBe("error: TypeError: The value argument is required");
  });

  test("a structure nested too deep is the run's own stack overflow", async () => {
    const result = await sandbox.execute(`
      let deep = []; for (let i = 0; i < 100000; i++) deep = [deep];
      structuredClone(deep);
    `);

    expect(result.ok).toBe(false);
    expect((await sandbox.execute("1 + 1")).ok).toBe(true);
  });
});

describe("TextEncoder and TextDecoder", () => {
  test("encode text as UTF-8", async () => {
    expect(await value(`return new TextEncoder().encode("aé€😀").join()`)).toBe("97,195,169,226,130,172,240,159,152,128");
    expect(await value(`return new TextEncoder().encode().length`)).toBe("0");
    expect(await value(`return new TextEncoder().encoding`)).toBe("utf-8");
    expect(await value(`return new TextEncoder().encode("a") instanceof Uint8Array`)).toBe("true");
  });

  test("encode a lone surrogate as U+FFFD", async () => {
    expect(await value(String.raw`return new TextEncoder().encode("\ud800a").join()`)).toBe("239,191,189,97");
  });

  test("encodeInto stops before a character that does not fit", async () => {
    expect(
      await value(`
        const target = new Uint8Array(4);
        const result = new TextEncoder().encodeInto("a€€", target);
        return [result.read, result.written, target.join()].join(" ");
      `),
    ).toBe("2 4 97,226,130,172");
  });

  test("decode UTF-8 from buffers and views", async () => {
    expect(await value(`return new TextDecoder().decode(new Uint8Array([97, 195, 169, 226, 130, 172, 240, 159, 152, 128]))`)).toBe("aé€😀");
    expect(await value(`return new TextDecoder().decode(new Uint8Array([104, 105]).buffer)`)).toBe("hi");
    expect(await value(`return new TextDecoder().decode(new Uint8Array([0, 104, 105, 0]).subarray(1, 3))`)).toBe("hi");
    expect(await value(`return new TextDecoder().decode()`)).toBe("");
  });

  test("decoding replaces what is not valid, once for each broken sequence", async () => {
    expect(await value(`return new TextDecoder().decode(new Uint8Array([97, 0xff, 98, 0xc3, 99, 0xe2, 0x82, 100]))`)).toBe("a\ufffdb\ufffdc\ufffdd");
    expect(await value(`return new TextDecoder().decode(new Uint8Array([0xed, 0xa0, 0x80]))`)).toBe("\ufffd\ufffd\ufffd");
  });

  test("a leading byte order mark is dropped unless asked to keep it", async () => {
    expect(await value(`return new TextDecoder().decode(new Uint8Array([0xef, 0xbb, 0xbf, 97])).length`)).toBe("1");
    expect(await value(`return new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array([0xef, 0xbb, 0xbf, 97])).length`)).toBe("2");
  });

  test("fatal turns invalid input into an error", async () => {
    expect(await value(`return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([0xff]))`)).toBe(
      "error: TypeError: The encoded data was not valid for encoding utf-8",
    );
    expect(await value(`return new TextDecoder("utf8", { fatal: true }).fatal`)).toBe("true");
  });

  test("only UTF-8 is there, and a wrong input says so", async () => {
    expect(await value(`return new TextDecoder("latin1")`)).toBe('error: RangeError: The "latin1" encoding is not supported');
    expect(await value(`return new TextDecoder().decode("text")`)).toContain("TypeError");
  });

  test("round trip text of any size", async () => {
    expect(
      await value(`
        const text = "añ€😀 ".repeat(20000);
        return new TextDecoder().decode(new TextEncoder().encode(text)) === text;
      `),
    ).toBe("true");
  });
});

describe("atob and btoa", () => {
  test("encode and decode base64", async () => {
    expect(await value(`return btoa("Hello, World!")`)).toBe("SGVsbG8sIFdvcmxkIQ==");
    expect(await value(`return atob("SGVsbG8sIFdvcmxkIQ==")`)).toBe("Hello, World!");
    expect(await value(`return [btoa(""), btoa("a"), btoa("ab"), btoa("abc")].join()`)).toBe(",YQ==,YWI=,YWJj");
    expect(await value(`return btoa(String.fromCharCode(0, 255, 128))`)).toBe("AP+A");
  });

  test("decode without padding and ignore whitespace", async () => {
    expect(await value(`return atob("YQ")`)).toBe("a");
    expect(await value(String.raw`return atob(" YW Jj\n")`)).toBe("abc");
  });

  test("round trip every byte", async () => {
    expect(
      await value(`
        let all = "";
        for (let i = 0; i < 256; i++) all += String.fromCharCode(i);
        return atob(btoa(all)) === all;
      `),
    ).toBe("true");
  });

  test("refuse what is not Latin-1 or not base64, with the error name a browser uses", async () => {
    expect(await value(`btoa("€")`)).toBe("error: InvalidCharacterError: Invalid character");
    expect(await value(`atob("a")`)).toContain("InvalidCharacterError");
    expect(await value(`atob("ab$d")`)).toContain("InvalidCharacterError");
    expect(await value(`atob("YQ=")`)).toContain("InvalidCharacterError");
    expect(await value(`btoa()`)).toContain("TypeError");
  });

  test("carry UTF-8 text through the usual trick", async () => {
    expect(
      await value(`
        const bytes = new TextEncoder().encode("héllo 😀");
        const encoded = btoa(String.fromCharCode(...bytes));
        return new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));
      `),
    ).toBe("héllo 😀");
  });
});
