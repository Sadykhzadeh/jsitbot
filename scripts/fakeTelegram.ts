// A stand-in for the Telegram Bot API, just enough for the bot to start, poll
// and answer. It counts the calls it gets and lets a script feed updates in.
import type { Update } from "grammy/types";

export const BOT_ID = 4242;

// Methods Telegram counts against the limit on messages a bot may send.
const SENDING = new Set(["sendMessage", "editMessageText", "setMessageReaction"]);

export interface FakeTelegram {
  url: string;
  /** Calls received so far, by method. */
  calls: Map<string, number>;
  /** Calls refused with 429 because the bot sent too fast. */
  refused: { count: number };
  /** Hands an update to the bot's next (or current) getUpdates. */
  push(update: Update): void;
  /** Resolves once the bot has asked for updates after `updateId`, which it does when it has taken that one. */
  waitForOffset(updateId: number, timeoutMs?: number): Promise<void>;
  /** Resolves when `count` calls of `method` have been seen in total. */
  waitFor(method: string, count: number, timeoutMs?: number): Promise<void>;
  stop(): void;
}

export function startFakeTelegram(
  options: {
    latencyMs?: number;
    port?: number;
    /** Messages the bot may send per second before Telegram answers 429. No limit when left out. */
    sendsPerSecond?: number;
    /** Answers 401 to any other token, as Telegram does for one it does not know. */
    token?: string;
  } = {},
): FakeTelegram {
  const latencyMs = options.latencyMs ?? 0;
  const calls = new Map<string, number>();
  const refused = { count: 0 };
  const sentAt: number[] = [];
  const queue: Update[] = [];
  const pollers: Array<() => void> = [];
  const watchers: Array<{ method: string; count: number; done: () => void }> = [];
  const offsetWatchers: Array<{ updateId: number; done: () => void }> = [];
  let highestOffset = 0;
  let nextMessageId = 1;

  function wake(): void {
    for (const poller of pollers.splice(0)) {
      poller();
    }
  }

  function count(method: string): void {
    const total = (calls.get(method) ?? 0) + 1;
    calls.set(method, total);
    for (const watcher of [...watchers]) {
      if (watcher.method === method && total >= watcher.count) {
        watchers.splice(watchers.indexOf(watcher), 1);
        watcher.done();
      }
    }
  }

  async function handle(method: string, body: Record<string, any>): Promise<unknown> {
    if (method === "getUpdates") {
      const offset: number = body.offset ?? 0;
      highestOffset = Math.max(highestOffset, offset);
      for (const watcher of offsetWatchers.filter((w) => offset > w.updateId)) {
        offsetWatchers.splice(offsetWatchers.indexOf(watcher), 1);
        watcher.done();
      }
      while (queue.length > 0 && queue[0].update_id < offset) {
        queue.shift();
      }
      if (queue.length === 0 && (body.timeout ?? 0) > 0) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, body.timeout * 1000);
          pollers.push(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      return queue.filter((update) => update.update_id >= offset).slice(0, body.limit ?? 100);
    }

    if (latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
    }

    switch (method) {
      case "getMe":
        return {
          id: BOT_ID,
          is_bot: true,
          first_name: "Fake",
          username: "fakebot",
          can_join_groups: true,
          can_read_all_group_messages: false,
          supports_inline_queries: true,
        };
      case "sendMessage":
      case "editMessageText":
        return {
          message_id: body.message_id ?? nextMessageId++,
          date: 0,
          chat: { id: body.chat_id, type: "private" },
          text: body.text,
        };
      default:
        return true;
    }
  }

  const server = Bun.serve({
    port: options.port ?? 0,
    async fetch(request) {
      const method = new URL(request.url).pathname.split("/").pop() ?? "";
      const body = await readBody(request);
      count(method);

      if (options.token && !new URL(request.url).pathname.startsWith(`/bot${options.token}/`)) {
        return Response.json({ ok: false, error_code: 401, description: "Unauthorized" }, { status: 401 });
      }

      if (options.sendsPerSecond && SENDING.has(method)) {
        const now = performance.now();
        while (sentAt.length > 0 && sentAt[0] <= now - 1_000) {
          sentAt.shift();
        }
        if (sentAt.length >= options.sendsPerSecond) {
          refused.count++;
          return Response.json(
            {
              ok: false,
              error_code: 429,
              description: "Too Many Requests: retry after 1",
              parameters: { retry_after: 1 },
            },
            { status: 429 },
          );
        }
        sentAt.push(now);
      }

      const result = await handle(method, body as Record<string, any>);
      return Response.json({ ok: true, result });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    calls,
    refused,
    push(update) {
      queue.push(update);
      wake();
    },
    waitFor(method, total, timeoutMs = 10_000) {
      if ((calls.get(method) ?? 0) >= total) {
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Timed out waiting for ${total} calls of ${method}`)),
          timeoutMs,
        );
        watchers.push({
          method,
          count: total,
          done: () => {
            clearTimeout(timer);
            resolve();
          },
        });
      });
    },
    waitForOffset(updateId, timeoutMs = 10_000) {
      if (highestOffset > updateId) {
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`The bot never asked for updates after ${updateId}`)), timeoutMs);
        offsetWatchers.push({
          updateId,
          done: () => {
            clearTimeout(timer);
            resolve();
          },
        });
      });
    },
    stop() {
      server.stop(true);
    },
  };
}

/** The JSON a request carries. The client compresses its bodies, which Bun.serve leaves alone. */
async function readBody(request: Request): Promise<Record<string, any>> {
  if (request.method !== "POST") {
    return {};
  }

  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const text =
      request.headers.get("content-encoding") === "gzip"
        ? new TextDecoder().decode(Bun.gunzipSync(bytes))
        : new TextDecoder().decode(bytes);
    return JSON.parse(text);
  } catch {
    return {};
  }
}
