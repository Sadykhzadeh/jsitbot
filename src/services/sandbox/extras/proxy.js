// Proxy, for the guest. Evaluated the first time the code asks for it; see
// lazyGlobals in guest.js. Returns the globals it defines.
//
// The engine cannot tell whether an object is a proxy, so printing one ran its
// traps (a logging proxy logged the reads of the formatter) where Node prints
// the target and runs nothing. This Proxy is the built-in one behind a proxy of
// its own that remembers the target of each proxy made through it, which is
// what the formatter looks up. The built-in is not touched, so the name, the
// length, the missing prototype and the TypeError for a call without new stay
// as they are.
(function (register, seed, host) {
  "use strict";

  const Native = host.Proxy;
  const remember = host.rememberProxy;

  const revocable = {
    revocable(target, handler) {
      const made = Native.revocable(target, handler);
      remember(made.proxy, target);
      return {
        proxy: made.proxy,
        revoke() {
          made.revoke();
          remember(made.proxy, null);
        },
      };
    },
  }.revocable;

  const Proxy = new Native(Native, {
    construct(target, args) {
      const proxy = new target(args[0], args[1]);
      remember(proxy, args[0]);
      return proxy;
    },
    get(target, key) {
      return key === "revocable" ? revocable : target[key];
    },
  });

  return { Proxy };
})
