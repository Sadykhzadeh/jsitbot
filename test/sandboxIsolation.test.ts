import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

describe("tampering with built-ins", () => {
  test("replacing the methods the output depends on changes nothing", async () => {
    const result = await sandbox.execute(`
      const value = { result: [1, 2], when: new Date(0), nested: new Map([[1, new Set([2])]]) };
      Array.prototype.push = () => { throw new Error("push"); };
      Array.prototype.join = () => "hijacked";
      Array.prototype[Symbol.iterator] = function* () { yield "hijacked"; };
      Object.keys = () => ["hijacked"];
      Object.entries = () => [];
      Object.prototype.toString = () => { throw new Error("toString"); };
      Object.prototype.hasOwnProperty = () => false;
      String.prototype.slice = () => "hijacked";
      String.prototype.indexOf = () => -1;
      Function.prototype.call = () => "hijacked";
      Function.prototype.apply = () => "hijacked";
      Function.prototype.bind = () => "hijacked";
      Map.prototype.forEach = () => {};
      JSON.stringify = () => "hijacked";
      String = () => "hijacked";
      console.log({ logged: [1, 2] });
      return value;
    `);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe(
        [
          "{",
          "  result: [ 1, 2 ],",
          "  when: 1970-01-01T00:00:00.000Z,",
          "  nested: Map(1) { 1 => Set(1) { 2 } }",
          "}",
        ].join("\n"),
      );
    }
    expect(result.logs).toEqual(["{ logged: [ 1, 2 ] }"]);
  });

  test("a toJSON or toString on the prototype does not touch the result", async () => {
    expect(await value(`
      Object.prototype.toJSON = () => "hijacked";
      Object.prototype.toString = () => "hijacked";
      Object.prototype.valueOf = () => "hijacked";
      return { a: 1 };
    `)).toBe("{ a: 1 }");
  });

  test("a hijacked Promise.prototype.then does not change what is awaited", async () => {
    expect(await value(`
      Promise.prototype.then = () => { throw new Error("then"); };
      Object.defineProperty(Promise.prototype, "catch", { get() { throw new Error("catch"); } });
      return await Promise.resolve("still resolved");
    `)).toBe("still resolved");
  });

  test("formatters read no option from Object.prototype when none is given", async () => {
    expect(await value(`
      Object.prototype.style = "unit";
      Object.prototype.unit = "acre";
      Object.prototype.currency = "EUR";
      Object.prototype.maximumFractionDigits = 0;
      Object.prototype.type = "ordinal";
      Object.prototype.numeric = "auto";
      Object.prototype.granularity = "word";
      Object.prototype.lastModified = 5;
      Object.prototype.endings = "native";
      return [
        (1.5).toLocaleString("en-US"),
        new Intl.NumberFormat("en-US").format(1.5),
        new Intl.PluralRules("en").select(2),
        new Intl.RelativeTimeFormat("en").format(-1, "day"),
        new Intl.ListFormat("en").format(["a", "b", "c"]),
        [...new Intl.Segmenter("en").segment("a b")].length,
        new Blob(["a"]).type === "",
        new File(["a"], "x").lastModified > 5,
        new Intl.NumberFormat("en").resolvedOptions().style,
        new Intl.Collator("en").resolvedOptions().numeric,
      ].join("|");
    `)).toBe("1.5|1.5|other|1 day ago|a, b, and c|3|true|true|decimal|false");
  });

  test("PluralRules reads no digit option from Object.prototype", async () => {
    expect(await value(`
      Object.prototype.minimumFractionDigits = 1;
      Object.prototype.maximumFractionDigits = 0;
      const plural = new Intl.PluralRules("en");
      return [plural.select(1), plural.resolvedOptions().minimumFractionDigits, plural.resolvedOptions().maximumFractionDigits].join("|");
    `)).toBe("one|0|3");
  });

  test("the case, collation and number extras keep working after their prototypes are replaced", async () => {
    expect(await value(`
      String.prototype.toLowerCase = () => "hijacked";
      String.prototype.replace = () => "hijacked";
      String.prototype.split = () => ["hijacked"];
      String.prototype.normalize = () => { throw new Error("normalize"); };
      String.prototype.codePointAt = () => 0;
      String.prototype.repeat = () => "hijacked";
      return ["a".localeCompare("B"), "i".toLocaleUpperCase("tr"), "I".toLocaleLowerCase("tr"), (1234.5).toLocaleString()].join("|");
    `)).toBe("-1|\u0130|\u0131|1,234.5");
  });

  test("number and BigInt formatting read their own value after valueOf and call are replaced", async () => {
    expect(await value(`
      Number.prototype.valueOf = function () { return 42; };
      BigInt.prototype.valueOf = function () { return 42n; };
      Function.prototype.call = () => "hijacked";
      return [(1).toLocaleString(), (1234.5).toLocaleString("en-US", { style: "currency", currency: "USD" }), (1n).toLocaleString(), (1234.5).toLocaleString("de-DE")].join("|");
    `)).toBe("1|$1,234.50|1|1234.5");
  });

  test("case and date formats keep working after Function.prototype.call and getTime are replaced", async () => {
    expect(await value(`
      Function.prototype.call = () => "hijacked";
      Date.prototype.getTime = () => 0;
      return [
        "ı".toLocaleUpperCase("tr"),
        "I".toLocaleLowerCase("tr"),
        "abc".toLocaleUpperCase(),
        new Date(0).toLocaleString("en-US", { timeZone: "Asia/Tokyo" }),
        String(new Date(0)).includes("GMT"),
      ].join("|");
    `)).toBe("I|ı|ABC|1/1/1970, 9:00:00 AM|true");
  });

  test("locale tags are checked the same way after the array iterator is replaced", async () => {
    expect(await value(`
      Array.prototype[Symbol.iterator] = function* () { yield "hijacked"; };
      return [
        (1).toLocaleString("en"),
        "ABC".toLocaleLowerCase("en-US"),
        "a".localeCompare("b", "en"),
        new Intl.Collator("en").compare("a", "b"),
        new Intl.NumberFormat("en").format(1),
      ].join("|");
    `)).toBe("1|abc|-1|-1|1");
  });

  test("date formatting keeps working after its prototypes are replaced", async () => {
    expect(await value(`
      String.prototype.indexOf = () => -1;
      String.prototype.slice = () => "hijacked";
      Array.prototype.concat = () => [];
      Array.prototype.map = () => [];
      Array.prototype.join = () => "hijacked";
      Array.prototype.forEach = () => {};
      Array.prototype.unshift = () => {};
      return new Date(0).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
    `)).toBe("Jan 01, 1970, 12:00:00.000 AM");
  });

  test("the Intl extra keeps working after its prototypes are replaced", async () => {
    expect(await value(`
      Array.prototype.join = () => "J";
      Array.prototype.push = () => 0;
      Array.prototype.map = () => [];
      Array.prototype.filter = () => [];
      Array.prototype.some = () => false;
      Array.prototype.slice = () => [];
      String.prototype.slice = () => "hijacked";
      String.prototype.split = () => ["hijacked"];
      String.prototype.toLowerCase = () => "hijacked";
      String.prototype.toUpperCase = () => "hijacked";
      String.prototype.indexOf = () => -1;
      String.prototype.charCodeAt = () => 0;
      String.prototype.endsWith = () => false;
      String.prototype.startsWith = () => false;
      RegExp.prototype.test = () => false;
      Math.abs = () => -1;
      Math.max = () => -1;
      Math.min = () => -1;
      Object.prototype.hasOwnProperty = () => false;
      Set.prototype.add = function () { return this; };
      return new Intl.ListFormat("en").format(["a", "b", "c"]) + "|" +
        new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(1234.5) + "|" +
        new Intl.NumberFormat("en-US").formatToParts(-1234.5).length + "|" +
        new Intl.PluralRules("en", { type: "ordinal" }).select(22) + "|" +
        new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-1, "day") + "|" +
        new Intl.RelativeTimeFormat("en").format(3, "hours") + "|" +
        new Intl.Collator("en").compare("a", "B") + "|" +
        new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).format(new Date(0)) + "|" +
        [...new Intl.Segmenter("en", { granularity: "word" }).segment("hi there")].length + "|" +
        new Intl.Locale("en-Latn-US").toString() + "|" +
        new Intl.DisplayNames("en", { type: "region" }).of("US") + "|" +
        Intl.getCanonicalLocales("EN-us")[0] + "|" +
        new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).resolvedOptions().maximumFractionDigits;
    `)).toBe("a, b, and c|$1,234.50|6|two|yesterday|in 3 hours|-1|1/1/1970|3|en-Latn-US|United States|en-US|2");
  });

  test("structuredClone keeps its properties after Object.keys is replaced", async () => {
    expect(await value(`
      Object.keys = () => [];
      Object.prototype.toString = () => "[object Array]";
      return structuredClone({ a: 1, b: [2, 3] });
    `)).toBe("{ a: 1, b: [ 2, 3 ] }");
  });

  test("structuredClone copies maps, sets and buffers after their methods are replaced", async () => {
    expect(await value(`
      const map = new Map([[1, 2]]);
      const set = new Set([3]);
      const bytes = new ArrayBuffer(4);
      Map.prototype.set = () => {};
      Map.prototype.has = () => false;
      Map.prototype.get = () => undefined;
      Map.prototype.forEach = () => {};
      Set.prototype.add = () => {};
      Set.prototype.forEach = () => {};
      ArrayBuffer.prototype.slice = () => new ArrayBuffer(0);
      const copy = structuredClone({ map, set, bytes });
      return [copy.map.size, copy.set.size, copy.bytes.byteLength];
    `)).toBe("[ 1, 1, 4 ]");
  });

  test("the encoding extra keeps working after String and Array methods are replaced", async () => {
    expect(await value(`
      String.fromCharCode = () => "X";
      Function.prototype.apply = () => "hijacked";
      Array.prototype.push = () => 0;
      Array.prototype.join = () => "J";
      String.prototype.charCodeAt = () => 0;
      String.prototype.trim = () => "";
      String.prototype.toLowerCase = () => "x";
      String.prototype.indexOf = () => -1;
      String.prototype.replace = () => "";
      RegExp.prototype.test = () => true;
      return [
        new TextDecoder("UTF-8").decode(new Uint8Array([104, 105])),
        new TextDecoder(" utf-16le ").encoding,
        btoa("hi"),
        atob("aGk="),
      ];
    `)).toBe("[ 'hi', 'utf-16le', 'aGk=', 'hi' ]");
  });

  test("TextEncoder and streamed TextDecoder keep working after typed array methods are replaced", async () => {
    expect(await value(`
      Uint8Array.prototype.slice = () => new Uint8Array(0);
      Uint8Array.prototype.set = () => {};
      const decoder = new TextDecoder();
      return [
        new TextEncoder().encode("hi").length,
        decoder.decode(new Uint8Array([0xe2, 0x82]), { stream: true }) + decoder.decode(new Uint8Array([0xac])),
      ];
    `)).toBe("[ 2, '€' ]");
  });

  test("the event extra keeps working after Array, Map and Math methods are replaced", async () => {
    expect(await value(`
      Array.prototype.slice = () => [];
      Array.prototype.splice = () => [];
      Map.prototype.get = () => undefined;
      Map.prototype.set = function () { return this; };
      Math.floor = () => -1;
      let calls = 0;
      const listener = () => calls++;
      const target = new EventTarget();
      target.addEventListener("ping", listener);
      target.removeEventListener("ping", listener);
      target.addEventListener("ping", listener);
      target.dispatchEvent(new Event("ping"));
      return [calls, AbortSignal.timeout(0) instanceof AbortSignal];
    `)).toBe("[ 1, true ]");
  });

  test("the event extra keeps working after Reflect.apply is replaced", async () => {
    expect(await value(`
      Reflect.apply = () => "hijacked";
      let calls = 0;
      const target = new EventTarget();
      target.addEventListener("ping", () => calls++);
      target.dispatchEvent(new Event("ping"));
      return calls;
    `)).toBe("1");
  });

  test("the URL extra keeps working after String, Array, RegExp, Function and Math methods are replaced", async () => {
    expect(await value(`
      String.prototype.slice = () => "";
      String.prototype.split = () => [];
      String.prototype.replace = () => "";
      String.prototype.toLowerCase = () => "x";
      Array.prototype.push = () => 0;
      Array.prototype.join = () => "J";
      Array.prototype.map = () => [];
      RegExp.prototype.test = () => false;
      Function.prototype.call = () => "hijacked";
      Object.assign = () => ({});
      Math.floor = () => -1;
      const url = new URL("HTTP://User:Pw@EXAMPLE.com:80/a/../b?c=1#d");
      url.hash = "e";
      const params = new URLSearchParams("a=1&b=2");
      params.append("c", "3");
      return [url.href, url.pathname, params.toString()];
    `)).toBe("[ 'http://User:Pw@example.com/b?c=1#e', '/b', 'a=1&b=2&c=3' ]");
  });

  test("the Buffer extra keeps working after String, Math and Uint8Array methods are replaced", async () => {
    expect(await value(`
      String.prototype.charCodeAt = () => 0;
      String.prototype.toLowerCase = () => "x";
      Math.floor = () => 0;
      Math.min = () => -5;
      Uint8Array.prototype.subarray = () => new Uint8Array(0);
      Uint8Array.prototype.set = () => {};
      return [
        Buffer.from("aGk=", "base64").toString("hex"),
        Buffer.compare(Buffer.from("a"), Buffer.from("b")),
        (() => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(258, 0); return bytes.toString("hex"); })(),
        Buffer.isEncoding("UTF-8"),
        Buffer.from([104, 101, 108, 108, 111]).slice(1, 3).toString("hex"),
        Buffer.concat([Buffer.from("a"), Buffer.from("b")]).toString(),
      ];
    `)).toBe("[ '6869', -1, '00000102', true, '656c', 'ab' ]");
  });

  test("Buffer keeps encoding and decoding UTF-8 after TextEncoder and TextDecoder are patched", async () => {
    expect(await value(`
      TextEncoder.prototype.encode = () => new Uint8Array(1);
      TextDecoder.prototype.decode = () => "x";
      return [Buffer.from("hello").length, Buffer.byteLength("hello"), Buffer.from([104, 105]).toString("utf8")];
    `)).toBe("[ 5, 5, 'hi' ]");
  });

  test("the console cannot be replaced or removed", async () => {
    const result = await sandbox.execute(`
      console.log = () => {};
      console.error = null;
      delete globalThis.console;
      try { globalThis.console = { log: () => {} }; } catch (error) {}
      console.log("still logging");
      console.error("also this");
      return typeof console;
    `);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe("object");
    }
    expect(result.logs).toEqual(["still logging", "also this"]);
  });

  test("nothing from one run is visible in the next", async () => {
    await sandbox.execute(`
      Object.prototype.leaked = "yes";
      Array.prototype.leaked = "yes";
      globalThis.leaked = "yes";
      Symbol.for("leaked");
    `);

    expect(await value(`
      return [({}).leaked, [].leaked, globalThis.leaked, Symbol.keyFor(Symbol.for("other"))];
    `)).toBe("[ undefined, undefined, undefined, 'other' ]");
  });

  test("values that lie about themselves cannot break the output", async () => {
    const text = await value(`
      return {
        liar: { [Symbol.toStringTag]: "Map", size: 3 },
        throwing: { get [Symbol.toStringTag]() { throw new Error("tag"); } },
        constructorLiar: { constructor: { name: { toString() { throw new Error("name"); } } } },
      };
    `);

    expect(text.startsWith("error:")).toBe(false);
    expect(text).toContain("liar:");
  });
});

describe("what the guest can reach", () => {
  test("sees no host globals and no bridge function", async () => {
    const types = await value(`
      return [
        typeof process, typeof Bun, typeof require, typeof module, typeof fetch,
        typeof tick, typeof Worker, typeof WebAssembly, typeof hostLog,
        typeof __hostLog, typeof guest, typeof finish, typeof std, typeof os,
      ].join(" ");
    `);

    expect(types).toBe(Array(14).fill("undefined").join(" "));
  });

  test("cannot get at the host through constructors", async () => {
    expect(await value(`return (function () {}).constructor("return typeof process")()`)).toBe("undefined");
    expect(await value(`return this.constructor.constructor("return typeof Bun")()`)).toBe("undefined");
    expect(await value(`return (0, eval)("typeof require")`)).toBe("undefined");
    expect(await value(`return new Function("return typeof globalThis.process")()`)).toBe("undefined");
  });

  test("cannot load modules", async () => {
    expect((await value(`await import("fs")`)).startsWith("error: ReferenceError")).toBe(true);
    expect((await value(`import fs from "fs"; fs`)).startsWith("error:")).toBe(true);
  });

  test("only lists the language's own globals", async () => {
    const names = await value(`return Object.getOwnPropertyNames(globalThis).sort().join(",")`);

    expect(names).not.toMatch(/process|Bun|require|fetch|hostLog|Worker|postMessage|onmessage/);
  });
});
