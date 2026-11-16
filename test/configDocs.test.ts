import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadEnv } from "../src/config/env";

const root = fileURLToPath(new URL("../", import.meta.url));
const VALID_TOKEN = "123456789:AAH-valid_token0123456789abcdefghijk";

/** The names the config module asks the environment for, found by loading it with a source that records each one. */
function variablesRead(): string[] {
  const read = new Set<string>();
  const source = new Proxy({} as Record<string, string>, {
    get(_target, key) {
      if (typeof key === "string") {
        read.add(key);
      }
      return VALID_TOKEN;
    },
  });

  loadEnv(source);
  return [...read].sort();
}

function namesIn(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1]).sort();
}

describe("the variables the bot documents", () => {
  const read = variablesRead();

  test("the config module reads exactly the variables it documents in .env.example", () => {
    const example = readFileSync(`${root}.env.example`, "utf8");

    expect(namesIn(example, /^([A-Z][A-Z0-9_]*)=/gm)).toEqual(read);
  });

  test("the README's configuration table lists exactly the variables the config module reads", () => {
    const readme = readFileSync(`${root}README.md`, "utf8");
    const start = readme.indexOf("## Configuration");
    const end = readme.indexOf("## What It Prints");
    const section = readme.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(namesIn(section, /^\| `([A-Z][A-Z0-9_]*)` \|/gm)).toEqual(read);
  });
});
