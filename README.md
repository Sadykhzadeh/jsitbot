# [@jsitbot](https://t.me/jsitbot)

Telegram bot for running JavaScript in an isolated sandbox.

## Stack

- Bun
- TypeScript
- grammY
- quickjs-emscripten

## What It Does

- Executes JavaScript from private messages and inline queries, handling up to 8 updates at a time
- In a private chat, re-runs a message when you edit it and updates the answer in place, `/run` commands included
- In a private chat, sends the whole output as a text file after the answer when it does not fit in one message
- Returns the value of the last statement, like a REPL, and understands `return` and top-level `await`
- Accepts TypeScript syntax (the types are stripped)
- Has `setTimeout`, `setInterval`, `setImmediate` and their `clear` twins on a virtual clock: a sleep returns at once instead of using up the time limit, and `Date.now()` does not move. `performance.now()` does move with it, so a measurement around a sleep shows the sleep, and so does `performance.mark` and `measure` (entries are plain objects, not `PerformanceMark`). An interval that is never cleared runs until the time limit
- Has `global` (the same as `globalThis`), `Symbol.dispose` and `Symbol.asyncDispose` (the engine has no `using`), `queueMicrotask`, `Array.fromAsync`, `Error.captureStackTrace` (the stack it sets is the name and message only), `structuredClone`, `TextEncoder` (UTF-8) and `TextDecoder` (UTF-8, UTF-16 little and big endian, and Latin-1 as windows-1252), `atob` and `btoa`, and `URL` and `URLSearchParams` (the WHATWG parser: non-ASCII host names become punycode after compatibility normalisation, and IPv4 and IPv6 addresses are written in their canonical form)
- Has the base64 and hex methods of `Uint8Array` (`fromBase64`, `toBase64`, `fromHex`, `toHex`, `setFromBase64` and `setFromHex`), with the options, the errors and the stop points Node has
- Has the part of `Buffer` programs use: `from` (strings in any encoding named below, arrays, array buffers, typed arrays and buffers), `alloc`, `allocUnsafe`, `concat`, `byteLength`, `isBuffer`, `isEncoding` and `compare`; and on a buffer `toString` (utf8, hex, base64, base64url, latin1, binary, ascii, utf16le and ucs2, with a start and an end), `equals`, `slice`, `subarray`, `fill`, `indexOf`, `includes`, `compare`, `write`, `toJSON`, and `readUInt8`, `readUInt16LE`/`BE`, `readUInt32LE`/`BE` with the matching `write` methods. A buffer is a `Uint8Array` and prints as `<Buffer 68 69>`. Not there: `copy`, the signed and 64-bit reads, `swap16`, `readBigUInt64`, the `Buffer` pool, and the `Buffer()` deprecation warning
- Has `DisposableStack`, `AsyncDisposableStack` and `SuppressedError` as Node 26 has them (`use`, `adopt`, `defer`, `move`, `dispose` and `disposeAsync`, the `disposed` flag, and the suppressed-error chain). The engine has no `using` syntax, so these are used by calling their methods, not with `using` declarations
- Has `Blob` and `File` in memory, as Node has them: parts from strings (UTF-8), buffers, array buffers, views and blobs; `size`; `type` lower-cased when it is printable ASCII; `slice`, `text()`, `arrayBuffer()` and `bytes()`; `endings`; and the printing of both. `stream()` throws an error saying it is not supported, because the sandbox has no streams
- Has `EventTarget`, `Event`, `CustomEvent`, `DOMException`, `AbortController` and `AbortSignal` (`abort`, `timeout`, `any`). There is no tree, so an event only reaches listeners of the target it is dispatched on, and `AbortSignal.timeout` counts on the virtual clock
- Sorts with `localeCompare` the way a browser does for most text: small letters before capitals, accents after letters, and the options `numeric`, `sensitivity`, `caseFirst` and `ignorePunctuation`. The locale is not looked at
- Formats numbers with `toLocaleString` in English style (`1,234,567.891`, `{ style: "currency", currency: "USD" }` (also `currencyDisplay: "code"` and `currencySign: "accounting"`), `percent`, `notation: "compact"` as in `1.2M`, `"scientific"` as in `1.235E4`, `"engineering"`, the digit options, the significant-digit options, `useGrouping` and `signDisplay`); another language or option it does not know gets the engine's plain output
- Has `Intl.NumberFormat`, `Intl.Collator` and `Intl.DateTimeFormat`, which are `toLocaleString` of numbers, `localeCompare` and `toLocaleString` of dates under another name. `resolvedOptions` tells the options that were asked for with the defaults of English (United States) filled in, and the time zone of the machine the bot runs on. `Intl.NumberFormat` has `formatToParts`; `Intl.DateTimeFormat` does not
- Has `Intl.PluralRules` (`select`, cardinal and ordinal), `Intl.ListFormat` (`format`, all types and styles) and `Intl.RelativeTimeFormat` (`format`, all styles, `numeric: "auto"`) for English. `Intl.Segmenter` cuts graphemes (joined emoji and flags stay whole), words and sentences by rules that are the same for every language and only approximate Unicode's. Another language is refused with a `RangeError` rather than answered with English rules
- Writes dates with `toLocaleString`, `toLocaleDateString` and `toLocaleTimeString` the way English (United States) does: the options `weekday`, `year`, `month`, `day`, `hour`, `minute`, `second`, `fractionalSecondDigits`, `hour12`, `hourCycle`, `dateStyle`, `timeStyle` and `timeZoneName`, in local time, in UTC, or in any time zone by name (`timeZone: "Asia/Tokyo"`, with the zone names the machine's time zone data gives). Another language, an era or a day period gets the engine's plain output
- Ends `Date.prototype.toString` and `toTimeString` with the name of the machine's time zone in brackets, as Node does
- Has `crypto.subtle.digest` (SHA-1, SHA-256, SHA-384 and SHA-512; nothing else of `crypto.subtle`), `crypto.getRandomValues` and `crypto.randomUUID`. The numbers are well spread and differ from run to run, but they come from a small generator inside the sandbox and are not secure; do not use them for secrets
- Takes code pasted in a fenced block, with or without a language name
- Runs code in group chats when it is asked to: `/run 1 + 1`, `@your_bot_name 1 + 1`, or `/run` as a reply to a message that has the code. It ignores everything else that is said there
- Prints results and `console` output the way Node does: `Map(2) { 'a' => 1 }`, class instances, errors (a subclass of `Error` by its class: `ValidationError: bad input`), cycles, and a proxy as `Proxy(` its target `)` without running its traps. The items of a Map or Set iterator are not shown (`[Map Iterator] { <items unknown> }`), because reading them would use them up
- Besides `console.log` and friends it has `console.table`, `assert`, `count`, `group` and `time`
- Reports the line an error came from, and for a syntax error shows that line with a caret under the column (a line longer than 80 characters is cut around the column). When an error is printed, reading or writing a property of `undefined` or `null`, a name that is not defined, a variable used before its `let`, a symbol turned into a string or number, `reduce` of an empty array and an invalid array length are worded as Node words them (`Cannot read properties of undefined (reading 'x')`); `error.message` itself keeps the engine's wording, as do the other errors

## How Output Compares With Node

Checked on 17 November 2026 against Node 26.13.0 with 684 snippets: the inputs of the inspect and console tests, hand-picked cases, generated runs of line widths, grouping, nesting, key counts, numbers and strings, and 170 cases of template literals, console forms (no arguments, groups, assertions, counts), JSON, number and date formatting, null-prototype objects, generators, classes with private members and accessors, proxies, reflected keys, errors with custom names, weak references, namespace objects and functions. Each snippet was run once by Node with `console.log` at its default options and once with a depth of 3, which is what the sandbox uses. The sandbox matches exactly on 636 snippets against Node at depth 3 and on 620 against Node's default depth of 2.

| Group | Snippets | Exact |
| --- | ---: | ---: |
| Inspect test inputs | 106 | 93 |
| Console and sandbox test inputs | 37 | 29 |
| Hand-picked cases (containers, errors, iterators, format specifiers) | 184 | 169 |
| Generated (line width, grouping, nesting, numbers, strings, console forms) | 187 | 186 |
| Templates, console forms, JSON, numbers, dates, null prototypes | 113 | 110 |
| Generators, classes, proxies, reflection, errors, weak references, namespaces, functions | 57 | 49 |
| Total | 684 | 636 |

Deliberate differences, with the reason:

- Nested objects are shown three levels deep, Node shows two: a little more is visible without asking.
- Errors have their header and no stack frames, so there are no `at` lines and the paths of the bot are not shown.
- The items of a Map, Set or weak collection are not read, so an iterator shows `<items unknown>`: reading would use them up.
- `console.table` cuts rows, columns and long cells, and `console.dir` cuts a long string, so one reply stays short.
- A getter that throws in `console.table` shows `[Unreadable]`: a formatting error does not end the run.
- A promise still pending when the program ends is an error: the sandbox waits for the result of the run.
- A listener that throws does not stop the run, because events have no event loop behind them.
- `globalThis` and `console` have the names the sandbox provides, not Node's, and `Atomics` is not provided.
- A program that starts with `{ a: 1 }` shows the object, as a REPL does.
- A lone surrogate in a string printed on its own is written as U+FFFD, so the text sent to Telegram is well-formed; Node escapes it as `\ud83d`. Inside an array or object the sandbox escapes it, as Node does.

Known gaps, not fixed yet:

- `%o` on an error does not show its hidden properties, such as `[stack]` and `[message]`: Node prints them after the stack frames, and the sandbox shows no frames.
- Properties added to a typed array longer than 100,000 items are not shown: listing its keys would make one for each item. Shorter ones show them after the items, as Node does.
- A `%s` with an object whose `toString` throws is shown as the object, where Node stops the whole call. A test pins this, so it stays until it is decided.

## Security

- Fresh WebAssembly instance and QuickJS runtime per execution; nothing survives into the next run
- Runs in a separate process that has none of the bot's configuration. A run that has not reported back 150 ms after its timeout gets the process killed and replaced (400 ms if the process has not yet started it), so even a single native call that never returns cannot hold the bot or keep eating memory
- Hard memory cap on the WebAssembly heap (QuickJS's own limit does not see large allocations in the Emscripten build)
- Timeout enforced by the engine's interrupt handler, with a clock that starts when the guest does
- Output is bounded inside the sandbox: at most 50 console lines of 2000 characters and a 4000-character result, whatever the code prints
- No Bun/Node host APIs exposed to guest code; the formatter captures the built-ins it needs before user code runs
- Per-user rate limits; a run that times out is charged as three requests. On top of that, each user has a budget of sandbox time, shared by private messages and inline queries, so one account cannot keep the sandbox busy for long

| Limit | Value |
| --- | --- |
| Time per run | 700 ms |
| Guest memory | 64 MB |
| Code length | 2000 characters |
| Console lines | 50, up to 2000 characters each |
| Result | 4000 characters |
| Private chat | 5 runs per 10 s |
| Inline | 12 runs per 10 s |
| Sandbox time per user | 1 s per 10 s, private and inline together |

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Running It Locally

You need:

- [Bun](https://bun.sh) 1.3 or newer (CI runs 1.4). Node is not needed.
- A Telegram bot token, see below.
- Network access to the Telegram API. The bot uses long polling, so no public URL or webhook is required.

```bash
bun install
cp .env.example .env
```

Put your token in `.env`:

```env
BOT_TOKEN=your_telegram_bot_token
```

Start the bot:

```bash
bun run start
```

It prints `Bot started as @your_bot_name` once it is polling. Bun loads `.env` on its own. The sandbox process is started without `.env` and without the rest of the bot's environment.

### Getting a bot token

1. Open [@BotFather](https://t.me/BotFather) in Telegram and send `/newbot`.
2. Pick a display name, then a username that ends in `bot`.
3. BotFather replies with a token that looks like `<digits>:<letters and digits>`. Put it in `.env`. Anyone who has the token controls the bot, so do not commit it.
4. For inline mode, send `/setinline`, choose your bot and give it a placeholder such as `1 + 1`.

### Running the checks

```bash
bun test
bun run typecheck
```

The tests need no token and no network.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Runs `src/index.ts` (the same as `start`; there is no file watcher) |
| `bun run start` | Runs `src/index.ts` |
| `bun run test` | Runs the test suite (`bun test`) |
| `bun run typecheck` | Type-checks `src`, `test` and `scripts` with `tsc --noEmit` |
| `bun run bench` | Starts the sandbox the way the bot does and prints startup time, first-run latency and warm p50/p95 for a few typical programs |
| `bun run soak` | Starts the real bot against a local stand-in for the Telegram API and prints start-up time, the memory of the bot and its sandbox process, and how a burst of messages is answered. `--limit=30` makes the stand-in refuse sends above 30 a second, as Telegram does |

## Configuration

The only setting read from the environment is the token:

| Variable | Required | Meaning |
| --- | --- | --- |
| `BOT_TOKEN` | yes | Telegram bot token from @BotFather, as `<digits>:<letters and digits>`. The bot stops at start with a one-line message when it is missing, malformed or refused by Telegram |

Everything else is a constant in the source, so a change to a limit is a code change and goes through review and tests:

| What | Where |
| --- | --- |
| Time per run, guest memory, stack size, code length, minimum inline query length, rate limits, sandbox time per user, how many updates run at once | `src/config/env.ts` |
| Console lines, console line length, result length | `src/bot/createBot.ts` |
| Defaults used by the sandbox on its own (the benchmark, the tests) | `src/services/sandbox/types.ts` |

If the sandbox process cannot be started on your machine, the bot logs it and runs QuickJS inside its own process instead. That keeps the interrupt handler and the memory cap but not the hard kill, so look for `Sandbox process is unavailable` in the log before you expose a bot to other people.

## What It Prints

One line per event, and never the code people send or the answers built from it:

- `Bot started as @name`, once it is polling
- `Last 60s: ...`, a line of counts (updates, the most calls to Telegram waiting at once, waits for a 429, retries, memory) every minute while the bot is busy, and nothing while it is idle
- `Bot error in message#123: sendMessage failed with 429: ...`, when an update could not be handled: the kind of update and what failed, not what was in it
- `Could not publish the command menu: setMyCommands failed with ...`, when the menu cannot be published at startup; the bot keeps running without it
- `SIGTERM received` and `Stopped after N ms`, when the process is asked to end; it finishes the answers in progress first, for at most 8 s
- `Crashed: ...`, once, when an error nothing handled reaches the top; the token is taken out of it and the process exits with status 1, so a supervisor can start it again

## Project Layout

```text
src/bot/               grammY handlers, message formatting
src/security/          rate limiter and input guards
src/runtime/           calls to Telegram (spacing, retries), shutdown, logs
src/services/sandbox/  the QuickJS sandbox, its child process and the guest runtime
src/config/            limits and environment
test/                  tests, run with bun test
scripts/               benchmark, soak test, fake Telegram API
```

[ARCHITECTURE.md](ARCHITECTURE.md) describes how a message becomes an answer and how the sandbox is put together.

## Usage

Private chat:

```js
1 + 1
```

```js
const user = { name: "Ada", tags: ["math"] };
user
```

```js
console.log("fetching");
const n = await Promise.resolve(41);
return n + 1;
```

```ts
const total: number = [1, 2, 3].reduce((a, b) => a + b, 0);
total
```

Edit the message and the answer is updated.

Group chat:

```text
/run [1, 2, 3].map(n => n * 2)
```

Or reply to a message that has code in it with `/run`. The bot reads only what is addressed to it, so it works with Telegram's default privacy mode left on.

Inline mode:

```text
@your_bot_name 1 + 1
```

Note:

- Enable inline mode in `@BotFather`
- Send `/help` for examples

## Contributing

Bug reports and pull requests are welcome. Before you open one, run `bun test` and `bun run typecheck`; CI runs the same two commands. Keep a change to one thing, and add a test with it. Changes under `src/services/sandbox/` get extra care, because that code runs strangers' programs. [CONTRIBUTING.md](CONTRIBUTING.md) has the details.

## License

[MIT](LICENSE)
