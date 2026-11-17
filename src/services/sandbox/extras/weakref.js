(function (register, seed, host) {
  "use strict";

  // Node keeps the target of a WeakRef for the rest of the job it was made in. The
  // engine counts references and frees an object nothing else holds at once, so a
  // program that made a WeakRef to a fresh object got undefined back. The targets
  // are held here until the run ends, which is as long as a job lasts for a program.
  const held = new Set();
  const WeakRef = new host.Proxy(host.WeakRef, {
    construct(target, args, newTarget) {
      const ref = Reflect.construct(target, args, newTarget);
      held.add(args[0]);
      return ref;
    },
  });

  return { WeakRef };
})
