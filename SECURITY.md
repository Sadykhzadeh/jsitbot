# Security Policy

This bot runs code written by strangers. The sandbox is the whole security model, so reports about it are welcome and taken seriously. [ARCHITECTURE.md](ARCHITECTURE.md) explains how it is built.

## Reporting a vulnerability

Please report privately, not in a public issue or pull request.

- Email: azer.piano14@gmail.com
- Or, on GitHub, use **Security > Report a vulnerability** on the repository page, if that button is there.

Include the code that triggers the problem (a message you can paste into a chat with the bot is ideal), what you expected, what happened, and the commit you tested. A report with a working proof of concept is much easier to act on than one without.

This is a one-person project, so replies are best effort. You will get an acknowledgement, a fix or a clear answer, and credit in the fix if you want it. Please give me time to ship a fix before you publish details.

Only the latest commit on `master` is supported.

## Please test locally

Run your own instance (see the README) and attack that. Do not run exploits, floods or long-running loops against the public [@jsitbot](https://t.me/jsitbot).

## In scope

- **Guest escape.** Code in a message or inline query that reaches anything outside the QuickJS context: the host process, its modules, files, environment, network, or the bot's token or configuration. This includes the step that strips TypeScript types before the code runs.
- **Host API exposure.** A way for guest code to get hold of a host object or function, through `console`, the output formatter, the timers, the parts of the environment that are loaded on first use (`src/services/sandbox/extras/`: `URL`, `crypto` and the like) or the error and result paths.
- **Crossing the boundary with data.** Output that is not bounded as documented (more than 50 console lines of 2000 characters, or a result over 4000 characters), or that breaks out of the code block the bot puts it in and injects Telegram formatting.
- **Denial of service that survives the watchdog.** A run that keeps the sandbox process busy past its timeout plus the 150 ms grace period, that stops the replacement process from starting, that crashes the bot process, or that leaves memory or processes behind after it was killed.
- **Memory cap bypass.** Guest memory use beyond the 64 MB limit, or a run that exhausts the memory of the machine.
- **State carried between runs.** Anything one run can leave behind that a later run, by the same user or another, can see or be affected by.
- **Rate limit bypass** by a single account.

## Out of scope

- `crypto.getRandomValues` and `crypto.randomUUID` not being secure. They come from a small generator inside the sandbox on purpose and say so in the README.
- Using the whole budget. A run that takes 700 ms, allocates 64 MB, prints 50 lines or ends with a timeout or memory error is the sandbox working.
- Guest code changing its own world: replacing built-ins, polluting prototypes, making its own output look odd or unreadable. Each run has a fresh instance, so it affects nobody else. Reading the guest runtime source (`guest.js`) is not a leak either, since the repository is public.
- Flooding from many accounts, or anything else that is a matter of request volume. Per-user limits are the protection here, and Telegram applies its own.
- Bugs in Telegram, Bun, QuickJS or `quickjs-emscripten` themselves. Report them upstream. If one of them can be exploited through this bot, that part is in scope and I would like to know.
- A deployment where the sandbox process cannot be started and the bot falls back to running QuickJS inside its own process. It is logged at startup and has no hard kill by design.
- Problems that need a leaked bot token, or access to the machine the bot runs on.
- Reports from a scanner with no working proof of concept, and missing hardening that has no demonstrated effect.
