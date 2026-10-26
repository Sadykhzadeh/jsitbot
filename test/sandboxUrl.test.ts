import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";
import { measure } from "./helpers/measure";

const sandbox = new QuickJsSandboxService();
// For the run that must not time out however busy the machine is: how long it
// works is read off the CPU time instead.
const patient = new QuickJsSandboxService({ timeoutMs: 10_000 });

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

const FIELDS = [
  "href", "origin", "protocol", "username", "password", "host", "hostname", "port", "pathname", "search", "hash",
] as const;

type Case = [input: string, base?: string];

// What a program is likely to write. Host names are plain ASCII and addresses
// are left as written, since those two are not rewritten.
const PARSED: Case[] = [
  ["https://example.com"],
  ["https://example.com/"],
  ["HTTPS://EXAMPLE.COM/Path"],
  ["https://user:pa%20ss@example.com:8080/a/b/c?x=1&y=2#frag"],
  ["https://user@example.com"],
  ["http://example.com:80/"],
  ["https://example.com:443"],
  ["https://example.com:444"],
  ["http://example.com:0080"],
  ["https://example.com/a/./b/../c/"],
  ["https://example.com/a/b/.."],
  ["https://example.com/../x"],
  ["https://example.com/a%2eb/%2e%2e/c"],
  ["https://example.com/a b/ü?q=a b&r=ü#h h"],
  ["https://example.com/a\\b\\c"],
  ["https://example.com?x=1"],
  ["https://example.com#top"],
  ["https://example.com/?"],
  ["https://example.com/#"],
  ["https://example.com/a?b?c#d#e"],
  ["http:example.com"],
  ["http:/example.com"],
  ["http:///example.com"],
  ["https://example.com/\"<>`{}|"],
  ["  https://example.com/ \n"],
  ["https://exa\tmple.com/\nx"],
  ["http://[::1]:3000/x"],
  ["http://[2001:DB8::1]/"],
  ["http://127.0.0.1:8080/"],
  ["http://localhost"],
  ["ws://example.com/socket"],
  ["wss://example.com:443/socket"],
  ["ftp://example.com:21/file.txt"],
  ["file:///home/user/file.txt"],
  ["file:///C:/dir/file.txt"],
  ["file:/tmp/x"],
  ["mailto:user@example.com?subject=hi"],
  ["data:text/plain;base64,SGVsbG8="],
  ["javascript:alert(1)"],
  ["tel:+1-555-0100"],
  ["urn:isbn:0451450523"],
  ["git+ssh://git@example.com/repo.git"],
  ["custom://host/path?q#h"],
  ["custom:/just/a/path"],
  ["a:b"],
  // relative to a base
  ["/other", "https://example.com/a/b?q#h"],
  ["other", "https://example.com/a/b?q#h"],
  ["./other", "https://example.com/a/b/"],
  ["../other", "https://example.com/a/b/c"],
  ["../../../../other", "https://example.com/a/b/c"],
  ["?y=2", "https://example.com/a/b?x=1#h"],
  ["#new", "https://example.com/a/b?x=1#h"],
  ["", "https://example.com/a/b?x=1#h"],
  ["//other.org/x", "https://example.com/a"],
  ["//other.org:81", "http://example.com/a"],
  ["x/y?z#w", "https://example.com"],
  ["x", "https://example.com/a/"],
  ["\\other", "https://example.com/a"],
  ["https://absolute.org/", "https://example.com/a"],
  ["other", "custom://host/dir/file"],
  ["#frag", "mailto:a@b.c"],
  ["/x", "file:///home/user/y"],
  ["z", "file:///home/user/y"],
];

const INVALID: Case[] = [
  [""],
  ["example.com"],
  ["/path"],
  ["//example.com"],
  ["http://"],
  ["http://:80"],
  ["https://exa mple.com"],
  ["https://example.com:99999"],
  ["https://example.com:abc"],
  ["https://user@:80"],
  ["http://[::1"],
  ["http://[xyz]/"],
  ["other", "not a url"],
  ["x", "mailto:a@b.c"],
  ["1http://example.com"],
];

describe("URL", () => {
  test("parses the way the platform does", async () => {
    // A few at a time, since the result of a run is cut at 4000 characters.
    for (let from = 0; from < PARSED.length; from += 6) {
      const chunk = PARSED.slice(from, from + 6);
      const guest = JSON.parse(
        await value(`
          const fields = ${JSON.stringify(FIELDS)};
          return JSON.stringify(${JSON.stringify(chunk)}.map(([input, base]) => {
            const url = new URL(input, base);
            return fields.map((field) => url[field]);
          }));
        `),
      );

      chunk.forEach(([input, base], index) => {
        const expected = FIELDS.map((field) => new URL(input, base)[field]);
        expect({ input, base, got: guest[index] }).toEqual({ input, base, got: expected });
      });
    }
  });

  test("rejects what the platform rejects", async () => {
    for (const [input, base] of INVALID) {
      expect(() => new URL(input, base)).toThrow();
      expect(await value(`new URL(${JSON.stringify(input)}, ${JSON.stringify(base)})`)).toBe("error: TypeError: Invalid URL");
    }
  });

  test("canParse and parse do not throw", async () => {
    expect(await value(`return [URL.canParse("https://a.b"), URL.canParse("nope"), URL.canParse("x", "https://a.b")].join()`)).toBe("true,false,true");
    expect(await value(`return [URL.parse("nope"), URL.parse("https://a.b/c").pathname].join()`)).toBe(",/c");
  });

  test("needs an argument", async () => {
    expect(await value(`new URL()`)).toBe("error: TypeError: The url argument is required");
  });

  test("converts to a string and to JSON as its href", async () => {
    expect(await value(`const u = new URL("https://a.b/c?d#e"); return [String(u), JSON.stringify({ u }), \`\${u}\`].join(" ")`)).toBe(
      'https://a.b/c?d#e {"u":"https://a.b/c?d#e"} https://a.b/c?d#e',
    );
  });

  test("setters change the parts and the href", async () => {
    const run = `
      const u = new URL("https://example.com/a/b?x=1#h");
      u.hash = "new"; u.search = "y=2"; u.pathname = "c d"; u.port = "8080"; u.hostname = "other.org";
      u.username = "me"; u.password = "p w";
      return u.href;
    `;
    const expected = new URL("https://example.com/a/b?x=1#h");
    expected.hash = "new";
    expected.search = "y=2";
    expected.pathname = "c d";
    expected.port = "8080";
    expected.hostname = "other.org";
    expected.username = "me";
    expected.password = "p w";

    expect(await value(run)).toBe(expected.href);
  });

  test("setting the href, host, protocol and an empty port or search", async () => {
    const steps = (u: URL) => {
      const seen: string[] = [];
      u.host = "h.org:99";
      seen.push(u.href);
      u.protocol = "http";
      seen.push(u.href);
      u.protocol = "mailto";
      seen.push(u.href);
      u.port = "";
      seen.push(u.href);
      u.search = "";
      u.hash = "";
      seen.push(u.href);
      u.href = "https://reset.example/z?q";
      seen.push(u.href, u.search);
      u.port = "443";
      u.port = "abc";
      u.port = "70000";
      seen.push(u.href);
      return seen.join("|");
    };

    expect(await value(`const steps = ${steps.toString()}; return steps(new URL("https://example.com/a?x#y"))`)).toBe(
      steps(new URL("https://example.com/a?x#y")),
    );
  });

  test("ignores setters that make no sense and throws on an invalid href", async () => {
    expect(await value(`const u = new URL("mailto:a@b.c"); u.pathname = "x"; u.host = "h"; u.port = "1"; return u.href`)).toBe("mailto:a@b.c");
    expect(await value(`new URL("https://a.b").href = "nope"`)).toBe("error: TypeError: Invalid URL");
  });

  test("origin is null for schemes without one", async () => {
    expect(await value(`return [new URL("file:///x").origin, new URL("mailto:a@b.c").origin, new URL("https://a.b:8443/").origin].join()`)).toBe(
      "null,null,https://a.b:8443",
    );
  });
});

describe("URLSearchParams", () => {
  test("reads a query string, with or without the question mark", async () => {
    expect(await value(`const p = new URLSearchParams("?a=1&b=2&a=3&c&d=%C3%A9+x"); return [p.get("a"), p.getAll("a").join("/"), p.get("c"), p.get("d"), String(p.get("zzz")), p.size].join("|")`)).toBe(
      "1|1/3||é x|null|5",
    );
    expect(await value(`return new URLSearchParams("a=1").toString()`)).toBe("a=1");
  });

  test("is made from a record, a list of pairs or another set of params", async () => {
    expect(await value(`return new URLSearchParams({ a: 1, b: "x y" }).toString()`)).toBe("a=1&b=x+y");
    expect(await value(`return new URLSearchParams([["a", "1"], ["a", "2"]]).toString()`)).toBe("a=1&a=2");
    expect(await value(`return new URLSearchParams(new Map([["m", "n"]])).toString()`)).toBe("m=n");
    expect(await value(`const a = new URLSearchParams("x=1"); const b = new URLSearchParams(a); b.append("y", "2"); return [a, b].join(" ")`)).toBe("x=1 x=1&y=2");
    expect(await value(`new URLSearchParams([["only one"]])`)).toContain("TypeError");
    expect(await value(`return new URLSearchParams().toString() + new URLSearchParams(null) + new URLSearchParams(undefined)`)).toBe("");
  });

  test("encodes as a form does", async () => {
    const text = "a b&c=d/é😀!'()*~-._+%";
    const expected = new URLSearchParams({ key: text }).toString();

    expect(await value(`return new URLSearchParams({ key: ${JSON.stringify(text)} }).toString()`)).toBe(expected);
  });

  test("appends, sets, deletes and sorts", async () => {
    expect(
      await value(`
        const p = new URLSearchParams("b=2&a=1&b=3");
        p.append("c", "4");
        p.set("b", "9");
        p.delete("zz");
        const afterSet = p.toString();
        p.sort();
        return [afterSet, p.toString(), p.has("a"), p.has("a", "2"), p.has("nope")].join(" ");
      `),
    ).toBe("b=9&a=1&c=4 a=1&b=9&c=4 true false false");
    expect(await value(`const p = new URLSearchParams("a=1&a=2&b=3"); p.delete("a", "2"); return p.toString()`)).toBe("a=1&b=3");
    expect(await value(`const p = new URLSearchParams("b=1&a=1&b=0&a=0"); p.sort(); return p.toString()`)).toBe("a=1&a=0&b=1&b=0");
  });

  test("iterates in order", async () => {
    expect(
      await value(`
        const p = new URLSearchParams("a=1&b=2");
        const seen = [];
        for (const [k, v] of p) seen.push(k + v);
        p.forEach((v, k, all) => seen.push(k + v + (all === p)));
        return [seen.join(), [...p.keys()].join(), [...p.values()].join(), [...p.entries()].join(";")].join(" ");
      `),
    ).toBe("a1,b2,a1true,b2true a,b 1,2 a,1;b,2");
  });

  test("a URL and its searchParams stay in step", async () => {
    expect(
      await value(`
        const u = new URL("https://a.b/c?x=1#h");
        u.searchParams.append("y", "2 3");
        const first = u.href;
        u.search = "?z=9";
        const second = [u.searchParams.get("z"), u.searchParams.has("x"), u.searchParams.size].join();
        u.searchParams.delete("z");
        return [first, second, u.href, u.search === ""].join(" ");
      `),
    ).toBe("https://a.b/c?x=1&y=2+3#h 9,false,1 https://a.b/c#h true");
  });

  test("needs its arguments", async () => {
    expect(await value(`new URLSearchParams().append("x")`)).toContain("TypeError");
    expect(await value(`new URLSearchParams().get()`)).toContain("TypeError");
  });
});

describe("printing a URL", () => {
  test("shows its parts and its parameters", async () => {
    const result = await sandbox.execute(`console.log(new URL("https://u:p@example.com:8080/a?x=1&y=2#h")); new URLSearchParams("a=1&b=two")`);

    expect(result.ok && result.result).toBe("URLSearchParams { 'a' => '1', 'b' => 'two' }");
    expect(result.logs[0]).toBe(
      [
        "URL {",
        "  href: 'https://u:p@example.com:8080/a?x=1&y=2#h',",
        "  origin: 'https://example.com:8080',",
        "  protocol: 'https:',",
        "  username: 'u',",
        "  password: 'p',",
        "  host: 'example.com:8080',",
        "  hostname: 'example.com',",
        "  port: '8080',",
        "  pathname: '/a',",
        "  search: '?x=1&y=2',",
        "  searchParams: URLSearchParams { 'x' => '1', 'y' => '2' },",
        "  hash: '#h'",
        "}",
      ].join("\n"),
    );
  });

  test("an empty set of parameters", async () => {
    expect(await value(`new URLSearchParams()`)).toBe("URLSearchParams {}");
  });

  test("a proxy that claims to be one is just unformattable", async () => {
    const result = await sandbox.execute(`
      const fake = new Proxy({}, { getPrototypeOf: () => URL.prototype });
      console.log(fake);
      return 1;
    `);

    expect(result.ok).toBe(true);
    expect(result.logs).toEqual(["[Unformattable object]"]);
  });
});

describe("hostile input to URL", () => {
  test("very long and odd inputs finish or fail within the limits", async () => {
    for (const input of [
      `"http://" + "a".repeat(1e6)`,
      `"http://a/" + "../".repeat(100000)`,
      `"http://a/?" + "&=".repeat(100000)`,
      `"http://a/" + "%".repeat(100000)`,
      `"http://a/" + " ".repeat(100000) + "x" + " ".repeat(100000)`,
      `"http://[" + ":".repeat(100000) + "]"`,
      `"\\u0000".repeat(1000) + "http://a"`,
      `"http://a/" + "\\ud800".repeat(1000)`,
    ]) {
      const { value: result, cpuMs } = await measure(() =>
        patient.execute(`try { new URL(${input}).href.length } catch (e) { e.name }`),
      );

      expect(result.timedOut).toBe(false);
      expect(cpuMs).toBeLessThan(650);
    }
    expect((await sandbox.execute("1 + 1")).ok).toBe(true);
  });
});
