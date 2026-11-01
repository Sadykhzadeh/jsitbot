// DOMException, Event, CustomEvent, EventTarget, AbortController and
// AbortSignal, for the guest. Evaluated the first time the code asks for one of
// them; see lazyGlobals in guest.js. Returns the globals it defines.
//
// There is no tree to bubble through, so an event is only ever delivered to the
// target it is dispatched on, and `capture` is only part of a listener's
// identity, as it is in Node. AbortSignal.timeout counts on the sandbox clock,
// like setTimeout, and holds the run open until it fires.
(function (register, seed, host) {
  "use strict";

  const apply = Reflect.apply;
  const setTimeout = host.setTimeout;
  const queueMicrotask = host.queueMicrotask;
  const now = host.now;
  const defineProperty = host.defineProperty;

  function define(object, name, value) {
    defineProperty(object, name, { value, writable: true, configurable: true, enumerable: false });
  }

  function tag(Class, name) {
    defineProperty(Class.prototype, Symbol.toStringTag, { value: name, configurable: true });
  }

  const CODES = [
    ["IndexSizeError", 1, "INDEX_SIZE_ERR"],
    ["HierarchyRequestError", 3, "HIERARCHY_REQUEST_ERR"],
    ["WrongDocumentError", 4, "WRONG_DOCUMENT_ERR"],
    ["InvalidCharacterError", 5, "INVALID_CHARACTER_ERR"],
    ["NoModificationAllowedError", 7, "NO_MODIFICATION_ALLOWED_ERR"],
    ["NotFoundError", 8, "NOT_FOUND_ERR"],
    ["NotSupportedError", 9, "NOT_SUPPORTED_ERR"],
    ["InUseAttributeError", 10, "INUSE_ATTRIBUTE_ERR"],
    ["InvalidStateError", 11, "INVALID_STATE_ERR"],
    ["SyntaxError", 12, "SYNTAX_ERR"],
    ["InvalidModificationError", 13, "INVALID_MODIFICATION_ERR"],
    ["NamespaceError", 14, "NAMESPACE_ERR"],
    ["InvalidAccessError", 15, "INVALID_ACCESS_ERR"],
    ["TypeMismatchError", 17, "TYPE_MISMATCH_ERR"],
    ["SecurityError", 18, "SECURITY_ERR"],
    ["NetworkError", 19, "NETWORK_ERR"],
    ["AbortError", 20, "ABORT_ERR"],
    ["URLMismatchError", 21, "URL_MISMATCH_ERR"],
    ["QuotaExceededError", 22, "QUOTA_EXCEEDED_ERR"],
    ["TimeoutError", 23, "TIMEOUT_ERR"],
    ["InvalidNodeTypeError", 24, "INVALID_NODE_TYPE_ERR"],
    ["DataCloneError", 25, "DATA_CLONE_ERR"],
  ];

  class DOMException extends Error {
    constructor(message = "", options = "Error") {
      const detailed = typeof options === "object" && options !== null;
      const name = String(detailed && options.name !== undefined ? options.name : detailed ? "Error" : options);
      super(String(message), detailed && "cause" in options ? { cause: options.cause } : undefined);

      let code = 0;
      for (let i = 0; i < CODES.length; i++) {
        if (CODES[i][0] === name) code = CODES[i][1];
      }
      define(this, "name", name);
      define(this, "code", code);
    }
  }

  tag(DOMException, "DOMException");
  for (let i = 0; i < CODES.length; i++) {
    const constant = { value: CODES[i][1], enumerable: true };
    defineProperty(DOMException, CODES[i][2], constant);
    defineProperty(DOMException.prototype, CODES[i][2], constant);
  }

  // Reads and changes what an Event or an EventTarget keeps to itself. Each is
  // handed out by the class that owns the private field, and throws a
  // TypeError for anything that is not one of its instances.
  let eventState;
  let listenersOf;
  let signalAbort;
  let signalIsAborted;

  class Event {
    #state;

    static {
      eventState = (event) => event.#state;
    }

    constructor(type, init) {
      if (arguments.length === 0) {
        throw new TypeError("The \"type\" argument must be specified");
      }
      if (init !== undefined && init !== null && typeof init !== "object" && typeof init !== "function") {
        throw new TypeError("The \"eventInitDict\" argument must be of type object");
      }
      this.#state = {
        type: String(type),
        bubbles: !!(init && init.bubbles),
        cancelable: !!(init && init.cancelable),
        composed: !!(init && init.composed),
        target: null,
        currentTarget: null,
        phase: 0,
        canceled: false,
        stopped: false,
        passive: false,
        dispatching: false,
        timeStamp: now(),
      };
    }

    get type() {
      return this.#state.type;
    }

    get target() {
      return this.#state.target;
    }

    get srcElement() {
      return this.#state.target;
    }

    get currentTarget() {
      return this.#state.currentTarget;
    }

    get eventPhase() {
      return this.#state.phase;
    }

    get bubbles() {
      return this.#state.bubbles;
    }

    get cancelable() {
      return this.#state.cancelable;
    }

    get composed() {
      return this.#state.composed;
    }

    get defaultPrevented() {
      return this.#state.canceled;
    }

    get isTrusted() {
      this.#state;
      return false;
    }

    get timeStamp() {
      return this.#state.timeStamp;
    }

    composedPath() {
      const state = this.#state;
      return state.dispatching ? [state.currentTarget] : [];
    }

    preventDefault() {
      const state = this.#state;
      if (state.cancelable && !state.passive) state.canceled = true;
    }

    stopPropagation() {
      this.#state;
    }

    stopImmediatePropagation() {
      this.#state.stopped = true;
    }
  }

  tag(Event, "Event");
  for (const [name, value] of [["NONE", 0], ["CAPTURING_PHASE", 1], ["AT_TARGET", 2], ["BUBBLING_PHASE", 3]]) {
    defineProperty(Event, name, { value, enumerable: true });
    defineProperty(Event.prototype, name, { value, enumerable: true });
  }

  class CustomEvent extends Event {
    #detail;

    constructor(type, init) {
      super(...arguments);
      this.#detail = init && init.detail !== undefined ? init.detail : null;
    }

    get detail() {
      return this.#detail;
    }
  }

  tag(CustomEvent, "CustomEvent");

  function normalize(options) {
    if (typeof options === "object" && options !== null) {
      return {
        capture: !!options.capture,
        once: !!options.once,
        passive: !!options.passive,
        signal: options.signal,
      };
    }
    return { capture: !!options, once: false, passive: false, signal: undefined };
  }

  function find(list, callback, capture) {
    for (let i = 0; i < list.length; i++) {
      if (list[i].callback === callback && list[i].capture === capture) return i;
    }
    return -1;
  }

  function addListener(target, type, callback, capture, once, passive) {
    const listeners = listenersOf(target);
    const list = listeners.get(type);
    if (list === undefined) {
      listeners.set(type, [{ callback, capture, once, passive, removed: false }]);
    } else if (find(list, callback, capture) === -1) {
      list[list.length] = { callback, capture, once, passive, removed: false };
    }
  }

  function removeListener(target, type, callback, capture) {
    const list = listenersOf(target).get(type);
    if (list === undefined) return;
    const at = find(list, callback, capture);
    if (at === -1) return;
    list[at].removed = true;
    list.splice(at, 1);
  }

  function report(error) {
    queueMicrotask(() => {
      throw error;
    });
  }

  function dispatch(target, event) {
    const state = eventState(event);
    if (state.dispatching) {
      throw new DOMException("The event is already being dispatched", "InvalidStateError");
    }

    state.dispatching = true;
    state.target = target;
    state.currentTarget = target;
    state.phase = 2;
    state.stopped = false;

    const list = listenersOf(target).get(state.type);
    const snapshot = list === undefined ? [] : list.slice();
    for (let i = 0; i < snapshot.length && !state.stopped; i++) {
      const listener = snapshot[i];
      if (listener.removed) continue;
      if (listener.once) removeListener(target, state.type, listener.callback, listener.capture);

      state.passive = listener.passive;
      try {
        const callback = listener.callback;
        if (typeof callback === "function") {
          apply(callback, target, [event]);
        } else {
          const handle = callback.handleEvent;
          if (typeof handle !== "function") throw new TypeError("The \"handleEvent\" property must be a function");
          apply(handle, callback, [event]);
        }
      } catch (error) {
        report(error);
      }
    }

    state.passive = false;
    state.dispatching = false;
    state.currentTarget = null;
    state.phase = 0;
    return !state.canceled;
  }

  class EventTarget {
    #listeners = new Map();

    static {
      listenersOf = (target) => target.#listeners;
    }

    addEventListener(type, callback, options) {
      this.#listeners;
      if (arguments.length < 2) {
        throw new TypeError("The \"type\" and \"listener\" arguments must be specified");
      }
      if (callback === null || callback === undefined) return;
      if (typeof callback !== "function" && typeof callback !== "object") {
        throw new TypeError("The \"listener\" argument must be of type function or an object with handleEvent");
      }

      const { capture, once, passive, signal } = normalize(options);
      if (signal !== undefined) {
        if (signalIsAborted(signal)) return;
        const name = String(type);
        addListener(this, name, callback, capture, once, passive);
        addListener(signal, "abort", () => removeListener(this, name, callback, capture), false, true, false);
        return;
      }
      addListener(this, String(type), callback, capture, once, passive);
    }

    removeEventListener(type, callback, options) {
      this.#listeners;
      if (arguments.length < 2) {
        throw new TypeError("The \"type\" and \"listener\" arguments must be specified");
      }
      if (callback === null || callback === undefined) return;
      removeListener(this, String(type), callback, normalize(options).capture);
    }

    dispatchEvent(event) {
      this.#listeners;
      if (!(event instanceof Event)) {
        throw new TypeError("The \"event\" argument must be an instance of Event");
      }
      return dispatch(this, event);
    }
  }

  tag(EventTarget, "EventTarget");

  let constructing = false;

  class AbortSignal extends EventTarget {
    #aborted = false;
    #reason = undefined;
    #handler = null;
    #wrapped = false;

    static {
      signalIsAborted = (signal) => signal.#aborted;
      signalAbort = (signal, reason) => {
        if (signal.#aborted) return;
        signal.#aborted = true;
        signal.#reason = reason;
        dispatch(signal, new Event("abort"));
      };
    }

    constructor() {
      if (!constructing) throw new TypeError("Illegal constructor");
      super();
    }

    get aborted() {
      return this.#aborted;
    }

    get reason() {
      return this.#reason;
    }

    get onabort() {
      return this.#handler;
    }

    set onabort(handler) {
      this.#handler = typeof handler === "function" ? handler : null;
      if (this.#handler !== null && !this.#wrapped) {
        this.#wrapped = true;
        addListener(
          this,
          "abort",
          (event) => {
            const current = this.#handler;
            if (current !== null) apply(current, this, [event]);
          },
          false,
          false,
          false,
        );
      }
    }

    throwIfAborted() {
      if (this.#aborted) throw this.#reason;
    }

    static abort(reason) {
      const signal = newSignal();
      signalAbort(signal, arguments.length === 0 || reason === undefined ? abortError() : reason);
      return signal;
    }

    static timeout(delay) {
      const milliseconds = Math.floor(Number(delay));
      if (!(milliseconds >= 0) || milliseconds === Infinity) {
        throw new TypeError("The \"delay\" argument must be a number from 0 up");
      }
      const signal = newSignal();
      setTimeout(
        () => signalAbort(signal, new DOMException("The operation was aborted due to timeout", "TimeoutError")),
        milliseconds,
      );
      return signal;
    }

    static any(signals) {
      const list = [];
      for (const signal of signals) {
        // throws a TypeError for anything that is not a signal
        signalIsAborted(signal);
        list[list.length] = signal;
      }

      const result = newSignal();
      for (let i = 0; i < list.length; i++) {
        if (list[i].aborted) {
          signalAbort(result, list[i].reason);
          return result;
        }
      }
      for (let i = 0; i < list.length; i++) {
        const signal = list[i];
        addListener(signal, "abort", () => signalAbort(result, signal.reason), false, true, false);
      }
      return result;
    }
  }

  tag(AbortSignal, "AbortSignal");

  function abortError() {
    return new DOMException("This operation was aborted", "AbortError");
  }

  function newSignal() {
    constructing = true;
    try {
      return new AbortSignal();
    } finally {
      constructing = false;
    }
  }

  class AbortController {
    #signal = newSignal();

    get signal() {
      return this.#signal;
    }

    abort(reason) {
      signalAbort(this.#signal, reason === undefined ? abortError() : reason);
    }
  }

  tag(AbortController, "AbortController");

  register(Event, function (event) {
    return {
      entries: [
        ["type", event.type],
        ["defaultPrevented", event.defaultPrevented],
        ["cancelable", event.cancelable],
        ["timeStamp", event.timeStamp],
      ],
      map: false,
    };
  });

  register(CustomEvent, function (event) {
    return {
      entries: [
        ["type", event.type],
        ["defaultPrevented", event.defaultPrevented],
        ["cancelable", event.cancelable],
        ["timeStamp", event.timeStamp],
        ["detail", event.detail],
      ],
      map: false,
    };
  });

  register(AbortSignal, function (signal) {
    return { entries: [["aborted", signal.aborted]], map: false };
  });

  register(AbortController, function (controller) {
    return { entries: [["signal", controller.signal]], map: false };
  });

  return { DOMException, Event, CustomEvent, EventTarget, AbortController, AbortSignal };
})
