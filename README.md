# [@jsitbot](https://t.me/jsitbot)

Telegram bot for running JavaScript in an isolated sandbox.

## Stack

- Bun
- TypeScript
- grammY
- quickjs-emscripten

## What It Does

- Executes JavaScript from private messages and inline queries
- Re-runs a message when you edit it, and updates the answer in place
- Returns the value of the last statement, like a REPL, and understands `return` and top-level `await`
- Accepts TypeScript syntax (the types are stripped)
- Prints results and `console` output the way Node does: `Map(2) { 'a' => 1 }`, class instances, errors, cycles
- Reports the line an error came from

## Security

- Fresh WebAssembly instance and QuickJS runtime per execution; nothing survives into the next run
- Runs in a separate process that has none of the bot's configuration. A run that has not reported back 400 ms after its timeout gets the process killed and replaced, so even a single native call that never returns cannot hold the bot or keep eating memory
- Hard memory cap on the WebAssembly heap (QuickJS's own limit does not see large allocations in the Emscripten build)
- Timeout enforced by the engine's interrupt handler, with a clock that starts when the guest does
- Output is bounded inside the sandbox: at most 50 console lines of 2000 characters and a 4000-character result, whatever the code prints
- No Bun/Node host APIs exposed to guest code; the formatter captures the built-ins it needs before user code runs
- Per-user rate limits; a run that times out is charged as three requests

| Limit | Value |
| --- | --- |
| Time per run | 700 ms |
| Guest memory | 64 MB |
| Code length | 2000 characters |
| Console lines | 50, up to 2000 characters each |
| Result | 4000 characters |
| Private chat | 5 runs per 10 s |
| Inline | 12 runs per 10 s |

## Setup

```bash
bun install
cp .env.example .env
```

Set:

```env
BOT_TOKEN=your_telegram_bot_token
```

Run:

```bash
bun run dev
```

## Scripts

```bash
bun run dev
bun run start
bun run test
bun run typecheck
bun run bench
```

`bun run bench` starts the sandbox the way the bot does and prints startup time, first-run latency and warm p50/p95 for a few typical programs.

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

Inline mode:

```text
@your_bot_name 1 + 1
```

Note:

- Enable inline mode in `@BotFather`
- Bun loads `.env` automatically
- Send `/help` for examples
