// DisposableStack, AsyncDisposableStack and SuppressedError, for the guest. Evaluated
// the first time the code asks for one of them; see lazyGlobals in guest.js. The
// engine has no `using` syntax, so these are used by calling their methods. The
// messages are Node's: a resource is disposed in the reverse order it was added, a
// failure does not stop the others, and a second failure is wrapped in a
// SuppressedError that holds the first one as `suppressed`.
(function (register, seed, host) {
  "use strict";

  const state = new WeakMap();

  function defineHidden(target, name, value) {
    Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
  }

  const DISPOSAL_MESSAGE = "An error was suppressed during disposal";

  function notAFunction(value) {
    return new TypeError(String(value) + " is not a function");
  }

  function alreadyDisposed(name) {
    return new ReferenceError("Cannot call " + name + " on an already-disposed DisposableStack");
  }

  function SuppressedError(error, suppressed, message) {
    const self = Reflect.construct(Error, [message === undefined ? "" : message], new.target || SuppressedError);
    defineHidden(self, "error", error);
    defineHidden(self, "suppressed", suppressed);
    return self;
  }
  Object.setPrototypeOf(SuppressedError, Error);
  SuppressedError.prototype = Object.create(Error.prototype);
  defineHidden(SuppressedError.prototype, "constructor", SuppressedError);
  defineHidden(SuppressedError.prototype, "name", "SuppressedError");
  defineHidden(SuppressedError.prototype, "message", "");

  // Runs the disposers from the last added to the first. A failure is kept; a later
  // failure becomes a SuppressedError that holds the earlier one.
  function disposeAll(stack) {
    let failed = false;
    let error;
    while (stack.length > 0) {
      const dispose = stack.pop();
      try {
        dispose();
      } catch (thrown) {
        error = failed ? new SuppressedError(thrown, error, DISPOSAL_MESSAGE) : thrown;
        failed = true;
      }
    }
    if (failed) throw error;
  }

  function DisposableStack() {
    if (new.target === undefined) throw new TypeError("Constructor DisposableStack requires 'new'");
    state.set(this, { name: "DisposableStack", stack: [], disposed: false });
  }

  function stateOf(stack, name) {
    const entry = state.get(stack);
    if (entry === undefined) throw new TypeError("Illegal invocation");
    if (entry.disposed) throw alreadyDisposed(entry.name + ".prototype." + name);
    return entry;
  }

  defineHidden(DisposableStack.prototype, "use", function use(value) {
    const entry = stateOf(this, "use");
    if (value === null || value === undefined) return value;
    if (typeof value !== "object" && typeof value !== "function") {
      throw new TypeError("An object is expected with `using` declarations");
    }
    const dispose = value[Symbol.dispose];
    if (typeof dispose !== "function") throw new TypeError("Symbol(Symbol.dispose) is not a function");
    entry.stack.push(() => dispose.call(value));
    return value;
  });

  defineHidden(DisposableStack.prototype, "adopt", function adopt(value, onDispose) {
    const entry = stateOf(this, "adopt");
    if (typeof onDispose !== "function") throw notAFunction(onDispose);
    entry.stack.push(() => onDispose(value));
    return value;
  });

  defineHidden(DisposableStack.prototype, "defer", function defer(onDispose) {
    const entry = stateOf(this, "defer");
    if (typeof onDispose !== "function") throw notAFunction(onDispose);
    entry.stack.push(onDispose);
  });

  defineHidden(DisposableStack.prototype, "move", function move() {
    const entry = stateOf(this, "move");
    const moved = new DisposableStack();
    state.get(moved).stack = entry.stack;
    entry.stack = [];
    entry.disposed = true;
    return moved;
  });

  function dispose() {
    const entry = state.get(this);
    if (entry === undefined) throw new TypeError("Illegal invocation");
    if (entry.disposed) return;
    entry.disposed = true;
    disposeAll(entry.stack);
  }
  defineHidden(DisposableStack.prototype, "dispose", dispose);
  defineHidden(DisposableStack.prototype, Symbol.dispose, dispose);
  Object.defineProperty(DisposableStack.prototype, "disposed", {
    get() {
      const entry = state.get(this);
      if (entry === undefined) throw new TypeError("Illegal invocation");
      return entry.disposed;
    },
    configurable: true,
    enumerable: false,
  });
  Object.defineProperty(DisposableStack.prototype, Symbol.toStringTag, {
    value: "DisposableStack",
    configurable: true,
  });

  function AsyncDisposableStack() {
    if (new.target === undefined) throw new TypeError("Constructor AsyncDisposableStack requires 'new'");
    state.set(this, { name: "AsyncDisposableStack", stack: [], disposed: false });
  }

  defineHidden(AsyncDisposableStack.prototype, "use", function use(value) {
    const entry = stateOf(this, "use");
    if (value === null || value === undefined) return value;
    if (typeof value !== "object" && typeof value !== "function") {
      throw new TypeError("An object is expected with `using` declarations");
    }
    const asyncDispose = value[Symbol.asyncDispose];
    if (typeof asyncDispose === "function") {
      entry.stack.push(() => asyncDispose.call(value));
      return value;
    }
    const dispose = value[Symbol.dispose];
    if (typeof dispose !== "function") throw new TypeError("Symbol(Symbol.dispose) is not a function");
    entry.stack.push(() => dispose.call(value));
    return value;
  });

  defineHidden(AsyncDisposableStack.prototype, "adopt", function adopt(value, onDispose) {
    const entry = stateOf(this, "adopt");
    if (typeof onDispose !== "function") throw notAFunction(onDispose);
    entry.stack.push(() => onDispose(value));
    return value;
  });

  defineHidden(AsyncDisposableStack.prototype, "defer", function defer(onDispose) {
    const entry = stateOf(this, "defer");
    if (typeof onDispose !== "function") throw notAFunction(onDispose);
    entry.stack.push(onDispose);
  });

  defineHidden(AsyncDisposableStack.prototype, "move", function move() {
    const entry = stateOf(this, "move");
    const moved = new AsyncDisposableStack();
    state.get(moved).stack = entry.stack;
    entry.stack = [];
    entry.disposed = true;
    return moved;
  });

  // Each disposer is awaited before the next one starts, from the last added.
  async function disposeAsync() {
    const entry = state.get(this);
    if (entry === undefined) throw new TypeError("Illegal invocation");
    if (entry.disposed) return;
    entry.disposed = true;
    let failed = false;
    let error;
    while (entry.stack.length > 0) {
      const dispose = entry.stack.pop();
      try {
        await dispose();
      } catch (thrown) {
        error = failed ? new SuppressedError(thrown, error, DISPOSAL_MESSAGE) : thrown;
        failed = true;
      }
    }
    if (failed) throw error;
  }
  defineHidden(AsyncDisposableStack.prototype, "disposeAsync", disposeAsync);
  defineHidden(AsyncDisposableStack.prototype, Symbol.asyncDispose, disposeAsync);
  Object.defineProperty(AsyncDisposableStack.prototype, "disposed", {
    get() {
      const entry = state.get(this);
      if (entry === undefined) throw new TypeError("Illegal invocation");
      return entry.disposed;
    },
    configurable: true,
    enumerable: false,
  });
  Object.defineProperty(AsyncDisposableStack.prototype, Symbol.toStringTag, {
    value: "AsyncDisposableStack",
    configurable: true,
  });

  return { DisposableStack, AsyncDisposableStack, SuppressedError };
})
