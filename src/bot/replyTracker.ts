export interface TrackedReply {
  /** Id of the message the bot answered with. */
  replyId: number;
  /** The code that answer was produced from. */
  code: string;
}

/**
 * Remembers which bot message answers which user message, so that editing the
 * user's message can update the answer instead of adding a new one. Kept in
 * memory and bounded: the oldest entries are dropped first, and a bot that
 * restarted simply answers an edit as if it were a new message.
 */
export class ReplyTracker {
  private readonly entries = new Map<string, TrackedReply>();

  constructor(private readonly capacity = 500) {}

  remember(chatId: number, messageId: number, reply: TrackedReply): void {
    const key = `${chatId}:${messageId}`;

    // Re-inserting moves the entry to the back, which is where the newest live.
    this.entries.delete(key);
    this.entries.set(key, reply);

    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
  }

  find(chatId: number, messageId: number): TrackedReply | undefined {
    return this.entries.get(`${chatId}:${messageId}`);
  }
}
