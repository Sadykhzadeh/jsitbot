import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

describe("TextDecoder with UTF-16 and the single-byte Western encoding", () => {
  test("names the encoding by its standard name", async () => {
    expect(await value(`return ["utf-16le", "UTF-16", "ucs-2", "latin1", "ascii", "iso-8859-1", "windows-1252", "utf8"].map((l) => new TextDecoder(l).encoding).join()`)).toBe(
      "utf-16le,utf-16le,utf-16le,windows-1252,windows-1252,windows-1252,windows-1252,utf-8",
    );
  });

  test("reads UTF-16 little endian, with surrogate pairs and without a leading BOM", async () => {
    expect(await value(`return new TextDecoder("utf-16le").decode(new Uint8Array([0x68, 0, 0x69, 0]))`)).toBe("hi");
    expect(await value(`return new TextDecoder("utf-16le").decode(new Uint8Array([0xff, 0xfe, 0x68, 0]))`)).toBe("h");
    expect(await value(`return new TextDecoder("utf-16le", { ignoreBOM: true }).decode(new Uint8Array([0xff, 0xfe, 0x68, 0])).length`)).toBe("2");
    expect(await value(`return new TextDecoder("utf-16le").decode(new Uint8Array([0x3d, 0xd8, 0x00, 0xde])) === "\u{1F600}"`)).toBe("true");
  });

  test("replaces a broken UTF-16 sequence, or throws with fatal", async () => {
    expect(await value(`return new TextDecoder("utf-16le").decode(new Uint8Array([0x68, 0, 0x3d])) === "h\ufffd"`)).toBe("true");
    expect(await value(`return new TextDecoder("utf-16le").decode(new Uint8Array([0x3d, 0xd8, 0x68, 0])) === "\ufffdh"`)).toBe("true");
    expect(await value(`return new TextDecoder("utf-16le").decode(new Uint8Array([0x00, 0xde])) === "\ufffd"`)).toBe("true");
    expect(await value(`return new TextDecoder("utf-16le", { fatal: true }).decode(new Uint8Array([0x00, 0xde]))`)).toBe(
      "error: TypeError: The encoded data was not valid for encoding utf-16le",
    );
  });

  test("keeps half a unit, or half a pair, for the next chunk when stream is set", async () => {
    expect(
      await value(`
        const d = new TextDecoder("utf-16le");
        return [d.decode(new Uint8Array([0x68]), { stream: true }), d.decode(new Uint8Array([0, 0x3d, 0xd8]), { stream: true }), d.decode(new Uint8Array([0, 0xde])) === "\u{1F600}"].join("|")`),
    ).toBe("|h|true");
  });

  test("reads Latin-1 the way the web does, as windows-1252", async () => {
    expect(await value(`return new TextDecoder("latin1").decode(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))`)).toBe("café");
    expect(await value(`return new TextDecoder("windows-1252").decode(new Uint8Array([0x80, 0x93, 0x94, 0x9f, 0x81]))`)).toBe("€“”Ÿ\u0081");
  });

  test("still refuses an encoding it has not got", async () => {
    expect(await value(`return new TextDecoder("shift_jis")`)).toBe('error: RangeError: The "shift_jis" encoding is not supported');
    expect(await value(`return new TextDecoder("utf-16be")`)).toBe('error: RangeError: The "utf-16be" encoding is not supported');
  });
});
