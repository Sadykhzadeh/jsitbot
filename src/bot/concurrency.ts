import { BotError, type Bot, type Context, type MiddlewareFn } from "grammy";

export interface ConcurrencyPolicy {
  /** How many updates may be in progress at once, whoever they are from. */
  limit: number;
  /** How many of them one user may have in progress or waiting; the rest are dropped. */
  perUser: number;
}

interface UserQueue {
  /** Settles when everything this user has queued so far has finished. */
  tail: Promise<void>;
  count: number;
}

/**
 * grammY hands updates to the handlers one at a time, and a handler is not done
 * until Telegram has taken its reply, so the bot spent nearly all of its time
 * waiting for the network while the sandbox sat idle. This runs several updates
 * at once instead.
 *
 * An update from one user still waits for that user's earlier ones, so an edit
 * is handled after the run it edits and replies come in order. A user who has
 * `perUser` updates in progress gets the next ones dropped: that is a flood, and
 * answering each would cost more than what it is worth. When `limit` updates are
 * in progress, polling waits for a free place.
 */
export function handleConcurrently<C extends Context>(
  bot: Bot<C>,
  policy: ConcurrencyPolicy,
): MiddlewareFn<C> {
  const users = new Map<number, UserQueue>();
  const waiting: Array<() => void> = [];
  let running = 0;

  function release(): void {
    const next = waiting.shift();
    if (next) {
      next();
    } else {
      running--;
    }
  }

  async function report(error: unknown, ctx: C): Promise<void> {
    try {
      await bot.errorHandler(error instanceof BotError ? error : new BotError(error, ctx));
    } catch (unhandled) {
      console.error("Error in the bot's error handler:", unhandled);
    }
  }

  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId !== undefined && (users.get(userId)?.count ?? 0) >= policy.perUser) {
      return;
    }

    if (running >= policy.limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      running++;
    }

    // Looked up only now: the user's earlier updates may have finished while
    // this one waited for a place.
    let own = userId === undefined ? undefined : users.get(userId);
    if (userId !== undefined && !own) {
      own = { tail: Promise.resolve(), count: 0 };
      users.set(userId, own);
    }

    const before = own?.tail ?? Promise.resolve();
    if (own) {
      own.count++;
    }

    const finished = before
      .then(() => next())
      .catch((error) => report(error, ctx))
      .finally(() => {
        if (own && --own.count === 0 && userId !== undefined) {
          users.delete(userId);
        }
        release();
      });

    if (own) {
      own.tail = finished;
    }
  };
}
