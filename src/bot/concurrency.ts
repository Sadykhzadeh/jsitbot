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

interface PendingEdit {
  /** The arrival number of the newest edit of this message. */
  latest: number;
  /** Edits of this message that have arrived and are not finished. */
  pending: number;
}

/**
 * grammY hands updates to the handlers one at a time, and a handler is not done
 * until Telegram has taken its reply, so the bot spent nearly all of its time
 * waiting for the network while the sandbox sat idle. This runs several updates
 * at once instead.
 *
 * An update from one user still waits for that user's earlier ones, so an edit
 * is handled after the run it edits and replies come in order. Such an update
 * takes a place only once the earlier one is done, so a user's queue cannot
 * hold every place while it waits. A user who has `perUser` updates in progress
 * or waiting gets the next ones dropped: that is a flood, and answering each
 * would cost more than what it is worth. An edit of a message that already has
 * an edit waiting is not dropped, since it replaces that one: an edit that was
 * dropped would leave the answer to the message showing an earlier version of
 * it. Of several edits of one message only the newest is handled, when its turn
 * comes. When `limit` updates are in progress, polling waits for a free place.
 */
export type ConcurrentMiddleware<C extends Context> = MiddlewareFn<C> & {
  /**
   * Stops taking updates: one that reaches the middleware after this is left
   * unhandled, so Telegram offers it again to the next start. Updates already
   * taken still run to the end.
   */
  close(): void;
  /** Updates taken and not finished yet, the ones waiting for a place or for an earlier one of the user included. */
  inProgress(): number;
};

export function handleConcurrently<C extends Context>(
  bot: Bot<C>,
  policy: ConcurrencyPolicy,
): ConcurrentMiddleware<C> {
  const users = new Map<number, UserQueue>();
  const editsPending = new Map<string, PendingEdit>();
  const waiting: Array<() => void> = [];
  let running = 0;
  let arrivals = 0;
  let closed = false;
  let taken = 0;

  function takePlace(): Promise<void> {
    if (running < policy.limit) {
      running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => waiting.push(resolve));
  }

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

  const middleware: MiddlewareFn<C> = async (ctx, next) => {
    if (closed) {
      return;
    }

    const userId = ctx.from?.id;
    const editKey =
      ctx.editedMessage !== undefined ? `${ctx.editedMessage.chat.id}:${ctx.editedMessage.message_id}` : undefined;
    const pendingEdit = editKey === undefined ? undefined : editsPending.get(editKey);

    let own: UserQueue | undefined;
    if (userId !== undefined) {
      own = users.get(userId);
      if (own && own.count >= policy.perUser && !pendingEdit) {
        return;
      }
      if (!own) {
        own = { tail: Promise.resolve(), count: 0 };
        users.set(userId, own);
      }
    }

    let edit: PendingEdit | undefined;
    let arrival = 0;
    if (editKey !== undefined) {
      edit = pendingEdit ?? { latest: 0, pending: 0 };
      edit.pending++;
      arrival = ++arrivals;
      edit.latest = arrival;
      editsPending.set(editKey, edit);
    }

    taken++;
    // Counted from here on, so an update that waits for a place counts too.
    const earlier = own && own.count > 0 ? own.tail : undefined;
    if (own) {
      own.count++;
    }

    const place = earlier ? earlier.then(takePlace) : takePlace();
    if (!earlier) {
      await place;
    }

    const finished = place
      .then(() => (edit && edit.latest !== arrival ? undefined : next()))
      .catch((error) => report(error, ctx))
      .finally(() => {
        taken--;
        if (edit && editKey !== undefined && --edit.pending === 0) {
          editsPending.delete(editKey);
        }
        if (own && --own.count === 0 && userId !== undefined) {
          users.delete(userId);
        }
        release();
      });

    if (own) {
      own.tail = finished;
    }
  };

  return Object.assign(middleware, {
    close(): void {
      closed = true;
    },
    inProgress: () => taken,
  });
}
