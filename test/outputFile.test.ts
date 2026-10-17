import { describe, expect, test } from "bun:test";
import { InputFile } from "grammy";

import { createHarness } from "./helpers/botHarness";

/** Three console lines of 1500 characters do not fit in one message next to anything else. */
const LONG_OUTPUT = 'for (let i = 0; i < 3; i++) console.log(String(i).repeat(1500)); "done"';

interface SentFile {
  name: string | undefined;
  text: string;
  payload: Record<string, any>;
}

/** Gives the harness a Telegram that takes files and remembers them. */
function withFiles(harness: ReturnType<typeof createHarness>) {
  const files: SentFile[] = [];
  const deleted: number[] = [];
  let nextId = 5_000;

  harness.bot.api.config.use(async (previous, method, payload, signal) => {
    const body = payload as Record<string, any>;
    if (method === "sendDocument") {
      const file = body.document as InputFile;
      const bytes = (await file.toRaw()) as Uint8Array;
      files.push({ name: file.filename, text: new TextDecoder().decode(bytes), payload: body });
      return { ok: true, result: { message_id: nextId++, date: 0, chat: { id: body.chat_id, type: "private" } } } as any;
    }
    if (method === "deleteMessage") {
      deleted.push(body.message_id);
      return { ok: true, result: true } as any;
    }
    return previous(method, payload, signal);
  });

  return { files, deleted };
}

describe("output that does not fit in a message", () => {
  test("is sent as a text file after the answer, with everything the run printed", async () => {
    const harness = createHarness();
    const { files } = withFiles(harness);

    await harness.sendMessage(LONG_OUTPUT, 7);

    const [reply] = harness.callsTo("sendMessage");
    expect(reply.payload.text).toContain("truncated");
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("output.txt");
    expect(files[0].payload.reply_parameters.message_id).toBe(1_000);
    for (const digit of ["0", "1", "2"]) {
      expect(files[0].text).toContain(digit.repeat(1500));
    }
    expect(files[0].text).toContain("Console\n-------\n");
    expect(files[0].text).toContain("Result\n------\ndone");
  });

  test("is not sent for an answer that fits", async () => {
    const harness = createHarness();
    const { files } = withFiles(harness);

    await harness.sendMessage("console.log('x'.repeat(1500)); 1", 7);

    expect(files).toHaveLength(0);
  });

  test("is not sent when only the sandbox cut the output", async () => {
    const harness = createHarness();
    const { files } = withFiles(harness);

    await harness.sendMessage("for (let i = 0; i < 100; i++) console.log('line', i); 1", 7);

    expect(harness.callsTo("sendMessage")[0].payload.text).toContain("truncated");
    expect(files).toHaveLength(0);
  });

  test("is replaced when an edit still does not fit, and removed when it does", async () => {
    const harness = createHarness();
    const { files, deleted } = withFiles(harness);

    await harness.sendMessage(LONG_OUTPUT, 7);
    await harness.editMessage(LONG_OUTPUT.replace("done", "again"), 7);
    expect(files).toHaveLength(2);
    expect(deleted).toEqual([5_000]);

    await harness.editMessage("1 + 1", 7);
    expect(files).toHaveLength(2);
    expect(deleted).toEqual([5_000, 5_001]);
  });

  test("leaves the answer alone when the file cannot be sent", async () => {
    const harness = createHarness({ failures: { sendDocument: "Bad Request: wrong file" } });
    const logged = console.error;
    console.error = () => undefined;

    try {
      await harness.sendMessage(LONG_OUTPUT, 7);
      await harness.editMessage("2 + 2", 7);
    } finally {
      console.error = logged;
    }

    expect(harness.callsTo("sendMessage")).toHaveLength(1);
    expect(harness.callsTo("editMessageText")).toHaveLength(1);
    expect(harness.callsTo("deleteMessage")).toHaveLength(0);
  });
});
