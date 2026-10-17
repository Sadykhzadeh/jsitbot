# Contributing

Bug reports, fixes and small features are welcome. For a larger change, open an issue first so we can agree on the shape of it. For a security problem, do not open an issue: see [SECURITY.md](SECURITY.md).

## Checks

Set the project up as described in the [README](README.md), then:

```bash
bun test
bun run typecheck
```

CI (`.forgejo/workflows/check.yml`) runs exactly these two after `bun install --frozen-lockfile`, on every pull request and on every push to `master`, with the Bun version pinned in that file. A change should pass both before you send it, and so should every commit in it, not only the last one. If you change dependencies, commit the updated `bun.lock`.

The tests need no bot token and no network. Bot handlers are tested against a recorder in place of Telegram (`test/helpers/botHarness.ts`), and the sandbox tests run real QuickJS instances.

## Changes

- Keep a change to one thing. Do not mix a fix with a rename or a reformat of code you did not otherwise touch.
- A behaviour change comes with a test. A bug fix comes with a test that fails without the fix.
- Match the surrounding style. There is no formatter configuration beyond [.editorconfig](.editorconfig).
- Comments say why, not what, and only where the code does not say it already.
- The project has two runtime dependencies on purpose. Think twice before adding a third.

### The sandbox

Anything under `src/services/sandbox/` decides what a stranger's program can reach, so the bar is higher there:

- Nothing from the host goes into the guest. If the guest needs a new capability, say why in the pull request and what it can be used to reach.
- What leaves the guest is a bounded string, never an object the guest controls. The formatter in `guest.js` captures the built-ins it needs before user code runs; keep it that way.
- A new global goes in `src/services/sandbox/extras/` and is loaded when a program first reads it, unless every program needs it; it must be plain JavaScript that only works on what the guest has. Test it in `test/sandboxGlobals.test.ts`, or compare it with the platform's own as `test/sandboxUrl.test.ts` does.
- Add a test next to the existing ones: `test/sandboxIsolation.test.ts` for tampering with built-ins, `test/sandboxLimits.test.ts` for time and memory, `test/sandboxOutput.test.ts` for output bounds, `test/processSandbox.test.ts` for the child process and its watchdog.
- Run `bun run bench` before and after a change that touches the run path and mention the numbers if they moved.

## Commit messages

One plain sentence in English about the effect of the change, in the imperative, with no trailing period and no prefix. Look at `git log` for the tone, for example:

```text
Report timeouts and memory errors from real signals, not from message text
Do not cut emoji in half when shortening output
```

Put the reasoning in the body if the subject cannot carry it.

## Pull requests

Describe what changed and why, and how you checked it. Keep the history readable: a series of small commits that each pass the checks is better than one large one, and a fix-up commit for your own earlier commit should be folded into it before review.
