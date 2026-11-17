import { describe, expect, test } from "bun:test";

import { QuickJsSandboxService } from "../src/services/sandbox/quickjsSandbox";

const sandbox = new QuickJsSandboxService();

async function value(code: string): Promise<string> {
  const result = await sandbox.execute(code);

  return result.ok ? result.result : `error: ${result.error}`;
}

// Each row is [input, base, a statement that changes u, what Node 26.13 gives]:
// the href of the URL, or ERR_INVALID_URL for a URL that does not parse.
const NODE_CASES: Array<[string, string | null, string | null, string]> = [
  ["https://example.com", null, null, "https://example.com/"],
  ["https://user@example.com", null, null, "https://user@example.com/"],
  ["https://example.com:444", null, null, "https://example.com:444/"],
  ["http://example.com:65536", null, null, "ERR_INVALID_URL"],
  ["http://example.com:abc", null, null, "ERR_INVALID_URL"],
  ["https://example.com/../x", null, null, "https://example.com/x"],
  ["https://example.com?x=1", null, null, "https://example.com/?x=1"],
  ["https://example.com/a?b?c#d#e", null, null, "https://example.com/a?b?c#d#e"],
  ["https://example.com/\"<>`{}|", null, null, "https://example.com/%22%3C%3E%60%7B%7D|"],
  ["http://[2001:DB8::1]/", null, null, "http://[2001:db8::1]/"],
  ["http://[gggg::1]/", null, null, "ERR_INVALID_URL"],
  ["http://localhost", null, null, "http://localhost/"],
  ["http://ex%41mple.com/", null, null, "http://example.com/"],
  ["http://example.com/%zz", null, null, "http://example.com/%zz"],
  ["ftp://example.com:21/file.txt", null, null, "ftp://example.com/file.txt"],
  ["file:/tmp/x", null, null, "file:///tmp/x"],
  ["javascript:alert(1)", null, null, "javascript:alert(1)"],
  ["custom://host/path?q#h", null, null, "custom://host/path?q#h"],
  ["1http://example.com", null, null, "ERR_INVALID_URL"],
  ["://example.com", null, null, "ERR_INVALID_URL"],
  ["", null, null, "ERR_INVALID_URL"],
  ["./other", "https://example.com/a/b/", null, "https://example.com/a/b/other"],
  ["#new", "https://example.com/a/b?x=1#h", null, "https://example.com/a/b?x=1#new"],
  ["https:other", "https://example.com/a/b", null, "https://example.com/a/other"],
  ["https://other.org", "not a url", null, "ERR_INVALID_URL"],
  ["/x", "mailto:a@b", null, "ERR_INVALID_URL"],
  ["../x", "file:///a/b/c", null, "file:///a/x"],
  ["", "http://[::1]", null, "http://[::1]/"],
  ["/%2e%2e/%2e/x", "https://example.com/a/b", null, "https://example.com/x"],
  ["https://example.com/😀?😀=😀#😀", null, null, "https://example.com/%F0%9F%98%80?%F0%9F%98%80=%F0%9F%98%80#%F0%9F%98%80"],
  ["https://example.com/\ud800", null, null, "https://example.com/%EF%BF%BD"],
  ["https://example.com/a?x=%E4%BD%A0", null, null, "https://example.com/a?x=%E4%BD%A0"],
  ["https://a..b/", null, null, "https://a..b/"],
  ["https://[::1/", null, null, "ERR_INVALID_URL"],
  ["https://a@b@c/", null, null, "https://a%40b@c/"],
  ["https://exa\u0000mple.com/", null, null, "ERR_INVALID_URL"],
  ["about:blank", null, null, "about:blank"],
  ["https://999.1.1.1/", null, null, "ERR_INVALID_URL"],
  ["https://example.com/a/b/c/.", null, null, "https://example.com/a/b/c/"],
  ["  \t\n", null, null, "ERR_INVALID_URL"],
  ["http://[::]/", null, null, "http://[::]/"],
  ["http://[1:0:0:2:0:0:0:3]/", null, null, "http://[1:0:0:2::3]/"],
  ["http://[1:2:3:4:5:6:7:8:9]/", null, null, "ERR_INVALID_URL"],
  ["http://[:1]/", null, null, "ERR_INVALID_URL"],
  ["http://[1:2:3:4:5:6:1.2.3.256]/", null, null, "ERR_INVALID_URL"],
  ["http://[::1]x/", null, null, "ERR_INVALID_URL"],
  ["http://[v1.x]/", null, null, "ERR_INVALID_URL"],
  ["http://4294967296/", null, null, "ERR_INVALID_URL"],
  ["http://08.1.1.1/", null, null, "ERR_INVALID_URL"],
  ["http://0x.0x.0/", null, null, "http://0.0.0.0/"],
  ["http://%41%42.com/", null, null, "http://ab.com/"],
  ["https://a%2fb/", null, null, "ERR_INVALID_URL"],
  ["foo://ex ample/", null, null, "ERR_INVALID_URL"],
  ["foo://[::1]/", null, null, "foo://[::1]/"],
  ["foo://a|b/", null, null, "ERR_INVALID_URL"],
  ["foo://user@/", null, null, "ERR_INVALID_URL"],
  ["https://a/b/c/./../../g", null, null, "https://a/g"],
  ["https:\\\\a\\b", null, null, "https://a/b"],
  ["file:///c|/x", null, null, "file:///c:/x"],
  ["file:///../../x", null, null, "file:///x"],
  ["file://user@host/x", null, null, "ERR_INVALID_URL"],
  ["/c:/x", "file:///a/b", null, "file:///c:/x"],
  ["x", "file:///C:", null, "file:///C:/x"],
  ["x", "sc://ñ/a", null, "sc://%C3%B1/x"],
  ["#f", "sc://a?q#f", null, "sc://a?q#f"],
  ["https://a/b?c#d e", null, null, "https://a/b?c#d%20e"],
  ["sc:\t\n\r/x", null, null, "sc:/x"],
  ["https://a/", null, null, "https://a/%7F"],
  ["sc:x y", null, null, "sc:x y"],
  ["wss://example.com:80/", null, null, "wss://example.com:80/"],
  ["https://example.com:0/", null, null, "https://example.com:0/"],
  ["https://xn--bcher-kva.de/", null, null, "https://xn--bcher-kva.de/"],
  ["https://中文.example/", null, null, "https://xn--fiq228c.example/"],
  ["https://😀.example/", null, null, "https://xn--e28h.example/"],
  ["https://example.com/%e4%bd%a0/%E4/x", null, null, "https://example.com/%e4%bd%a0/%E4/x"],
  ["mailto:user@example.com", null, null, "mailto:user@example.com"],
  ["mailto:a?b c", null, null, "mailto:a?b%20c"],
  ["javascript:void(0)#x", null, null, "javascript:void(0)#x"],
  ["1a:x", null, null, "ERR_INVALID_URL"],
  ["https://example.com/a/b?x=1#h", null, "u.hash = 'new'", "https://example.com/a/b?x=1#new"],
  ["https://example.com/a/b?x=1#h", null, "u.hash = ''", "https://example.com/a/b?x=1"],
  ["https://example.com/a/b?x=1#h", null, "u.search = '?y=2 z'", "https://example.com/a/b?y=2%20z#h"],
  ["https://example.com/a/b?x=1#h", null, "u.search = '?'", "https://example.com/a/b?#h"],
  ["https://example.com/a/b?x=1#h", null, "u.pathname = 'c d'", "https://example.com/c%20d?x=1#h"],
  ["https://example.com/a/b?x=1#h", null, "u.pathname = ''", "https://example.com/?x=1#h"],
  ["https://example.com/a/b?x=1#h", null, "u.pathname = '\\\\p\\\\q'", "https://example.com/p/q?x=1#h"],
  ["https://example.com/a?x#h", null, "u.port = '8080'", "https://example.com:8080/a?x#h"],
  ["https://example.com/a?x#h", null, "u.port = '8080abc'", "https://example.com:8080/a?x#h"],
  ["https://example.com/a?x#h", null, "u.port = '70000'", "https://example.com/a?x#h"],
  ["https://example.com:8080/a?x#h", null, "u.hostname = 'other.org'", "https://other.org:8080/a?x#h"],
  ["https://example.com:8080/a?x#h", null, "u.hostname = ''", "https://example.com:8080/a?x#h"],
  ["https://example.com:8080/a?x#h", null, "u.hostname = 'ÄÖ.example'", "https://xn--4ca0b.example:8080/a?x#h"],
  ["https://example.com:8080/a?x#h", null, "u.host = 'h.org'", "https://h.org:8080/a?x#h"],
  ["https://example.com:8080/a?x#h", null, "u.host = 'h.org:99999'", "https://h.org:8080/a?x#h"],
  ["https://example.com:8080/a?x#h", null, "u.host = ''", "https://example.com:8080/a?x#h"],
  ["https://example.com:8080/a?x#h", null, "u.host = 'x/y'", "https://x:8080/a?x#h"],
  ["https://example.com:8080/a?x#h", null, "u.protocol = 'http:'", "http://example.com:8080/a?x#h"],
  ["https://example.com:8080/a?x#h", null, "u.protocol = 'ws'", "ws://example.com:8080/a?x#h"],
  ["https://example.com:8080/a?x#h", null, "u.protocol = ''", "https://example.com:8080/a?x#h"],
  ["file:///a", null, "u.protocol = 'https'", "file:///a"],
  ["mailto:a@b", null, "u.username = 'me'", "mailto:a@b"],
  ["https://example.com", null, "u.searchParams.append('a', 'b c'); u.searchParams.set('d', '&')", "https://example.com/?a=b+c&d=%26"],
  ["https://example.com/?a=1", null, "u.search = 'x=%zz+y'; u.searchParams.get('x')", "https://example.com/?x=%zz+y"],
  ["https://example.com/", null, "u.searchParams.toString()", "https://example.com/"],
  ["https://example.com/", null, "u.pathname = '/a b/%20/%zz'", "https://example.com/a%20b/%20/%zz"],
  ["https://example.com/a/b", null, "u.pathname = '..'", "https://example.com/"],
  ["file:///a/b", null, "u.hostname = 'localhost'", "file:///a/b"],
  ["https://a.b/", null, "u.hash = 'x\u0000y'", "https://a.b/#x%00y"],
];

describe("URL, checked against Node 26.13", () => {
  test("gives the href Node gives, or ERR_INVALID_URL", async () => {
    for (const [input, base, change, expected] of NODE_CASES) {
      const ctorArgs = base === null ? JSON.stringify(input) : `${JSON.stringify(input)}, ${JSON.stringify(base)}`;
      const code = `
        let u;
        try {
          u = new URL(${ctorArgs});
          ${change ?? ""};
          return u.href;
        } catch (e) {
          return e.code;
        }
      `;

      expect(await value(code), `new URL(${ctorArgs}) with ${change ?? "no change"}`).toBe(expected);
    }
  });

  test("an invalid URL is a TypeError with its code, input and base, as Node has them", async () => {
    expect(
      await value(`
        try { new URL("nope") } catch (e) { return [e.name, e.message, e.code, e.input, "base" in e].join("|") }
      `),
    ).toBe("TypeError|Invalid URL|ERR_INVALID_URL|nope|false");
    expect(
      await value(`
        try { new URL("x", "not a base") } catch (e) { return [e.name, e.code, e.input, e.base].join("|") }
      `),
    ).toBe("TypeError|ERR_INVALID_URL|x|not a base");
  });
});

describe("URLSearchParams, checked against Node 26.13", () => {
  test("parses, reads, changes and writes a query the way Node does", async () => {
    const expected: unknown[] = [
      "TypeError|Invalid URL|ERR_INVALID_URL|nope|false",
      "TypeError|ERR_INVALID_URL|x|not a base",
      "a=1&b=2&a=3&c=%25zz+x&d=&=e&f=",
      "[[\"a\",\"1\"],[\"b\",\"2\"],[\"a\",\"3\"],[\"c\",\"%zz x\"],[\"d\",\"\"],[\"\",\"e\"],[\"f\",\"\"]]",
      "1",
      "[\"1\",\"3\"]",
      true,
      true,
      7,
      "=e&a=9&c=%25zz+x&d=&f=&g=h+i",
      "6",
      "x=1&y+z=%26",
      "k=v&k=w",
      "[\"v\",\"w\"]",
      "�",
      "a=%E4%BD%A0&b=%F0%9F%98%80",
      "q=%7E%21%28%29*%27",
      "a b c",
      "https://x.test/p?z=1&w=2+3",
      "?z=1&w=2+3",
      "n",
      "https://x.test/p?m=n"
    ];

    expect(JSON.parse(await value("const out = [];\ntry { new URL(\"nope\") } catch (e) { out.push([e.name, e.message, e.code, e.input, \"base\" in e].join(\"|\")); }\ntry { new URL(\"x\", \"not a base\") } catch (e) { out.push([e.name, e.code, e.input, e.base].join(\"|\")); }\nconst p = new URLSearchParams(\"?a=1&b=2&a=3&c=%zz+x&d&=e&f=\");\nout.push(p.toString(), JSON.stringify([...p]), p.get(\"a\"), JSON.stringify(p.getAll(\"a\")), p.has(\"d\"), p.has(\"a\", \"3\"), p.size);\np.append(\"g\", \"h i\"); p.set(\"a\", \"9\"); p.delete(\"b\"); p.sort();\nout.push(p.toString(), String(p.size));\nconst q = new URLSearchParams({ x: \"1\", \"y z\": \"&\" });\nout.push(q.toString());\nconst r = new URLSearchParams([[\"k\", \"v\"], [\"k\", \"w\"]]);\nout.push(r.toString(), JSON.stringify(r.getAll(\"k\")));\nout.push(new URLSearchParams(\"a=%E4%BD%A0&b=%F0%9F%98%80&c=%FF\").get(\"c\"), new URLSearchParams(\"a=%E4%BD%A0&b=%F0%9F%98%80\").toString());\nout.push(new URLSearchParams(\"q=~!()*'\").toString(), new URLSearchParams(\"q=a b+c\").get(\"q\"));\nconst u = new URL(\"https://x.test/p?z=1\");\nu.searchParams.append(\"w\", \"2 3\");\nout.push(u.href, u.search);\nu.search = \"?m=n\";\nout.push(u.searchParams.get(\"m\"), u.href);\nreturn JSON.stringify(out, null, 1);"))).toEqual(expected);
  });
});
