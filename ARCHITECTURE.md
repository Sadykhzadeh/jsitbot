# Architecture

`@jsitbot` is a small Telegram bot with one core responsibility: receive JavaScript, run it inside an isolated sandbox, and send the output back in a Telegram-friendly format.

## Overview

```mermaid
flowchart LR
    A["Telegram update"] --> B["Bot layer"]
    B --> C["Guards"]
    C --> D["QuickJS sandbox"]
    D --> E["Formatter"]
    E --> F["Telegram response"]
```

## Main Parts

- Bot layer: receives Telegram updates and routes them to the right handler
- Guard layer: applies basic validation and rate limiting
- Sandbox layer: runs untrusted JavaScript in isolation
- Formatting layer: converts output into Telegram-safe text

## Private Message Flow

```mermaid
flowchart TD
    A["Private message"] --> B["Private handler"]
    B --> C{"Valid request?"}
    C -- "No" --> D["Reject / ignore"]
    C -- "Yes" --> E["Execute in sandbox"]
    E --> F["Format result"]
    F --> G["Reply in private chat"]
```

Notes:

- normal private text is treated as code
- bot-generated inline results received in private chat are handled separately

## Inline Query Flow

```mermaid
flowchart TD
    A["Inline query"] --> B["Inline handler"]
    B --> C{"Short / invalid?"}
    C -- "Yes" --> D["Return help or rejection"]
    C -- "No" --> E["Execute in sandbox"]
    E --> F["Build inline preview"]
    F --> G["Return inline result"]
```

Notes:

- inline mode uses the same sandbox as private messages
- preview is short, final inserted message contains the formatted output

## Sandbox Flow

```mermaid
flowchart TD
    A["User code"] --> B["Validation"]
    B --> C["Fresh QuickJS runtime"]
    C --> D["Execute with limits"]
    D --> E["Capture logs"]
    E --> F["Collect result or error"]
    F --> G["Dispose runtime"]
```

## Execution Surfaces

- Private messages
- Inline queries

Both surfaces share the same execution model and the same output contract.

## Security Model

- Each execution is isolated
- CPU and memory usage are limited
- Host APIs are not exposed inside guest code
- `console.log` output is captured and returned

## Design Goal

Keep the bot small, predictable, and easy to maintain.
