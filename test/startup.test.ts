import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError } from "grammy";

import { createBot } from "../src/bot/createBot";
import { loadEnv } from "../src/config/env";
import { createRunStats } from "../src/runtime/stats";
import { createApiGuard } from "../src/runtime/telegramApi";

const root = fileURLToPath(new URL("../", import.meta.url));
const PREVIEW_TOKEN = "123456789:AAHsecretValue0123456789abcdefghijk";

interface Run {
  code: number;
  output: string;
}

/**
 * Starts the bot the way a deploy does, from a directory with no .env, so
 * nothing but the variables given here reaches it.
 */
async function startBot(
  variables: Record<string, string | undefined>,
  preload: string[] = [],
  args: string[] = [],
): Promise<Run> {
  const directory = mkdtempSync(join(tmpdir(), "jsitbot-start-"));
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "BOT_TOKEN" && key !== "FAKE_TELEGRAM") {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(variables)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  try {
    const bot = Bun.spawn(
      [process.execPath, ...preload.flatMap((file) => ["--preload", file]), join(root, "src/index.ts"), ...args],
      { cwd: directory, env, stdout: "pipe", stderr: "pipe" },
    );
    const [out, err] = await Promise.all([new Response(bot.stdout).text(), new Response(bot.stderr).text()]);
    return { code: await bot.exited, output: out + err };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** The output of a refused start is one line: no stack trace, and never the token. */
function expectOneLine(run: Run, token: string): void {
  const lines = run.output.trim().split("\n");

  expect(run.code).toBe(1);
  expect(lines).toHaveLength(1);
  expect(run.output).not.toContain("    at ");
  expect(run.output).not.toContain(token);
}

describe("starting without a usable BOT_TOKEN", () => {
  test("says the variable is not set when it is missing", async () => {
    const run = await startBot({ BOT_TOKEN: undefined });

    expectOneLine(run, PREVIEW_TOKEN);
    expect(run.output).toContain("Configuration error: BOT_TOKEN is not set");
  });

  test("says the variable is not set when it is only spaces", async () => {
    const run = await startBot({ BOT_TOKEN: "  \t " });

    expectOneLine(run, PREVIEW_TOKEN);
    expect(run.output).toContain("BOT_TOKEN is not set");
  });

  test("says the value does not look like a token and does not repeat it", async () => {
    const run = await startBot({ BOT_TOKEN: "123456789:not a token at all" });

    expectOneLine(run, "not a token at all");
    expect(run.output).toContain("BOT_TOKEN does not look like a Telegram bot token");
  });

  test("refuses the placeholder from .env.example", async () => {
    const run = await startBot({ BOT_TOKEN: "replace_with_your_bot_token" });

    expectOneLine(run, "replace_with_your_bot_token");
    expect(run.output).toContain("BOT_TOKEN does not look like a Telegram bot token");
  });
});

describe("starting with an argument", () => {
  test("refuses --help in one line before it looks at the token", async () => {
    const run = await startBot({ BOT_TOKEN: undefined }, [], ["--help"]);

    expect(run.code).toBe(2);
    expect(run.output.trim().split("\n")).toHaveLength(1);
    expect(run.output).toContain('Unknown argument "--help". The bot takes no arguments');
  });
});

describe("starting with a token Telegram does not accept", () => {
  let server: ReturnType<typeof Bun.serve>;
  let answer: { status: number; body: unknown } = { status: 200, body: {} };

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch: () => Response.json(answer.body, { status: answer.status }),
    });
  });

  afterAll(() => {
    server.stop(true);
  });

  const preload = [join(root, "scripts/useFakeTelegram.ts")];
  const start = () => startBot({ BOT_TOKEN: PREVIEW_TOKEN, FAKE_TELEGRAM: `http://127.0.0.1:${server.port}` }, preload);

  test("says so in one line when Telegram answers 401", async () => {
    answer = { status: 401, body: { ok: false, error_code: 401, description: "Unauthorized" } };

    const run = await start();

    expectOneLine(run, PREVIEW_TOKEN);
    expect(run.output).toContain("Telegram refused BOT_TOKEN (401 Unauthorized)");
  });

  test("says so in one line when Telegram answers with another error", async () => {
    answer = { status: 404, body: { ok: false, error_code: 404, description: "Not Found" } };

    const run = await start();

    expectOneLine(run, PREVIEW_TOKEN);
    expect(run.output).toContain("404: Not Found");
    expect(run.output).toContain("BOT_TOKEN");
  });
});

describe("starting without a route to Telegram", () => {
  test("says the token could not be checked and names the network in one line", async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response("") });
    const port = closed.port;
    closed.stop(true);

    const preload = [join(root, "scripts/useFakeTelegram.ts")];
    const run = await startBot({ BOT_TOKEN: PREVIEW_TOKEN, FAKE_TELEGRAM: `http://127.0.0.1:${port}` }, preload);

    expectOneLine(run, PREVIEW_TOKEN);
    expect(run.output).toContain("Could not reach Telegram to check BOT_TOKEN");
    expect(run.output).toContain("Check the network connection.");
  });
});

describe("starting with a Telegram that accepts the connection and never answers", () => {
  test("fails the start within seconds instead of waiting for grammY's default of 500 s", async () => {
    const silent = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
    const env = loadEnv({ BOT_TOKEN: PREVIEW_TOKEN });
    const guard = createApiGuard({ ...env.telegramApi, callTimeoutMs: 50 }, undefined, () => {});

    try {
      const started = Date.now();
      const failure = await createBot(env, createRunStats(), guard, `http://127.0.0.1:${silent.port}`).catch(
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(HttpError);
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      silent.stop(true);
    }
  });
});
