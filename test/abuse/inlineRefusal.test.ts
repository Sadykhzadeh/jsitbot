import { describe, expect, test } from "bun:test";

import { createHarness } from "../helpers/botHarness";

function answers(h: ReturnType<typeof createHarness>) {
  return h.callsTo("answerInlineQuery").map((call) => call.payload as Record<string, any>);
}

describe("inline queries from a user over the limit", () => {
  test("every refused keystroke gets its own answer, which says the user is limited", async () => {
    const h = createHarness({ maxRequests: 2 });

    // Each keystroke is a different query, so Telegram asks again every time.
    const typed = ["1 +", "1 + 1", "1 + 12", "1 + 123", "1 + 1234", "1 + 12345"];
    for (const query of typed) {
      await h.inlineQuery(query, 9);
    }

    const sent = answers(h);
    expect(sent).toHaveLength(typed.length);
    expect(sent.slice(2).every((answer) => answer.results[0].id === "rate-limited")).toBe(true);
  });

  test("answers to users under the limit are not cached", async () => {
    const h = createHarness({ maxRequests: 5 });

    await h.inlineQuery("1 + 1", 9);

    expect(answers(h)[0].results[0].id).toBe("execution");
    expect(answers(h)[0].cache_time).toBe(0);
  });
});
