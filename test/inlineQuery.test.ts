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

describe("sandbox time budget", () => {
  test("is shared between inline queries and private messages", async () => {
    const harness = createHarness({
      maxSandboxMs: 150,
      sandbox: new QuickJsSandboxService({ timeoutMs: 100 }),
    });

    await harness.sendMessage("while (true) {}", 1);
    await harness.inlineQuery("while (true) {}");
    await harness.inlineQuery("1 + 1");
    await harness.sendMessage("2 + 2", 2);

    expect(articles(harness).map((article) => article.id)).toEqual(["execution", "run-time"]);
    const replies = harness.callsTo("sendMessage");
    expect(replies).toHaveLength(2);
    expect(replies[1].payload.text).toContain("used up its run time");
    expect(replies[1].payload.text).not.toContain("*Result*");
  });
});

describe("inline results to share", () => {
  function allArticles(harness: ReturnType<typeof createHarness>) {
    return harness.callsTo("answerInlineQuery").flatMap((call) => call.payload.results);
  }

  test("offer the code with its result in one block next to the full message", async () => {
    const harness = createHarness();

    await harness.inlineQuery("6 * 7");

    const [full, compact] = allArticles(harness);
    expect(full.id).toBe("execution");
    expect(compact.id).toBe("compact");
    expect(compact.title).toBe("Share: 42");
    expect(compact.input_message_content.message_text).toBe("```\n6 * 7\n// => 42\n```");
    expect(compact.input_message_content.parse_mode).toBe("MarkdownV2");
  });

  test("escape what is in the block", async () => {
    const harness = createHarness();

    await harness.inlineQuery("'a`b\\c'");

    const compact = allArticles(harness)[1];
    expect(compact.input_message_content.message_text).toBe("```\n'a\\`b\\\\c'\n// => a\\`bc\n```");
  });

  test("are not offered for a run that logged, failed or has a long answer", async () => {
    for (const query of ["console.log(1); 2", "null.x", "[1, 2, 3].map(n => ({ n, text: 'abcdefghij' }))", "'x'.repeat(400)"]) {
      const harness = createHarness();

      await harness.inlineQuery(query);

      expect(allArticles(harness).map((article) => article.id)).toEqual(["execution"]);
    }
  });

  test("show a result that spans lines on one line in the list", async () => {
    const harness = createHarness();

    await harness.inlineQuery("[1, 2, 3].map(n => ({ n, text: 'abcdefghij' }))");

    const [full] = allArticles(harness);
    expect(full.title).not.toMatch(/\s{2}|\n/);
    expect(full.description).not.toContain("\n");
  });
});
