import { afterAll, describe, test } from "bun:test";

import { type AbuseCase, createPool, failsWith, result, resultOrTime, runCase, timeLimit } from "./support";

// What the code prints and returns, and what the sandbox lets through: lines
// and results are cut at their limits, and text that Telegram cannot show as
// written comes back well-formed. The bot's own formatting of these outputs is
// checked in the protocol cases.
const cases: AbuseCase[] = [
  {
    name: "a million console.log calls",
    code: `for (let i = 0; i < 1e6; i++) console.log(i); 1`,
    outcome: resultOrTime("1", true),
  },
  {
    name: "a 10 MB string as the result",
    code: `"x".repeat(10 * 1024 * 1024)`,
    outcome: result(/^x+\.\.\.$/, true),
  },
  {
    name: "a 10 MB string logged",
    code: `console.log("y".repeat(10 * 1024 * 1024)); 1`,
    outcome: result("1", true),
  },
  {
    name: "ANSI escape sequences",
    code: `console.log("\\x1b[31mred\\x1b[0m \\x1b]8;;http://x\\x07link\\x1b]8;;\\x07"); "\\x1b[2J"`,
    outcome: result("\\x1b[2J"),
  },
  {
    name: "HTML and Markdown in the output",
    code: "console.log('<b>bold</b> <a href=\"http://x\">x</a> `code` ](http://evil)'); '<i>r</i> ```'",
    outcome: result("<i>r</i> ```"),
  },
  {
    name: "right-to-left override and zero-width characters",
    code: `"\\u202Eevil\\u202C\\u200B\\u200D\\uFEFF"`,
    outcome: result(/evil/),
  },
  {
    name: "a lone surrogate as the result",
    code: `"\\ud83d"`,
    outcome: result("\uFFFD"),
  },
  {
    name: "NUL bytes in the result",
    code: `"a\\0b\\0c"`,
    outcome: result("a\\x00b\\x00c"),
  },
  {
    name: "5000 newlines as the result",
    code: `"\\n".repeat(5000)`,
    outcome: result(/^\n+\.\.\.$/, true),
  },
  {
    name: "error whose message is an object that throws",
    code: `const e = new Error("x"); e.message = { toString() { throw new Error("t") } }; throw e`,
    outcome: failsWith(/^Error$/),
  },
  {
    name: "error whose stack getter throws",
    code: `const e = new Error("x"); Object.defineProperty(e, "stack", { get() { throw new Error("s") } }); throw e`,
    outcome: failsWith(/^Error: x$/),
  },
  {
    name: "error whose name getter throws",
    code: `class E extends Error { get name() { throw new Error("n") } } throw new E("m")`,
    outcome: failsWith(/^Error$/),
  },
  {
    name: "thrown object that refers to itself",
    code: `const o = { a: 1 }; o.self = o; throw o`,
    outcome: failsWith(/^Uncaught <ref \*1> \{ a: 1, self: \[Circular \*1\] \}$/),
  },
  {
    name: "thrown object with a megabyte in it",
    code: `throw { big: "x".repeat(1e6) }`,
    outcome: failsWith(/^Uncaught \{/),
  },
  { name: "thrown null", code: `throw null`, outcome: failsWith(/^Uncaught null$/) },
  {
    name: "thrown BigInt",
    code: `throw 10n ** 100n`,
    outcome: failsWith(/^Uncaught 1000/),
  },
  {
    name: "a line printed before an infinite loop",
    code: `console.log("before"); while (true) {}`,
    outcome: timeLimit,
  },
  {
    name: "a proxy whose traps throw, printed",
    code: `console.log(new Proxy({ a: 1 }, { ownKeys() { throw new Error("k") }, get() { while (true) {} }, getOwnPropertyDescriptor() { throw 1 } })); 1`,
    outcome: result("1"),
  },
  {
    name: "a getter that throws, printed as a result",
    code: `({ get a() { throw new Error("g") } })`,
    outcome: result("{ a: [Getter] }"),
  },
  {
    name: "a million-hole array as the result",
    code: `const a = []; a.length = 1e6; a`,
    outcome: result(/^\[ <100000 empty items>, \.\.\. 900000 more items \]$/, true),
  },
  {
    name: "a BigInt with 20000 digits, printed",
    code: `console.log(10n ** 20000n); 1`,
    outcome: result("1", true),
  },
  {
    name: "a key that is a Markdown code fence",
    code: "console.log({ '`': 1, '](http://x)': 2, '*_~|': 3 }); 1",
    outcome: result("1"),
  },
  {
    name: "a symbol description with HTML",
    code: `console.log({ [Symbol("<b>x</b>")]: 1 }); 1`,
    outcome: result("1"),
  },
];

const pool = createPool();

afterAll(() => pool.dispose());

describe("output abuse", () => {
  for (const abuse of cases) {
    test(abuse.name, () => runCase(pool, abuse), 20_000);
  }
});
