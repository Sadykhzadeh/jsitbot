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

describe("console.table of collections and columns", () => {
  test("a map has a row for each entry, with its key and value", async () => {
    const [table] = await logs(`console.table(new Map([["k", 1], ["j", { x: 1 }]]))`);

    expect(table.split("\n")).toEqual([
      "┌───────────────────┬─────┬──────────┐",
      "│ (iteration index) │ Key │ Values   │",
      "├───────────────────┼─────┼──────────┤",
      "│ 0                 │ 'k' │ 1        │",
      "│ 1                 │ 'j' │ { x: 1 } │",
      "└───────────────────┴─────┴──────────┘",
    ]);
  });

  test("a set has a row for each value", async () => {
    const [table] = await logs(`console.table(new Set([1, "b"]))`);

    expect(table.split("\n")).toEqual([
      "┌───────────────────┬────────┐",
      "│ (iteration index) │ Values │",
      "├───────────────────┼────────┤",
      "│ 0                 │ 1      │",
      "│ 1                 │ 'b'    │",
      "└───────────────────┴────────┘",
    ]);
  });

  test("the second argument picks the columns, in its order, even when no row has one", async () => {
    const [table] = await logs(`console.table([{ a: 1, b: 2, c: 3 }], ["c", "a", "z"])`);

    expect(table.split("\n")).toEqual([
      "┌─────────┬───┬───┬───┐",
      "│ (index) │ c │ a │ z │",
      "├─────────┼───┼───┼───┤",
      "│ 0       │ 3 │ 1 │   │",
      "└─────────┴───┴───┴───┘",
    ]);
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

describe("console methods that print nothing or the same as log", () => {
  test("clear, timeStamp, profile and profileEnd do nothing", async () => {
    expect(await logs(`console.clear(); console.timeStamp("x"); console.profile(); console.profileEnd(); console.log("after")`)).toEqual(["after"]);
  });

  test("dirxml prints like log", async () => {
    expect(await logs(`console.dirxml({ a: 1 }, "b")`)).toEqual(["{ a: 1 } b"]);
  });
});

describe("console.dir depth", () => {
  const nested = "({ a: { b: { c: { d: { e: { f: 1 } } } } } })";

  test("a depth of 0 shows nested objects as [Object]", async () => {
    expect(await logs(`console.dir(${nested}, { depth: 0 })`)).toEqual(["{ a: [Object] }"]);
  });

  test("a depth of null shows everything", async () => {
    expect(await logs(`console.dir(${nested}, { depth: null })`)).toEqual(["{ a: { b: { c: { d: { e: { f: 1 } } } } } }"]);
  });

  test("the depth belongs to that call only", async () => {
    const [first, second] = await logs(`console.dir(${nested}, { depth: 1 }); console.log(${nested})`);

    expect(first).toBe("{ a: { b: [Object] } }");
    expect(second).toBe("{ a: { b: { c: { d: [Object] } } } }");
  });
});

describe("console.time", () => {
  test("prints the time since console.time on the sandbox clock, so a sleep shows", async () => {
    const [short, long] = await logs(`
      console.time("a");
      console.time();
      await new Promise((resolve) => setTimeout(resolve, 250));
      console.timeEnd("a");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      console.timeEnd();
    `);

    expect(short).toMatch(/^a: 25\d\.\d{3}ms$/);
    expect(long).toMatch(/^default: 1\.7\d\ds$/);
  });

  test("timeLog keeps the timer running and adds the values after the time", async () => {
    const lines = await logs(`console.time("t"); console.timeLog("t", "so far", 1); console.timeEnd("t")`);

    expect(lines[0]).toMatch(/^t: \d+\.\d{3}ms so far 1$/);
    expect(lines[1]).toMatch(/^t: \d+\.\d{3}ms$/);
  });

  test("a timer that was never started or is already ended prints nothing", async () => {
    expect(await logs(`console.timeEnd("none"); console.timeLog("none"); console.time("x"); console.timeEnd("x"); console.timeEnd("x")`)).toHaveLength(1);
  });

  test("starting a timer again does not restart it", async () => {
    const [line] = await logs(`
      console.time("t");
      await new Promise((resolve) => setTimeout(resolve, 100));
      console.time("t");
      console.timeEnd("t");
    `);

    expect(line).toMatch(/^t: 10\d\.\d{3}ms$/);
  });
});

describe("console.trace", () => {
  test("prints its arguments after a Trace label", async () => {
    expect(await logs(`console.trace("here", 1); console.trace()`)).toEqual(["Trace: here 1", "Trace"]);
  });
});

describe("console.log format specifiers", () => {
  test("fills %s, %d, %i, %f, %j and %o from the arguments that follow", async () => {
    expect(
      await logs(`
        console.log("%s is %d years, %i whole, %f exact", "Ada", 36.5, 36.5, "36.5abc");
        console.log("%j and %o", { a: [1] }, { b: 2 });
        console.log("%s", 5n, "%d", 7);
      `),
    ).toEqual(["Ada is 36.5 years, 36 whole, 36.5 exact", '{"a":[1]} and { b: 2 }', "5n %d 7"]);
  });

  test("%c takes its argument and prints nothing, %% is a percent sign", async () => {
    expect(await logs(`console.log("%cstyled 100%%", "color: red", "after")`)).toEqual(["styled 100% after"]);
  });

  test("leaves a specifier with no argument left, and a single string, as it is", async () => {
    expect(await logs(`console.log("%s and %s", "one"); console.log("100%% %s"); console.log("%d%", 5)`)).toEqual([
      "one and %s",
      "100%% %s",
      "5%",
    ]);
  });

  test("does not look for specifiers when the first argument is not a string", async () => {
    expect(await logs(`console.log(1, "%s", "x"); console.log(["%s"], "x")`)).toEqual(["1 %s x", "[ '%s' ] x"]);
  });

  test("shows objects, symbols and unparsable numbers the way Node does", async () => {
    expect(
      await logs(`
        console.log("%s %s %s", { a: 1 }, Symbol("s"), -0);
        console.log("%d %d %i %f", "x", {}, Symbol("s"), "z");
        const loop = {}; loop.self = loop;
        console.log("%j", loop);
      `),
    ).toEqual(["{ a: 1 } Symbol(s) -0", "NaN NaN NaN NaN", "[Circular]"]);
  });
});
