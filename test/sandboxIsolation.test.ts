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
        typeof setTimeout, typeof setInterval, typeof WebAssembly, typeof hostLog,
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

    expect(names).not.toMatch(/process|Bun|require|fetch|hostLog|setTimeout|Worker|postMessage|onmessage/);
  });
});
