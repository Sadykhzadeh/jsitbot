# [@jsitbot](https://t.me/jsitbot)

Telegram bot for running JavaScript in an isolated sandbox.

## Stack

- Bun
- TypeScript
- grammY
- quickjs-emscripten

## What It Does

- Executes JavaScript from private messages, group chats and inline queries, handling up to 8 updates at a time
- In a private chat, re-runs a message when you edit it and updates the answer in place, `/run` commands included. The bot remembers recent answers in memory only, so after a restart an edit is answered as a new message
- In a private chat, sends the whole output as a text file after the answer when it does not fit in one message
- Returns the value of the last statement, like a REPL, and understands `return` and top-level `await`
- Accepts TypeScript syntax (the types are stripped)
- Has `setTimeout`, `setInterval`, `setImmediate` and their `clear` twins on a virtual clock: a sleep returns at once instead of using up the time limit, and `Date.now()` does not move. `performance.now()` does move with it, so a measurement around a sleep shows the sleep, and so does `performance.mark` and `measure` (entries are plain objects, not `PerformanceMark`). Timers return a `Timeout` with `ref`, `unref`, `hasRef`, `refresh` and `close`, as Node does, and an unreferenced timer does not keep the run going. An interval that is never cleared runs until the time limit
- Has `global` (the same as `globalThis`), `Symbol.dispose` and `Symbol.asyncDispose` (the engine has no `using`), `queueMicrotask`, `Array.fromAsync`, `Error.captureStackTrace` (the stack it sets is the name and message only), `structuredClone`, `TextEncoder` (UTF-8) and `TextDecoder` (UTF-8, UTF-16 little and big endian, and Latin-1 as windows-1252), `atob` and `btoa`, and `URL` and `URLSearchParams` (the WHATWG parser: non-ASCII host names become punycode after compatibility normalisation, and IPv4 and IPv6 addresses are written in their canonical form)
- Has the base64 and hex methods of `Uint8Array` (`fromBase64`, `toBase64`, `fromHex`, `toHex`, `setFromBase64` and `setFromHex`), with the options, the errors and the stop points Node has
- Has the part of `Buffer` programs use: `from` (strings in any encoding named below, arrays, array buffers, typed arrays, buffers, a String object or an object with a `valueOf` that gives one of those, and the `{ type: "Buffer", data }` form that `toJSON` writes), `alloc`, `allocUnsafe`, `concat`, `byteLength`, `isBuffer`, `isEncoding` and `compare`; and on a buffer `toString` and `toLocaleString` (utf8, hex, base64, base64url, latin1, binary, ascii, utf16le and ucs2, with a start and an end), `equals`, `slice`, `subarray`, `fill`, `indexOf`, `lastIndexOf`, `includes`, `compare`, `write`, `toJSON`, `readUInt8`, `readUInt16LE`/`BE` and `readUInt32LE`/`BE`, the signed `readInt8`, `readInt16LE`/`BE` and `readInt32LE`/`BE`, `readFloatLE`/`BE`, `readDoubleLE`/`BE`, and `readBigInt64LE`/`BE` and `readBigUInt64LE`/`BE`, each with its `write` method and with the lowercase name (`readUint8`, `readBigUint64BE`), `readUIntLE`/`BE` and `readIntLE`/`BE` with a byte length from 1 to 6 and their writes, `copy`, and `swap16`, `swap32` and `swap64`. A buffer is a `Uint8Array` and prints as `<Buffer 68 69>`. Not there: the `Buffer` pool, and the `Buffer()` deprecation warning
- Has `DisposableStack`, `AsyncDisposableStack` and `SuppressedError` as Node 26 has them (`use`, `adopt`, `defer`, `move`, `dispose` and `disposeAsync`, the `disposed` flag, and the suppressed-error chain). The engine has no `using` syntax, so these are used by calling their methods, not with `using` declarations
- Has `Blob` and `File` in memory, as Node has them: parts from strings (UTF-8), buffers, array buffers, views and blobs; `size`; `type` lower-cased when it is printable ASCII; `slice`, `text()`, `arrayBuffer()` and `bytes()`; `endings`; and the printing of both. `stream()` throws an error saying it is not supported, because the sandbox has no streams
- Has `EventTarget`, `Event`, `CustomEvent`, `DOMException`, `AbortController` and `AbortSignal` (`abort`, `timeout`, `any`). There is no tree, so an event only reaches listeners of the target it is dispatched on, and `AbortSignal.timeout` counts on the virtual clock
- Sorts with `localeCompare` the way a browser does for most text: small letters before capitals, accents after letters, and the options `numeric`, `sensitivity`, `caseFirst` and `ignorePunctuation`. The locale is not looked at
- Maps case in `toLocaleUpperCase` and `toLocaleLowerCase` for Turkish and Azeri, where `i` and `I` have dotted and dotless forms (`"i".toLocaleUpperCase("tr")` is `İ`). Every other locale gets the engine's mapping. The first locale is checked as Node checks it, so a malformed tag is a `RangeError`
- Formats numbers with `toLocaleString` in English style (`1,234,567.891`, `{ style: "currency", currency: "USD" }` (also `currencyDisplay: "code"`, `"narrowSymbol"` and `"name"`, the name for USD, EUR, GBP, JPY, INR, KRW, CNY, CAD and AUD, and `currencySign: "accounting"`), `percent`, `style: "unit"` as in `1.5 kilometers` or `3km/h` for the units `Intl.supportedValuesOf` lists and `kilometer-per-hour`, `mile-per-hour` and `meter-per-second`, with `unitDisplay` short, narrow or long, `notation: "compact"` as in `1.2M`, `"scientific"` as in `1.235E4`, `"engineering"`, the digit options, the significant-digit options, `roundingIncrement` (in the standard notation, with fraction digits only, and refused with compact, scientific and engineering notation), `useGrouping`, `signDisplay` and `roundingMode`); another language or option it does not know gets the engine's plain output; a unit that is not a unit (`unit: "furlong"`) is refused with a `RangeError`, as Node refuses it. A currency outside that list is written with its code under `currencyDisplay: "name"`, as in `1.50 BTC`
- Has `Intl.NumberFormat`, `Intl.Collator` and `Intl.DateTimeFormat`, which are `toLocaleString` of numbers, `localeCompare` and `toLocaleString` of dates under another name. `resolvedOptions` tells the options that were asked for with the defaults of English (United States) filled in, and the time zone of the machine the bot runs on. `Intl.NumberFormat`, `Intl.DateTimeFormat`, `Intl.ListFormat` and `Intl.RelativeTimeFormat` have `formatToParts`. `Intl.supportedValuesOf` lists `calendar`, `collation`, `currency`, `numberingSystem`, `timeZone` and `unit` with the lists Node 26.13 gives, which do not depend on the host, and `Intl.getCanonicalLocales` writes each tag as `Intl.Locale` does, but not the aliases Node maps, such as `iw` for `he`
- Has `Intl.DisplayNames` for English, with the types `region` (`style` long, short or narrow, as in `US`, `UK` and `United States`; the UN areas such as `419`), `currency` (`US Dollar`) and `language` for the two-letter base languages (`fr` is `French`). `fallback` is `code` or `none`. A tag with a region or script, such as `en-US` or `zh-Hant`, a three-letter language code, and the types `script`, `calendar` and `dateTimeField` are not named: the first gets the tag back, and the types are refused with a `RangeError`. Another language is refused as `Intl.PluralRules` refuses it
- Has `Intl.Locale`, which reads a tag into `language`, `script`, `region` and `baseName`, and gives `toString` in Node's canonical case with the variants sorted, the keywords of the Unicode extension sorted (a key given twice keeps its first value, and a value of `true` is left out) and the other extensions kept, and takes the `language`, `script` and `region` options. Not there: `maximize` and `minimize`, which need the likely-subtags data, the keyword getters such as `calendar`, `hourCycle` and `getCalendars`, and the aliases of tags and values such as `iw` for `he`
- Has `Intl.PluralRules` (`select` and `selectRange`, cardinal and ordinal), `Intl.ListFormat` (`format` and `formatToParts`, all types and styles) and `Intl.RelativeTimeFormat` (`format` and `formatToParts`, all styles, `numeric: "auto"`) for English. `Intl.Segmenter` cuts graphemes (joined emoji and flags stay whole), words and sentences by rules that are the same for every language and only approximate Unicode's. Another language is refused with a `RangeError` rather than answered with English rules
- Writes dates with `toLocaleString`, `toLocaleDateString` and `toLocaleTimeString` the way English (United States) does: the options `weekday`, `year`, `month`, `day`, `hour`, `minute`, `second`, `fractionalSecondDigits`, `hour12`, `hourCycle`, `dateStyle`, `timeStyle` and `timeZoneName`, in local time, in UTC, or in any time zone by name (`timeZone: "Asia/Tokyo"`, with the zone names the machine's time zone data gives). Another language, an era or a day period gets the engine's plain output, which `formatToParts` gives as one literal part; so does a weekday with a narrow month, a day with a year and no month, and an hour with a second or a fraction of a second and no minute, which Node writes with the missing field named in brackets or in a box
- Ends `Date.prototype.toString` and `toTimeString` with the name of the machine's time zone in brackets, as Node does
- Has `crypto.subtle.digest` (SHA-1, SHA-256, SHA-384 and SHA-512; nothing else of `crypto.subtle`), `crypto.getRandomValues` and `crypto.randomUUID`. The numbers are well spread and differ from run to run, but they come from a small generator inside the sandbox and are not secure; do not use them for secrets
- Takes code pasted in a fenced block, with or without a language name. When a message has text around its block, the block is what runs, as Telegram marks it, in a private chat as in a group reply
- In a private chat, runs a `.js`, `.mjs`, `.cjs`, `.ts`, `.mts` or `.cts` file sent as a document, with the same limits as a message, and answers as a reply to the file
- Runs code in group chats when it is asked to: `/run 1 + 1`, `@your_bot_name 1 + 1`, `/run` or `@your_bot_name` as the caption of a `.js`, `.mjs`, `.cjs`, `.ts`, `.mts` or `.cts` file, or `/run` as a reply to a message that has the code or to such a file. It ignores everything else that is said there
- Prints results and `console` output the way Node does: `Map(2) { 'a' => 1 }`, class instances, errors (a subclass of `Error` by its class: `ValidationError: bad input`), cycles, and a proxy as `Proxy(` its target `)` without running its traps. The items of a Map or Set iterator are not shown (`[Map Iterator] { <items unknown> }`), because reading them would use them up
- Besides `console.log` and friends it has `console.table`, `assert`, `count`, `group` and `time`
- Reports the line an error came from, and for a syntax error shows that line with a caret under the column (a line longer than 80 characters is cut around the column). When an error is printed, reading or writing a property of `undefined` or `null`, a name that is not defined, an assignment to a const, a call of a name or a chain of names that is not a function (`obj.run is not a function`, or `f(...).go` for a call of a result), a variable used before its `let`, a name that is not iterable in a for-of loop, an array spread or an array pattern, a symbol turned into a string or number, `reduce` of an empty array and an invalid array length, an invalid date, a malformed URI and `Object.keys` and the like given null or undefined are worded as Node words them (`Cannot read properties of undefined (reading 'x')`); `error.message` itself keeps the engine's wording, as do the other errors

## TypeScript

A snippet that does not run as JavaScript is read as TypeScript, and its types are removed before it runs. Code that runs as JavaScript is never changed. Types are not checked: `const n: number = "a"` runs and gives `a`.

An empty `export {};`, which TypeScript uses to make a file a module, is left out of a snippet, so the snippet runs. An export with a name is still refused. A snippet that has an empty export and a top-level `return` runs as a script, like any snippet without exports, so it is not in strict mode the way a module is.

Errors point at what you wrote: a runtime error gives the line of your code, and a syntax error shows that line with a caret under its column, also when types come before it. A runtime error inside a statement that spans lines gives the line of the part that failed, found from the place the engine reports. The exception is code that awaits or returns at its top level, and an error whose name is on more than one line: there it gives the line the statement starts on.

Supported, with the same meaning as in `tsc`:

- Annotations, `interface`, `type`, generics on functions, classes and calls, `as`, `satisfies`, `!`, `let x!: T`, optional parameters, overload signatures, `declare`, `abstract` classes and members, index signatures, `unique symbol`, `asserts`, `infer`, template literal types, `this` parameters, `implements`, `override` and `readonly`, `<T,>(x: T) => x` and `<number>value`
- `enum` (regular, `const`, string and computed members, reverse mapping), `namespace` with exported members, and parameter properties such as `constructor(private x: number)`
- `declare module`, `declare global` and triple-slash directives, which are erased and so run

Not supported, and refused with one line:

- Decorators, `accessor` and `using` (`decorators, accessor and using are not supported`)
- `import type` and `export type`, which get the same hint as `import` and `export`
- `import x = require(...)` and `export = x`, which get the same hint as `import` and `export`
- JSX, such as `<div />` or `<>text</>`, which gets the one line `JSX is not supported`, since the sandbox has no element syntax

## How Output Compares With Node

Measured with `bun run compat` against Node 26.13.0: 397 snippets in `scripts/node-diff/corpus`, run once by Node with `console.log` and once by the sandbox, both at a depth of 3 (what the sandbox shows; Node's own default is 2). 390 match exactly (98.2%). The corpus covers the inspect and console test inputs, hand-picked containers, errors and iterators, generated runs of line width, grouping, nesting and numbers, template literals, JSON, dates, null-prototype objects, generators, classes, proxies, reflection, weak references, namespaces, functions and the console forms. To reproduce it, see [Running the comparison](#running-the-comparison).

| Group (corpus file) | Snippets | Exact |
| --- | ---: | ---: |
| Basic: inspect and console inputs, containers, errors, formats (`basic.txt`) | 56 | 56 |
| Built-ins, console forms, prototypes, text and numbers (`builtins.txt`) | 125 | 122 |
| Options of console.dir: depth and showHidden (`console-options.txt`) | 26 | 26 |
| Edge cases: prototypes, tagged objects, console table, dir, count (`edge.txt`) | 101 | 99 |
| Targeted at single formatting rules (`targeted.txt`) | 89 | 87 |
| Total | 397 | 390 |

Deliberate differences, with the reason:

- Nested objects are shown three levels deep, Node shows two: a little more is visible without asking.
- Errors have their header and no stack frames, so there are no `at` lines and the paths of the bot are not shown.
- The items of a Map, Set or weak collection are not read, so an iterator shows `<items unknown>`: reading would use them up.
- `console.table` cuts rows, columns and long cells, and `console.dir` cuts a long string, so one reply stays short.
- A getter that throws in `console.table` shows `[Unreadable]`: a formatting error does not end the run.
- A promise still pending when the program ends is an error: the sandbox waits for the result of the run.
- A listener that throws does not stop the run, because events have no event loop behind them.
- `globalThis` and `console` have the names the sandbox provides, not Node's, and `Atomics` is not provided.
- `fetch`, `Request`, `Response`, `Headers`, `FormData`, `navigator`, `MessageChannel`, `BroadcastChannel` and `WebAssembly` are not provided, so a program that names them gets a `ReferenceError`: the sandbox has no network and no host APIs.
- A program that starts with `{ a: 1 }` shows the object, as a REPL does.
- A lone surrogate in a string printed on its own is written as U+FFFD, so the text sent to Telegram is well-formed; Node escapes it as `\ud83d`. Inside an array or object the sandbox escapes it, as Node does.

Known gaps, not fixed yet:

- A call that a built-in makes with a value that is not a function, such as `[1].map(3)`, is `TypeError: not a function`, where Node names the value. A class called without `new`, and an object destructuring of null or undefined, keep the engine's wording.
- A value that is not iterable and not a name on its line keeps the engine's wording, `value is not iterable`: `for (const x of 5)`, and a spread in the arguments of a call such as `Math.max(...n)`, where Node names the value or says the spread needs an iterator.
- `%o` on an error does not show its hidden properties, such as `[stack]` and `[message]`: Node prints them after the stack frames, and the sandbox shows no frames.
- Properties added to a typed array longer than 100,000 items are not shown: listing its keys would make one for each item. Shorter ones show them after the items, as Node does.
- A `%s` with an object whose `toString` throws is shown as the object, where Node stops the whole call. A test pins this, so it stays until it is decided.
- The iterator of `Map.prototype.entries()` and of `Set.prototype.entries()` is named `Map Iterator` and `Set Iterator`, where Node says `Map Entries` and `Set Entries`: the sandbox cannot tell the kind without using the iterator.
- An object whose prototype chain has no constructor, such as `Object.create(Object.create(null))`, is shown as a null-prototype object, where Node adds the prototype after `Object <…>`.
- A class instance whose prototype was removed prints as `[Object: null prototype]`; Node names the class it was made by, which the engine does not keep.
- An async or generator function whose prototype is not the one of its kind is shown as a plain function, where Node names its kind.
- A number above 2^53 with a `roundingIncrement` can differ from Node in its last digits: `12345678901234567890` with a step of 2 is `12,345,678,901,234,568,000` in Node and `...567,000` here.
- A rejected promise that nothing handles does not stop the run, where Node stops with the error. The engine does not report such a rejection, so the sandbox only shows it when it is the value of the run; otherwise the run gives its own result, as if the rejection had been handled. An error thrown by a timer does stop the run, as in Node.
- `Temporal` and `Intl.DurationFormat` are not provided yet. `Math.sumPrecise` is provided, which Node 26 does not have.

### Running the comparison

`bun run compat` runs each snippet of `scripts/node-diff/corpus` in the sandbox and in Node 26, and prints how many match. It needs a Node 26 on your machine, named by `NODE26`; it is not part of `bun test` and CI does not run it.

```bash
NODE26=$HOME/.nvm/versions/node/v26.13.0/bin/node bun run compat
NODE26=wsl:/home/user/.nvm/versions/node/v26.13.0/bin/node bun run compat   # Node inside WSL, run from Windows
bun run compat -- --verbose    # also prints each snippet that differs, with both outputs
```

To add snippets, append them to a corpus file, separated by a line that holds only `---8<---`. Each snippet is one program; its output is what `console.log` writes.

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
| Nested calls | at least 2,000 deep |
| Code length | 2000 characters |
| Console lines | 50, up to 2000 characters each |
| Result | 4000 characters |
| Private chat | 5 runs per 10 s |
| Inline | 12 runs per 10 s |
| Sandbox time per user | 1 s per 10 s, private and inline together |

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Running It Locally

You need:

- [Bun](https://bun.sh) 1.3.10 or newer (CI runs 1.3.10 and 1.4.4). Node is not needed.
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

It prints `Bot started as @your_bot_name` once it is polling. Bun loads `.env` from the directory it is started in, so start the bot from the project folder, or name the file with `bun --env-file=/path/to/.env src/index.ts`. The sandbox process is started without `.env` and without the rest of the bot's environment.

### Getting a bot token

1. Open [@BotFather](https://t.me/BotFather) in Telegram and send `/newbot`.
2. Pick a display name, then a username that ends in `bot`.
3. BotFather replies with a token that looks like `<digits>:<letters, digits, _ and ->`. Put it in `.env`. Anyone who has the token controls the bot, so do not commit it.
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
| `bun run bench` | Starts the sandbox the way the bot does and prints startup time, first-run latency and warm p50/p95 for a few typical programs. `--runs=150` sets how many runs each latency measurement takes |
| `bun run soak` | Starts the real bot against a local stand-in for the Telegram API and prints start-up time, the memory of the bot and its sandbox process, and how a burst of messages is answered. `--starts=7` sets how many starts are timed, `--messages=300` the size of the burst, `--users=60` how many users send it, `--latency=30` the milliseconds each call to the stand-in takes, and `--limit=30` makes it refuse sends above 30 a second, as Telegram does |
| `bun run compat` | Compares the sandbox output with Node 26 for every snippet in `scripts/node-diff/corpus`; needs `NODE26`, see [Running the comparison](#running-the-comparison) |

## Configuration

The only setting read from the environment is the token:

| Variable | Required | Meaning |
| --- | --- | --- |
| `BOT_TOKEN` | yes | Telegram bot token from @BotFather, as `<digits>:<letters, digits, _ and ->`. The bot stops at start with a one-line message when it is missing, malformed, refused by Telegram or when Telegram cannot be reached |

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
- `Last 60s: ...`, a line of counts (updates, the most calls to Telegram waiting at once, waits for a 429, retries, runs, timeouts, the slowest run, memory) every minute while the bot is busy, and nothing while it is idle
- `Bot error in message#123: sendMessage failed with 429: ...`, when an update could not be handled: the kind of update and what failed, not what was in it
- `Could not publish the command menu: setMyCommands failed with ...`, when the menu cannot be published at startup; the bot keeps running without it
- `Could not get updates from Telegram, retrying: ...` (or `Telegram did not answer the poll in time, retrying`), once when polling starts to fail, and `Telegram answers again` once it works: nothing is printed for the retries in between
- `SIGTERM received` and `Stopped after N ms`, when the process is asked to end; it finishes the answers in progress first, for at most 8 s
- `Crashed: ...`, once, when an error nothing handled reaches the top; the token is taken out of it and the process exits with status 1, so a supervisor can start it again

## Project Layout

```text
src/bot/               grammY handlers, message formatting
src/security/          rate limiter and input guards
src/runtime/           calls to Telegram (spacing, retries), shutdown, logs
src/services/sandbox/  the QuickJS sandbox, its child process and the guest runtime
src/config/            limits and environment
src/utils/             MarkdownV2 escaping and text helpers
test/                  tests, run with bun test
scripts/               benchmark, soak test, fake Telegram API, Node comparison (scripts/node-diff)
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

Or send a `.js`, `.mjs`, `.cjs`, `.ts`, `.mts` or `.cts` file: the bot runs its contents and answers as a reply to it.

Group chat:

```text
/run [1, 2, 3].map(n => n * 2)
```

Or reply to a message that has code in it, or to a `.js`, `.mjs`, `.cjs`, `.ts`, `.mts` or `.cts` file, with `/run`, or send such a file with `/run` as its caption. The bot reads only what is addressed to it, so it works with Telegram's default privacy mode left on.

Inline mode:

```text
@your_bot_name 1 + 1
```

Note:

- Enable inline mode with `/setinline` in [@BotFather](https://t.me/BotFather), as [Getting a bot token](#getting-a-bot-token) shows
- Send `/help` for examples

## Contributing

Bug reports and pull requests are welcome. Before you open one, run `bun test` and `bun run typecheck`; CI runs the same two checks, with the tests spread over three processes. Keep a change to one thing, and add a test with it. Changes under `src/services/sandbox/` get extra care, because that code runs strangers' programs. [CONTRIBUTING.md](CONTRIBUTING.md) has the details.

## License

[MIT](LICENSE)
