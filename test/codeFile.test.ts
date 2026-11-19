import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { GrammyError, type Api } from "grammy";

import { FileDownloadError, downloadTelegramFile } from "../src/bot/handlers/privateMessage";
import { createHarness } from "./helpers/botHarness";

const encode = (text: string) => new TextEncoder().encode(text);
const respondWith = (response: Response) => (async () => response) as unknown as typeof fetch;

afterEach(() => {
  mock.restore();
});

describe("code files sent in a private chat", () => {
  test("runs a JavaScript file and answers it as a reply to the file", async () => {
    const harness = createHarness({ readFile: async () => encode("\uFEFF6 * 7\n") });

    await harness.sendFile("answer.js", 10, 5);

    const replies = harness.callsTo("sendMessage");
    expect(replies).toHaveLength(1);
    expect(replies[0].payload.text).toContain("42");
    expect(replies[0].payload.reply_parameters.message_id).toBe(5);
  });

  test("runs a TypeScript file with its types removed", async () => {
    const harness = createHarness({ readFile: async () => encode("const n: number = 5;\nn * 2") });

    await harness.sendFile("double.ts", 30);

    expect(harness.callsTo("sendMessage")[0].payload.text).toContain("10");
  });

  test("reads a file that Telegram sent without a size", async () => {
    const harness = createHarness({ readFile: async () => encode("6 * 7") });

    await harness.sendFile("answer.js", undefined, 9);

    expect(harness.callsTo("sendMessage")[0].payload.text).toContain("42");
  });

  test("does not download a file for a user over the request limit, and says so once", async () => {
    let read = 0;
    const harness = createHarness({
      maxRequests: 1,
      readFile: async () => {
        read++;
        return encode("1 + 1");
      },
    });

    await harness.sendMessage("1 + 1");
    harness.calls.length = 0;
    await harness.sendFile("one.js", 5, 11);
    await harness.sendFile("two.js", 5, 12);

    expect(read).toBe(0);
    const replies = harness.callsTo("sendMessage");
    expect(replies).toHaveLength(1);
    expect(replies[0].payload.text).toContain("Rate limit exceeded");
  });

  test("ignores a file whose name is not a JavaScript or TypeScript source", async () => {
    let read = 0;
    const harness = createHarness({
      readFile: async () => {
        read++;
        return encode("1 + 1");
      },
    });

    await harness.sendFile("notes.txt", 5);

    expect(read).toBe(0);
    expect(harness.calls).toHaveLength(0);
  });

  test("reads a UTF-16 file that starts with a byte order mark as the text it holds", async () => {
    const units = (text: string) => Array.from(text, (character) => character.charCodeAt(0));
    const littleEndian = Uint8Array.from([0xff, 0xfe, ...units("6 * 7").flatMap((unit) => [unit & 0xff, unit >> 8])]);
    const bigEndian = Uint8Array.from([0xfe, 0xff, ...units("6 * 7").flatMap((unit) => [unit >> 8, unit & 0xff])]);

    const harness = createHarness({ readFile: async () => littleEndian });
    await harness.sendFile("answer.js", 12, 3);
    expect(harness.callsTo("sendMessage")[0].payload.text).toContain("42");

    const other = createHarness({ readFile: async () => bigEndian });
    await other.sendFile("answer.js", 12, 4);
    expect(other.callsTo("sendMessage")[0].payload.text).toContain("42");
  });

  test("refuses a file that is too big for the code length limit without reading it", async () => {
    let read = 0;
    const harness = createHarness({
      readFile: async () => {
        read++;
        return encode("1 + 1");
      },
    });

    await harness.sendFile("big.js", 6_001, 7);

    expect(read).toBe(0);
    const replies = harness.callsTo("sendMessage");
    expect(replies).toHaveLength(1);
    expect(replies[0].payload.text).toContain("File exceeds the 2000-character limit.");
    expect(replies[0].payload.reply_parameters.message_id).toBe(7);
  });

  test("refuses code that is over the limit once it is read", async () => {
    const harness = createHarness({ readFile: async () => encode("1".repeat(2_001)) });

    await harness.sendFile("long.js", 2_001);

    expect(harness.callsTo("sendMessage")[0].payload.text).toContain("Code exceeds the 2000-character limit (yours has 2001).");
  });

  test("answers a file that could not be downloaded with one line and logs no address", async () => {
    const logged: string[] = [];
    const error = spyOn(console, "error").mockImplementation((line: unknown) => void logged.push(String(line)));
    const harness = createHarness({
      readFile: async () => {
        throw new FileDownloadError("timeout", "file download timed out after 10000 ms");
      },
    });

    try {
      await harness.sendFile("slow.js", 10, 9);
    } finally {
      error.mockRestore();
    }

    const replies = harness.callsTo("sendMessage");
    expect(replies).toHaveLength(1);
    expect(replies[0].payload.text).toContain("Could not download the file. Send it again.");
    expect(replies[0].payload.reply_parameters.message_id).toBe(9);
    expect(logged).toEqual(["Could not read a code file: file download timed out after 10000 ms"]);
  });

  test("refuses a file that turns out bigger than the limit when it is read", async () => {
    const harness = createHarness({
      readFile: async () => {
        throw new FileDownloadError("too-large", "file is larger than the limit");
      },
    });

    await harness.sendFile("lying.js", 10);

    expect(harness.callsTo("sendMessage")[0].payload.text).toContain("File exceeds the 2000-character limit.");
  });
});

describe("downloadTelegramFile", () => {
  const TOKEN = "123456:secretsecretsecretsecretsecret";
  const api = (getFile: () => Promise<unknown>) => ({ token: TOKEN, getFile }) as unknown as Api;
  const located = async () => ({ file_id: "f", file_unique_id: "u", file_path: "documents/one.js" });

  test("reads the file from Telegram's file server by the path it was given", async () => {
    const fetch = spyOn(globalThis, "fetch").mockImplementation(respondWith(new Response("1 + 1")));

    const bytes = await downloadTelegramFile(api(located), "f", 100);

    expect(new TextDecoder().decode(bytes)).toBe("1 + 1");
    expect(fetch.mock.calls[0][0]).toBe(`https://api.telegram.org/file/bot${TOKEN}/documents/one.js`);
  });

  test("refuses a body bigger than the limit even when Telegram declared a small file", async () => {
    const chunks = [new Uint8Array(60), new Uint8Array(60)];
    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
    spyOn(globalThis, "fetch").mockImplementation(respondWith(new Response(body)));

    await expect(downloadTelegramFile(api(located), "f", 100)).rejects.toMatchObject({ reason: "too-large" });
  });

  test("refuses a response that declares a length over the limit before reading it", async () => {
    spyOn(globalThis, "fetch").mockImplementation(
      respondWith(new Response("x", { headers: { "content-length": "5000" } })),
    );

    await expect(downloadTelegramFile(api(located), "f", 100)).rejects.toMatchObject({ reason: "too-large" });
  });

  test("gives up on a download that does not finish in time", async () => {
    spyOn(globalThis, "fetch").mockImplementation(
      ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        })) as unknown as typeof fetch,
    );

    const started = performance.now();
    await expect(downloadTelegramFile(api(located), "f", 100, 30)).rejects.toMatchObject({ reason: "timeout" });
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  test("fails when Telegram answers the download with an error status, without the address", async () => {
    spyOn(globalThis, "fetch").mockImplementation(respondWith(new Response("", { status: 404 })));

    const failure = await downloadTelegramFile(api(located), "f", 100).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(FileDownloadError);
    expect((failure as Error).message).toBe("file download failed with status 404");
  });

  test("keeps the address out of an error from the connection", async () => {
    spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
      throw new TypeError(`could not connect to ${url}`);
    }) as unknown as typeof fetch);

    const failure = await downloadTelegramFile(api(located), "f", 100).catch((error: unknown) => error);

    expect((failure as Error).message).toBe("file download failed");
    expect((failure as Error).message).not.toContain(TOKEN);
  });

  test("says why Telegram refused to give the file's path", async () => {
    const refused = api(async () => {
      throw new GrammyError("Call failed", { ok: false, error_code: 400, description: "Bad Request: file is too big" }, "getFile", {});
    });

    await expect(downloadTelegramFile(refused, "f", 100)).rejects.toThrow(
      "getFile failed with 400: Bad Request: file is too big",
    );
  });
});
