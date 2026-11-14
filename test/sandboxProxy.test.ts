import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function logged(code: string): Promise<string[]> {
  const result = await sandbox.execute(code);

  return result.ok ? result.logs : [`error: ${result.error}`];
}

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

describe("printing a proxy", () => {
  test("shows the target without running a trap, as Node does", async () => {
    expect(
      await logged(`
        const seen = [];
        const handler = new Proxy({}, { get: (_, trap) => (...args) => { seen.push(trap); return Reflect[trap](...args) } });
        const proxy = new Proxy({ a: 1, b: [2] }, handler);
        console.log(proxy);
        console.log([proxy], { inside: proxy });
        console.log(seen.join());
      `),
    ).toEqual(["{ a: 1, b: [ 2 ] }", "[ { a: 1, b: [ 2 ] } ] { inside: { a: 1, b: [ 2 ] } }", ""]);
  });

  test("does not log the reads a logging proxy makes", async () => {
    expect(
      await logged(`
        const proxy = new Proxy({ name: "x" }, { get(target, key, receiver) { console.log("get " + String(key)); return Reflect.get(target, key, receiver) } });
        console.log(proxy);
        console.log(proxy.name);
      `),
    ).toEqual(["{ name: 'x' }", "get name", "x"]);
  });

  test("shows what kind of thing the target is", async () => {
    expect(await value(`new Proxy(new Map([[1, 2]]), {})`)).toBe("Map(1) { 1 => 2 }");
    expect(await value(`new Proxy([1, 2], {})`)).toBe("[ 1, 2 ]");
    expect(await value(`new Proxy(function f() {}, {})`)).toBe("[Function: f]");
    expect(await value(`class A { x = 1 } new Proxy(new A(), {})`)).toBe("A { x: 1 }");
    expect(await value(`new Proxy(new Proxy({ a: 1 }, {}), {})`)).toBe("{ a: 1 }");
  });

  test("shows a proxy that was made by Reflect.construct and by Proxy.revocable", async () => {
    expect(await value(`Reflect.construct(Proxy, [{ a: 1 }, {}])`)).toBe("{ a: 1 }");
    expect(await value(`Proxy.revocable({ a: 1 }, {}).proxy`)).toBe("{ a: 1 }");
  });

  test("says so when the proxy has been revoked", async () => {
    expect(await logged(`const r = Proxy.revocable({}, {}); r.revoke(); console.log(r.proxy, [r.proxy])`)).toEqual([
      "<Revoked Proxy> [ <Revoked Proxy> ]",
    ]);
  });

  test("still stops at a target that is hostile", async () => {
    expect(await logged(`console.log(new Proxy({ get a() { throw new Error("no") } }, { get() { throw 1 } }))`)).toEqual(["{ a: [Getter] }"]);
  });
});

describe("Proxy", () => {
  test("looks like the built-in", async () => {
    expect(await value(`[typeof Proxy, Proxy.name, Proxy.length, Proxy.prototype, Proxy === Proxy].join()`)).toBe("function,Proxy,2,,true");
    expect(await value(`Proxy.revocable.length + Proxy.revocable.name + (Proxy.revocable === Proxy.revocable)`)).toBe("2revocabletrue");
    expect(await value(`Object.getOwnPropertyNames(Proxy).sort().join()`)).toBe("length,name,revocable");
  });

  test("still needs new and a target and a handler that are objects", async () => {
    expect(await value(`try { Proxy({}, {}) } catch (e) { e.name }`)).toBe("TypeError");
    expect(await value(`try { new Proxy(1, {}) } catch (e) { e.name }`)).toBe("TypeError");
    expect(await value(`try { new Proxy({}) } catch (e) { e.name }`)).toBe("TypeError");
    expect(await value(`try { Proxy.revocable({}, 1) } catch (e) { e.name }`)).toBe("TypeError");
  });

  test("keeps working as a proxy", async () => {
    expect(await value(`const p = new Proxy({}, { get: (t, k) => "got " + String(k) }); p.x`)).toBe("got x");
    expect(await value(`const r = Proxy.revocable({ a: 1 }, {}); const a = r.proxy.a; r.revoke(); try { r.proxy.a } catch (e) { a + e.name }`)).toBe("1TypeError");
    expect(await value(`const p = new Proxy([], {}); [Array.isArray(p), p instanceof Array, Object.prototype.toString.call(p)].join()`)).toBe("true,true,[object Array]");
    expect(await value(`const fn = new Proxy(function (a, b) { return a + b }, {}); fn(1, 2)`)).toBe("3");
  });

  test("can be replaced by the program", async () => {
    expect(await value(`Proxy = 5; Proxy`)).toBe("5");
    expect(await value(`globalThis.Proxy = class Mine {}; typeof new Proxy()`)).toBe("object");
  });

  test("keeps working when the program has replaced the built-ins it relies on", async () => {
    expect(
      await value(`
        Reflect.construct = () => { throw new Error("tampered") };
        Object.defineProperty = () => { throw new Error("tampered") };
        WeakMap.prototype.set = () => { throw new Error("tampered") };
        const p = new Proxy({ a: 1 }, {});
        p
      `),
    ).toBe("{ a: 1 }");
  });
});
