# [@jsitbot](https://t.me/jsitbot)

Telegram bot for running JavaScript in an isolated sandbox.

## Stack

- Bun
- TypeScript
- grammY
- quickjs-emscripten

## What It Does

- Executes JavaScript from private messages
- Executes JavaScript from inline queries
- Captures `console.log`
- Returns result or error in Telegram-friendly format

## Security

- Fresh sandbox per execution
- Strict timeout and memory limits
- No Bun/Node host APIs exposed to guest code

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
```

## Usage

Private chat:

```js
1 + 1
```

Inline mode:

```text
@your_bot_name 1 + 1
```

Note:

- Enable inline mode in `@BotFather`
- Bun loads `.env` automatically
