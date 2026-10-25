import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function logs(code: string): Promise<string[]> {
  const result = await sandbox.execute(code);
  expect(result.ok).toBe(true);

  return result.logs;
}

describe("console.table", () => {
  test("lays out rows of objects, with a column for every key", async () => {
    const [table] = await logs(`console.table([{ a: 1, b: "x" }, { a: 2, c: [1, 2] }])`);

    expect(table.split("\n")).toEqual([
      "┌─────────┬───┬─────┬──────────┐",
      "│ (index) │ a │ b   │ c        │",
      "├─────────┼───┼─────┼──────────┤",
      "│ 0       │ 1 │ 'x' │          │",
      "│ 1       │ 2 │     │ [ 1, 2 ] │",
      "└─────────┴───┴─────┴──────────┘",
    ]);
  });

  test("puts primitive rows under Values and names the rows of an object by key", async () => {
    const [table] = await logs(`console.table({ x: { n: 1 }, y: 5 })`);

    expect(table.split("\n")).toEqual([
      "┌─────────┬───┬────────┐",
      "│ (index) │ n │ Values │",
      "├─────────┼───┼────────┤",
      "│ x       │ 1 │        │",
      "│ y       │   │ 5      │",
      "└─────────┴───┴────────┘",
    ]);
  });

  test("prints anything that is not an object the way console.log does", async () => {
    expect(await logs(`console.table("text"); console.table(null); console.table(3)`)).toEqual(["text", "null", "3"]);
  });

  test("keeps cells short and says when rows or columns were left out", async () => {
    const wide = await sandbox.execute(`console.table([{ text: "x".repeat(100) }])`);
    expect(wide.logs[0]).toContain("'xxxxxxxxxxxxxxxxxxxx...");
    expect(wide.logs[0].split("\n")[1].length).toBeLessThan(40);

    const tall = await sandbox.execute(`console.table(Array.from({ length: 80 }, (_, i) => ({ i })))`);
    expect(tall.logs[0].split("\n").length).toBeLessThan(60);
    expect(tall.truncated).toBe(true);

    const manyColumns = await sandbox.execute(`
      const row = {};
      for (let i = 0; i < 20; i++) row["c" + i] = i;
      console.table([row]);
    `);
    expect(manyColumns.logs[0]).not.toContain("c9");
    expect(manyColumns.truncated).toBe(true);
  });

  test("survives a getter that throws and a key called __proto__", async () => {
    const [table] = await logs(`
      const row = JSON.parse('{"__proto__": 1}');
      Object.defineProperty(row, "bad", { enumerable: true, get() { throw new Error("no"); } });
      console.table([row]);
    `);

    expect(table).toContain("__proto__");
    expect(table).toContain("[Unreadable]");
  });
});

describe("console.assert", () => {
  test("prints only when the condition is false", async () => {
    expect(await logs(`console.assert(true, "quiet"); console.assert(1 === 2, "bad", { a: 1 }); console.assert(false)`)).toEqual([
      "Assertion failed: bad { a: 1 }",
      "Assertion failed",
    ]);
  });
});

describe("console.count", () => {
  test("counts per label and starts over after countReset", async () => {
    expect(
      await logs(`console.count(); console.count(); console.count("x"); console.countReset(); console.count(); console.count("x")`),
    ).toEqual(["default: 1", "default: 2", "x: 1", "default: 1", "x: 2"]);
  });
});

describe("console.group", () => {
  test("indents what is printed inside, line by line", async () => {
    expect(
      await logs(`
        console.group("outer");
        console.log("a\\nb");
        console.group();
        console.log("c");
        console.groupEnd();
        console.groupEnd();
        console.groupEnd();
        console.log("d");
      `),
    ).toEqual(["outer", "  a\n  b", "    c", "d"]);
  });

  test("groupCollapsed behaves the same", async () => {
    expect(await logs(`console.groupCollapsed("g"); console.log("in")`)).toEqual(["g", "  in"]);
  });
});

describe("console.dir", () => {
  test("prints the value and leaves out the options", async () => {
    expect(await logs(`console.dir({ a: 1 }, { depth: 0 })`)).toEqual(["{ a: 1 }"]);
  });
});
