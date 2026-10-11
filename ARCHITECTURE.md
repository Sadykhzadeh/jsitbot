# Architecture

`@jsitbot` is a small Telegram bot with one core responsibility: receive JavaScript, run it inside an isolated sandbox, and send the output back in a Telegram-friendly format.

## Overview

```mermaid
flowchart LR
    A["Telegram update"] --> B["Bot layer"]
    B --> C["Guards"]
    C --> D["Sandbox process (QuickJS)"]
    D --> E["Formatter"]
    E --> F["Telegram response"]
```

## Main Parts

- Bot layer: receives Telegram updates and routes them to the right handler
- Guard layer: applies basic validation and rate limiting
- Sandbox layer: runs untrusted JavaScript in isolation, in a separate process
- Formatting layer: converts output into Telegram-safe text

## Private Message Flow

```mermaid
flowchart TD
    A["Private message"] --> B["Private handler"]
    B --> C{"Command?"}
    C -- "Yes" --> D["Left to the command handlers"]
    C -- "No" --> G{"Valid request?"}
    G -- "No" --> H["Reject"]
    G -- "Yes" --> E["Execute in sandbox"]
    E --> F["Format result"]
    F --> I["Reply, and remember which reply answers which message"]
```

Notes:

- normal private text is treated as code; only `/word`, `/word@bot` followed by a space or the end of the message is a command, so a snippet that starts with a regular expression or a comment still runs
- bot-generated inline results received in private chat are handled separately
- an edited message is run again and the earlier answer is edited in place; the table that maps messages to answers is in memory and bounded, so after a restart an edit is answered as a new message

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
- results are not cached: code can read the clock or call `Math.random()`, and a run costs about a millisecond

## Sandbox Flow

```mermaid
flowchart TD
    A["User code"] --> B["Sandbox process"]
    B --> C["Fresh WebAssembly instance, capped heap"]
    C --> D["Guest runtime: console, formatter"]
    D --> E["Read the code: expression, script, function body, or TypeScript with types removed"]
    E --> F["Execute with interrupt handler"]
    F --> G["Bounded result string"]
    G --> H["Back to the bot over IPC"]
```

- The child process holds the QuickJS engine and a spare WebAssembly instance that is built while it is idle. Every run takes one instance and drops it afterwards. It is started with a minimal environment (no bot token) and exits when the bot goes away.
- The instance's memory has a hard maximum. QuickJS's own memory limit counts allocations rather than bytes in the Emscripten build, so it is not what stops a memory bomb.
- The guest runtime (`guest.js`) is evaluated first. It captures the built-ins it relies on, installs `console`, and turns results, errors and log lines into short strings, so nothing the guest controls is walked by the host.
- The code is tried as one expression, then as a script (the last statement's value is the result), then as a function body (`return`, top-level `await`). If none parses, the types are stripped with Bun's transpiler and the same readings are tried again.
- The bot waits for the child for the timeout plus a grace period. If it is still busy after that, it is killed and replaced (a replacement is ready in about 70 ms), and the run is reported as timed out. A process is killed outright; a worker thread kept running a stuck native call, and its memory, for seconds after being terminated.
- If a process cannot be started in the environment, the bot logs it and runs QuickJS inside itself, which keeps the interrupt handler and the memory cap but not the hard kill.

## Execution Surfaces

- Private messages
- Inline queries

Both surfaces share the same execution model and the same output contract.

## Security Model

- Each execution is isolated: its own WebAssembly instance, runtime and context
- CPU time is limited by the engine's interrupt handler and, as a backstop, by killing the process; memory is limited by the instance's maximum size
- Host APIs are not exposed inside guest code
- Output size is bounded inside the sandbox
- Per-user rate limits apply to private messages, edits and inline queries; a run that times out is charged extra

## Design Goal

Keep the bot small, predictable, and easy to maintain.
