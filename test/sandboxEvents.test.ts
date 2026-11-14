import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

describe("the globals are there", () => {
  test("look like any other global", async () => {
    expect(
      await value(`
        return ["DOMException", "Event", "CustomEvent", "EventTarget", "AbortController", "AbortSignal"]
          .map((name) => typeof globalThis[name] + (Object.keys(globalThis).includes(name) ? "!" : "")).join();
      `),
    ).toBe("function,function,function,function,function,function");
  });

  test("keep working when the program has replaced the built-ins they rely on", async () => {
    expect(
      await value(`
        setTimeout = queueMicrotask = () => { throw new Error("tampered") };
        Object.defineProperty = () => { throw new Error("tampered") };
        const controller = new AbortController();
        const seen = [];
        controller.signal.addEventListener("abort", () => seen.push("abort"));
        controller.abort();
        return seen.join();
      `),
    ).toBe("abort");
  });
});

describe("DOMException", () => {
  test("is an error with a name, a message and the legacy code", async () => {
    expect(
      await value(`
        const e = new DOMException("gone", "NotFoundError");
        return [e instanceof Error, e instanceof DOMException, e.name, e.message, e.code, e.NOT_FOUND_ERR,
          DOMException.NOT_FOUND_ERR, Object.prototype.toString.call(e), String(e)].join();
      `),
    ).toBe("true,true,NotFoundError,gone,8,8,8,[object DOMException],NotFoundError: gone");
  });

  test("defaults to the name Error and code 0, and takes a cause", async () => {
    expect(
      await value(`
        const e = new DOMException();
        const f = new DOMException("m", { name: "AbortError", cause: 7 });
        return [e.name, e.message === "", e.code, f.name, f.code, f.cause].join();
      `),
    ).toBe("Error,true,0,AbortError,20,7");
  });

  test("is printed like an error", async () => {
    const result = await sandbox.execute(`console.log(new DOMException("nope", "AbortError"))`);

    expect(result.logs[0]).toMatch(/^DOMException \[AbortError\]: nope/);
  });
});

describe("Event", () => {
  test("needs a type and reads its options", async () => {
    expect(
      await value(`
        let message;
        try { new Event() } catch (e) { message = e.constructor.name }
        const e = new Event("x", { cancelable: true, bubbles: true });
        return [message, e.type, e.cancelable, e.bubbles, e.composed, e.defaultPrevented, e.isTrusted, e.target,
          e.eventPhase, typeof e.timeStamp].join();
      `),
    ).toBe("TypeError,x,true,true,false,false,false,,0,number");
  });

  test("preventDefault works only on a cancelable event", async () => {
    expect(
      await value(`
        const a = new Event("a", { cancelable: true });
        const b = new Event("b");
        a.preventDefault();
        b.preventDefault();
        return [a.defaultPrevented, b.defaultPrevented].join();
      `),
    ).toBe("true,false");
  });

  test("CustomEvent carries a detail", async () => {
    expect(
      await value(`
        const e = new CustomEvent("x", { detail: { n: 1 } });
        return [e instanceof Event, e.detail.n, new CustomEvent("y").detail].join();
      `),
    ).toBe("true,1,");
  });

  test("a subclass can add its own fields", async () => {
    expect(
      await value(`
        class Ping extends Event { constructor(n) { super("ping"); this.n = n } }
        const t = new EventTarget();
        let got;
        t.addEventListener("ping", (e) => { got = e.n + ":" + (e instanceof Ping) });
        t.dispatchEvent(new Ping(5));
        return got;
      `),
    ).toBe("5:true");
  });
});

describe("EventTarget", () => {
  test("calls listeners in the order they were added, with the target as this", async () => {
    expect(
      await value(`
        const t = new EventTarget();
        const seen = [];
        t.addEventListener("x", function (e) { seen.push("a", this === t, e.target === t, e.currentTarget === t, e.eventPhase) });
        t.addEventListener("x", () => seen.push("b"));
        t.addEventListener("y", () => seen.push("never"));
        const e = new Event("x");
        t.dispatchEvent(e);
        return [seen.join(), e.currentTarget, e.eventPhase, e.target === t].join("|");
      `),
    ).toBe("a,true,true,true,2,b||0|true");
  });

  test("an object with handleEvent is a listener", async () => {
    expect(
      await value(`
        const t = new EventTarget();
        const seen = [];
        t.addEventListener("x", { handleEvent(e) { seen.push(this === obj, e.type) } });
        const obj = { handleEvent(e) { seen.push(this === obj, e.type) } };
        t.addEventListener("x", obj);
        t.dispatchEvent(new Event("x"));
        return seen.join();
      `),
    ).toBe("false,x,true,x");
  });

  test("the same listener added twice runs once, and can be removed", async () => {
    expect(
      await value(`
        const t = new EventTarget();
        let n = 0;
        const f = () => n++;
        t.addEventListener("x", f);
        t.addEventListener("x", f);
        t.dispatchEvent(new Event("x"));
        t.removeEventListener("x", f);
        t.dispatchEvent(new Event("x"));
        return n;
      `),
    ).toBe("1");
  });

  test("capture is part of a listener's identity", async () => {
    expect(
      await value(`
        const t = new EventTarget();
        let n = 0;
        const f = () => n++;
        t.addEventListener("x", f, true);
        t.addEventListener("x", f, { capture: false });
        t.removeEventListener("x", f);
        t.dispatchEvent(new Event("x"));
        return n;
      `),
    ).toBe("1");
  });

  test("once runs a listener a single time", async () => {
    expect(
      await value(`
        const t = new EventTarget();
        let n = 0;
        t.addEventListener("x", () => n++, { once: true });
        t.dispatchEvent(new Event("x"));
        t.dispatchEvent(new Event("x"));
        return n;
      `),
    ).toBe("1");
  });

  test("a listener removed while the event is dispatched is not called, one added is not either", async () => {
    expect(
      await value(`
        const t = new EventTarget();
        const seen = [];
        const second = () => seen.push("second");
        t.addEventListener("x", () => { seen.push("first"); t.removeEventListener("x", second); t.addEventListener("x", () => seen.push("late")) });
        t.addEventListener("x", second);
        t.dispatchEvent(new Event("x"));
        return seen.join();
      `),
    ).toBe("first");
  });

  test("stopImmediatePropagation skips the rest", async () => {
    expect(
      await value(`
        const t = new EventTarget();
        const seen = [];
        t.addEventListener("x", (e) => { seen.push(1); e.stopImmediatePropagation() });
        t.addEventListener("x", () => seen.push(2));
        t.dispatchEvent(new Event("x"));
        return seen.join();
      `),
    ).toBe("1");
  });

  test("dispatchEvent says whether the default was left alone", async () => {
    expect(
      await value(`
        const t = new EventTarget();
        t.addEventListener("x", (e) => e.preventDefault());
        return [t.dispatchEvent(new Event("x", { cancelable: true })), t.dispatchEvent(new Event("x")), t.dispatchEvent(new Event("y"))].join();
      `),
    ).toBe("false,true,true");
  });

  test("a passive listener cannot prevent the default", async () => {
    expect(
      await value(`
        const t = new EventTarget();
        t.addEventListener("x", (e) => e.preventDefault(), { passive: true });
        return t.dispatchEvent(new Event("x", { cancelable: true }));
      `),
    ).toBe("true");
  });

  test("a listener's signal removes it when aborted", async () => {
    expect(
      await value(`
        const t = new EventTarget();
        const c = new AbortController();
        let n = 0;
        t.addEventListener("x", () => n++, { signal: c.signal });
        t.dispatchEvent(new Event("x"));
        c.abort();
        t.dispatchEvent(new Event("x"));
        const done = new AbortController();
        done.abort();
        t.addEventListener("x", () => n += 100, { signal: done.signal });
        t.dispatchEvent(new Event("x"));
        return n;
      `),
    ).toBe("1");
  });

  test("an event already being dispatched cannot be dispatched again", async () => {
    expect(
      await value(`
        const t = new EventTarget();
        let name;
        t.addEventListener("x", (e) => { try { t.dispatchEvent(e) } catch (error) { name = error.name } });
        t.dispatchEvent(new Event("x"));
        return name;
      `),
    ).toBe("InvalidStateError");
  });

  test("an event can be dispatched again once it is done", async () => {
    expect(
      await value(`
        const t = new EventTarget();
        let n = 0;
        t.addEventListener("x", () => n++);
        const e = new Event("x");
        t.dispatchEvent(e);
        t.dispatchEvent(e);
        return n;
      `),
    ).toBe("2");
  });

  test("dispatching something that is not an event is a type error", async () => {
    expect(await value(`return new EventTarget().dispatchEvent({ type: "x" })`)).toMatch(/^error: TypeError/);
    expect(await value(`new EventTarget().addEventListener("x", 5)`)).toMatch(/^error: TypeError/);
  });

  test("a listener that throws does not stop the others and is reported", async () => {
    const result = await sandbox.execute(`
      const t = new EventTarget();
      const seen = [];
      t.addEventListener("x", () => { throw new Error("boom") });
      t.addEventListener("x", () => seen.push("after"));
      t.dispatchEvent(new Event("x"));
      await null;
      return seen.join();
    `);

    expect(result.ok && result.result).toBe("after");
    expect(result.logs.join("\n")).toContain("Uncaught Error: boom");
  });

  test("can be extended", async () => {
    expect(
      await value(`
        class Bus extends EventTarget { emit(name) { return this.dispatchEvent(new Event(name)) } }
        const bus = new Bus();
        let n = 0;
        bus.addEventListener("go", () => n++);
        bus.emit("go");
        return [n, bus instanceof EventTarget].join();
      `),
    ).toBe("1,true");
  });

  test("does not accept a method call on something else", async () => {
    expect(await value(`return EventTarget.prototype.dispatchEvent.call({}, new Event("x"))`)).toMatch(/^error: TypeError/);
  });
});

describe("AbortController", () => {
  test("aborts its signal once, with a reason", async () => {
    expect(
      await value(`
        const c = new AbortController();
        const seen = [];
        c.signal.addEventListener("abort", (e) => seen.push(e.type, e.target === c.signal));
        const before = c.signal.aborted;
        c.abort();
        c.abort("second");
        return [before, c.signal.aborted, c.signal === c.signal, seen.join(), c.signal.reason.name,
          c.signal.reason.message, c.signal.reason.code, c.signal.reason instanceof DOMException].join();
      `),
    ).toBe("false,true,true,abort,true,AbortError,This operation was aborted,20,true");
  });

  test("keeps any reason it is given", async () => {
    expect(
      await value(`
        const c = new AbortController();
        const reason = new Error("custom");
        c.abort(reason);
        const d = new AbortController();
        d.abort(0);
        const e = new AbortController();
        e.abort(null);
        return [c.signal.reason === reason, d.signal.reason, e.signal.reason].join();
      `),
    ).toBe("true,0,");
  });

  test("calls onabort", async () => {
    expect(
      await value(`
        const c = new AbortController();
        const seen = [];
        c.signal.onabort = () => seen.push("on");
        c.signal.addEventListener("abort", () => seen.push("listener"));
        c.abort();
        return [seen.join(), typeof c.signal.onabort].join();
      `),
    ).toBe("on,listener,function");
  });

  test("replacing onabort replaces the handler, and null removes it", async () => {
    expect(
      await value(`
        const c = new AbortController();
        const seen = [];
        c.signal.onabort = () => seen.push("one");
        c.signal.onabort = () => seen.push("two");
        const d = new AbortController();
        d.signal.onabort = () => seen.push("never");
        d.signal.onabort = null;
        c.abort();
        d.abort();
        return seen.join();
      `),
    ).toBe("two");
  });

  test("throwIfAborted throws the reason", async () => {
    expect(
      await value(`
        const c = new AbortController();
        c.signal.throwIfAborted();
        c.abort(new RangeError("stop"));
        try { c.signal.throwIfAborted() } catch (e) { return e.name + ":" + e.message }
      `),
    ).toBe("RangeError:stop");
  });

  test("cancels a promise-based wait", async () => {
    expect(
      await value(`
        const c = new AbortController();
        const sleep = (ms, signal) => new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, ms, "slept");
          signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason) }, { once: true });
        });
        setTimeout(() => c.abort(), 10);
        try { return await sleep(1000, c.signal) } catch (e) { return e.name }
      `),
    ).toBe("AbortError");
  });

  test("is printed with its signal", async () => {
    const result = await sandbox.execute(`
      const c = new AbortController();
      console.log(c);
      console.log(c.signal);
      c.abort();
      console.log(c.signal);
    `);

    expect(result.logs).toEqual([
      "AbortController { signal: AbortSignal { aborted: false } }",
      "AbortSignal { aborted: false }",
      "AbortSignal { aborted: true }",
    ]);
  });

  test("a signal cannot be built directly", async () => {
    expect(await value(`new AbortSignal()`)).toMatch(/^error: TypeError: Illegal constructor/);
    expect(await value(`return Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted").get.call({})`)).toMatch(
      /^error: TypeError/,
    );
  });
});

describe("AbortSignal", () => {
  test("abort() gives a signal that is already aborted", async () => {
    expect(
      await value(`
        const a = AbortSignal.abort();
        const b = AbortSignal.abort("why");
        return [a.aborted, a.reason.name, b.reason].join();
      `),
    ).toBe("true,AbortError,why");
  });

  test("timeout() aborts after the time, on the sandbox clock, with a TimeoutError", async () => {
    expect(
      await value(`
        const signal = AbortSignal.timeout(5000);
        const before = signal.aborted;
        const started = performance.now();
        await new Promise((resolve) => signal.addEventListener("abort", resolve));
        return [before, signal.aborted, signal.reason.name, signal.reason.code, performance.now() - started >= 4999].join();
      `),
    ).toBe("false,true,TimeoutError,23,true");
  });

  test("timeout() takes only a number from zero up", async () => {
    expect(await value(`AbortSignal.timeout(-1)`)).toMatch(/^error: TypeError/);
    expect(await value(`AbortSignal.timeout(NaN)`)).toMatch(/^error: TypeError/);
    expect(await value(`AbortSignal.timeout()`)).toMatch(/^error: TypeError/);
    expect(await value(`return AbortSignal.timeout(0).aborted`)).toBe("false");
  });

  test("any() follows the first of several signals", async () => {
    expect(
      await value(`
        const a = new AbortController();
        const b = new AbortController();
        const any = AbortSignal.any([a.signal, b.signal]);
        const seen = [];
        any.addEventListener("abort", () => seen.push("fired"));
        b.abort("from b");
        a.abort("from a");
        return [any.aborted, any.reason, seen.join()].join();
      `),
    ).toBe("true,from b,fired");
  });

  test("any() of a signal that is already aborted is aborted", async () => {
    expect(
      await value(`
        const done = AbortSignal.abort("early");
        const any = AbortSignal.any([new AbortController().signal, done]);
        return [any.aborted, any.reason, AbortSignal.any([]).aborted].join();
      `),
    ).toBe("true,early,false");
  });

  test("any() wants signals", async () => {
    expect(await value(`AbortSignal.any([{}])`)).toMatch(/^error: TypeError/);
    expect(await value(`AbortSignal.any()`)).toMatch(/^error: TypeError/);
  });

  test("is an EventTarget", async () => {
    expect(
      await value(`
        const s = new AbortController().signal;
        return [s instanceof EventTarget, s instanceof AbortSignal, Object.prototype.toString.call(s)].join();
      `),
    ).toBe("true,true,[object AbortSignal]");
  });
});
