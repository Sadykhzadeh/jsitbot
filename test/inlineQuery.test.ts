import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";
import { createHarness } from "./helpers/botHarness";

function articles(harness: ReturnType<typeof createHarness>) {
  return harness.callsTo("answerInlineQuery").map((call) => call.payload.results[0]);
}

describe("inline queries", () => {
  test("answers with the result as the message to send", async () => {
    const harness = createHarness();

    await harness.inlineQuery("6 * 7");

    const [article] = articles(harness);
    expect(article.id).toBe("execution");
    expect(article.title).toBe("Result: 42");
    expect(article.input_message_content.message_text).toContain("*Result*");
    expect(article.input_message_content.parse_mode).toBe("MarkdownV2");
  });

  test("answers short queries with help instead of running them", async () => {
    const harness = createHarness();

    await harness.inlineQuery("1");

    expect(articles(harness)[0].id).toBe("help");
  });

  test("a run that times out costs more of the rate limit", async () => {
    const harness = createHarness({
      maxRequests: 4,
      sandbox: new QuickJsSandboxService({ timeoutMs: 100 }),
    });

    await harness.inlineQuery("while (true) {}");
    await harness.inlineQuery("1 + 1");
    await harness.inlineQuery("2 + 2");

    expect(articles(harness).map((article) => article.id)).toEqual([
      "execution",
      "execution",
      "rate-limited",
    ]);
  });
});
