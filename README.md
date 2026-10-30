# [@jsitbot](https://t.me/jsitbot)

Telegram bot for running JavaScript in an isolated sandbox.

## Stack

- Bun
- TypeScript
- grammY
- quickjs-emscripten

## What It Does

- Executes JavaScript from private messages and inline queries, answering up to 8 users at a time
- Re-runs a message when you edit it, and updates the answer in place
- Sends the whole output as a text file after the answer when it does not fit in one message
- Returns the value of the last statement, like a REPL, and understands `return` and top-level `await`
- Accepts TypeScript syntax (the types are stripped)
- Has `setTimeout`, `setInterval` and their `clear` twins on a virtual clock: a sleep returns at once instead of using up the time limit, and `Date.now()` does not move. `performance.now()` does move with it, so a measurement around a sleep shows the sleep. An interval that is never cleared runs until the time limit
- Has `queueMicrotask`, `Error.captureStackTrace` (the stack it sets is the name and message only), `structuredClone`, `TextEncoder` and `TextDecoder` (UTF-8 only), `atob` and `btoa`, and `URL` and `URLSearchParams` (host names are not converted to punycode and addresses are left as written)
- Sorts with `localeCompare` the way a browser does for most text: small letters before capitals, accents after letters, and the options `numeric`, `sensitivity`, `caseFirst` and `ignorePunctuation`. The locale is not looked at
- Formats numbers with `toLocaleString` in English style (`1,234,567.891`, `{ style: "currency", currency: "USD" }`, `percent`, the digit options and `useGrouping`); another language or option it does not know gets the engine's plain output
- Has `Intl.NumberFormat` and `Intl.Collator`, which are those two under another name. The rest of `Intl` (dates, plurals, lists) is not there
- Has `crypto.getRandomValues` and `crypto.randomUUID`. The numbers are well spread and differ from run to run, but they come from a small generator inside the sandbox and are not secure; do not use them for secrets
- Takes code pasted in a fenced block, with or without a language name
- Runs code in group chats when it is asked to: `/run 1 + 1`, `@your_bot_name 1 + 1`, or `/run` as a reply to a message that has the code. It ignores everything else that is said there
- Prints results and `console` output the way Node does: `Map(2) { 'a' => 1 }`, class instances, errors, cycles
- Besides `console.log` and friends it has `console.table`, `assert`, `count`, `group` and `time`
- Reports the line an error came from

## Security

- Fresh WebAssembly instance and QuickJS runtime per execution; nothing survives into the next run
- Runs in a separate process that has none of the bot's configuration. A run that has not reported back 150 ms after its timeout gets the process killed and replaced, so even a single native call that never returns cannot hold the bot or keep eating memory
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
- `SIGTERM received` and `Stopped after N ms`, when the process is asked to end; it finishes the answers in progress first, for at most 8 s

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
