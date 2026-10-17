import type { Clock } from "../src/runtime/telegramApi";

/** Time that only moves when the test says so, with timers that fire in order. */
export class FakeClock implements Clock {
  private time = 0;
  private timers: Array<{ at: number; wake: () => void }> = [];

  now(): number {
    return this.time;
  }

  sleep(ms: number): Promise<void> {
    return new Promise((wake) => this.timers.push({ at: this.time + ms, wake }));
  }

  async advance(ms: number): Promise<void> {
    const target = this.time + ms;

    for (;;) {
      await settle();
      const due = this.timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) {
        break;
      }
      this.timers.splice(this.timers.indexOf(due), 1);
      this.time = due.at;
      due.wake();
    }

    this.time = target;
    await settle();
  }
}

export async function settle(): Promise<void> {
  for (let turn = 0; turn < 25; turn++) {
    await Promise.resolve();
  }
}
