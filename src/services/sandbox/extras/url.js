// URL and URLSearchParams, for the guest. Evaluated the first time the code asks
// for one of them; see lazyGlobals in guest.js. Parses the forms people write:
// special schemes (http, https, ws, wss, ftp, file) with an authority, other
// schemes with or without one, relative references against a base, dot segments
// and percent-encoding. It does not convert host names to punycode or rewrite
// IPv4 and IPv6 addresses into their canonical form.
(function (register) {
  "use strict";

  const SPECIAL_PORTS = { http: "80", https: "443", ws: "80", wss: "443", ftp: "21", file: "" };

  function isSpecial(scheme) {
    return Object.prototype.hasOwnProperty.call(SPECIAL_PORTS, scheme);
  }

  function invalidUrl() {
    return new TypeError("Invalid URL");
  }

  function hex(code) {
    return "%" + (code < 16 ? "0" : "") + code.toString(16).toUpperCase();
  }

  // Percent-encodes what is outside printable ASCII, plus the characters in `extra`.
  // A "%" already in the text is left alone.
  function encode(text, extra) {
    let out = "";
    for (const char of text) {
      const code = char.codePointAt(0);
      if (code > 0x20 && code < 0x7f && extra.indexOf(char) === -1) {
        out += char;
      } else if (code < 0x80) {
        out += hex(code);
      } else if (code >= 0xd800 && code <= 0xdfff) {
        out += "%EF%BF%BD";
      } else {
        out += encodeURIComponent(char);
      }
    }
    return out;
  }

  const FRAGMENT_SET = ' "<>`';
  const QUERY_SET = ' "#<>';
  const SPECIAL_QUERY_SET = ' "#<>\'';
  const PATH_SET = ' "#<>?^`{}';
  const USERINFO_SET = ' "#<>?`{}/:;=@[\\]^|';

  function splitTail(text) {
    let fragment = null;
    let query = null;
    const hash = text.indexOf("#");
    if (hash >= 0) {
      fragment = text.slice(hash + 1);
      text = text.slice(0, hash);
    }
    const mark = text.indexOf("?");
    if (mark >= 0) {
      query = text.slice(mark + 1);
      text = text.slice(0, mark);
    }
    return { text, query, fragment };
  }

  function normalizePath(text, special) {
    const parts = text.split(special ? /[\/\\]/ : "/");
    if (parts[0] === "") parts.shift();
    const stack = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const lower = part.toLowerCase();
      const last = i === parts.length - 1;

      if (lower === ".." || lower === ".%2e" || lower === "%2e." || lower === "%2e%2e") {
        stack.pop();
        if (last) stack.push("");
      } else if (lower === "." || lower === "%2e") {
        if (last) stack.push("");
      } else {
        stack.push(encode(part, PATH_SET));
      }
    }

    return "/" + stack.join("/");
  }

  function parseHost(text, special) {
    if (text.startsWith("[")) {
      if (!/^\[[0-9a-fA-F:.]+\]$/.test(text)) return null;
      return text.toLowerCase();
    }
    if (special) {
      let host;
      try {
        host = decodeURIComponent(text).toLowerCase();
      } catch (error) {
        return null;
      }
      if (host === "" || /[\u0000- #%\/:<>?@\[\\\]^|\u007f]/.test(host)) return null;
      return host;
    }
    if (/[\u0000\t\n\r #\/<>?@\[\\\]^|]/.test(text)) return null;
    return encode(text, "");
  }

  // authority and path, with the tail already taken off: "user:pw@host:80/a/b".
  function parseAuthority(scheme, text, query, fragment) {
    const special = isSpecial(scheme);
    const slash = text.search(special ? /[\/\\]/ : /\//);
    const authority = slash === -1 ? text : text.slice(0, slash);
    const pathText = slash === -1 ? "" : text.slice(slash);

    let username = "";
    let password = "";
    let hostPort = authority;
    const at = authority.lastIndexOf("@");
    if (at !== -1) {
      const userinfo = authority.slice(0, at);
      hostPort = authority.slice(at + 1);
      const colon = userinfo.indexOf(":");
      username = encode(colon === -1 ? userinfo : userinfo.slice(0, colon), USERINFO_SET);
      password = colon === -1 ? "" : encode(userinfo.slice(colon + 1), USERINFO_SET);
    }

    let hostText = hostPort;
    let port = "";
    const bracket = hostPort.lastIndexOf("]");
    const colon = hostPort.lastIndexOf(":");
    if (colon > bracket) {
      hostText = hostPort.slice(0, colon);
      port = hostPort.slice(colon + 1);
      if (!/^[0-9]*$/.test(port)) return null;
      if (port !== "") {
        if (Number(port) > 65535) return null;
        port = String(Number(port));
        if (port === SPECIAL_PORTS[scheme]) port = "";
      }
    }

    if (hostText === "" && (scheme !== "file" && special)) return null;
    if (hostText === "" && (username !== "" || password !== "" || port !== "")) return null;
    const host = hostText === "" ? "" : parseHost(hostText, special);
    if (host === null) return null;

    return {
      scheme,
      username,
      password,
      host: scheme === "file" && host === "localhost" ? "" : host,
      port,
      opaque: false,
      path: special || pathText !== "" ? normalizePath(pathText, special) : "",
      query: query === null ? null : encode(query, special ? SPECIAL_QUERY_SET : QUERY_SET),
      fragment: fragment === null ? null : encode(fragment, FRAGMENT_SET),
    };
  }

  function parse(input, base) {
    const text = String(input).replace(/^[\u0000- ]+|[\u0000- ]+$/g, "").replace(/[\t\n\r]/g, "");
    const match = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(text);

    if (match) {
      const scheme = match[1].toLowerCase();
      const rest = text.slice(match[0].length);
      const special = isSpecial(scheme);
      const tail = splitTail(rest);

      if (special) {
        if (scheme === "file") {
          const body = tail.text.replace(/^[\/\\]{2}/, "");
          const hasHost = body !== tail.text;
          return parseAuthority(scheme, hasHost ? body : "/" + tail.text.replace(/^[\/\\]+/, ""), tail.query, tail.fragment);
        }
        return parseAuthority(scheme, tail.text.replace(/^[\/\\]*/, ""), tail.query, tail.fragment);
      }
      if (tail.text.startsWith("//")) {
        return parseAuthority(scheme, tail.text.slice(2), tail.query, tail.fragment);
      }
      if (tail.text.startsWith("/")) {
        return {
          scheme, username: "", password: "", host: null, port: "", opaque: false,
          path: normalizePath(tail.text, false),
          query: tail.query === null ? null : encode(tail.query, QUERY_SET),
          fragment: tail.fragment === null ? null : encode(tail.fragment, FRAGMENT_SET),
        };
      }
      return {
        scheme, username: "", password: "", host: null, port: "", opaque: true,
        path: encode(tail.text, ""),
        query: tail.query === null ? null : encode(tail.query, QUERY_SET),
        fragment: tail.fragment === null ? null : encode(tail.fragment, FRAGMENT_SET),
      };
    }

    if (!base) return null;
    const special = isSpecial(base.scheme);
    const tail = splitTail(text);
    const query = tail.query === null ? null : encode(tail.query, special ? SPECIAL_QUERY_SET : QUERY_SET);
    const fragment = tail.fragment === null ? null : encode(tail.fragment, FRAGMENT_SET);

    if (base.opaque) {
      if (!text.startsWith("#")) return null;
      return Object.assign({}, base, { fragment });
    }
    if (text === "") return Object.assign({}, base, { fragment: null });
    if (text.startsWith("#")) return Object.assign({}, base, { fragment });
    if (text.startsWith("?")) return Object.assign({}, base, { query, fragment });

    const slashes = special ? /^[\/\\]{2}/ : /^\/\//;
    if (slashes.test(tail.text)) {
      return parseAuthority(base.scheme, tail.text.slice(2), tail.query, tail.fragment);
    }

    const absolute = special ? /^[\/\\]/.test(tail.text) : tail.text.startsWith("/");
    const path = absolute
      ? normalizePath(tail.text, special)
      : normalizePath(base.path.slice(0, base.path.lastIndexOf("/") + 1) + tail.text, special);

    return Object.assign({}, base, { path, query, fragment });
  }

  function serialize(record) {
    let out = record.scheme + ":";
    if (record.host !== null) {
      out += "//";
      if (record.username !== "" || record.password !== "") {
        out += record.username + (record.password !== "" ? ":" + record.password : "") + "@";
      }
      out += record.host + (record.port !== "" ? ":" + record.port : "");
    } else if (!record.opaque && record.path.startsWith("//")) {
      out += "/.";
    }
    out += record.path;
    if (record.query !== null) out += "?" + record.query;
    if (record.fragment !== null) out += "#" + record.fragment;
    return out;
  }

  // URLSearchParams ----------------------------------------------------------

  const lists = new WeakMap();
  const links = new WeakMap();

  function formEncode(text) {
    return encodeURIComponent(String(text).toWellFormed())
      .replace(/[!'()~]/g, (char) => hex(char.charCodeAt(0)))
      .replace(/%20/g, "+");
  }

  function formDecode(text) {
    const spaced = text.replace(/\+/g, " ");
    try {
      return decodeURIComponent(spaced);
    } catch (error) {
      return spaced.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
        try {
          return decodeURIComponent(run);
        } catch (inner) {
          return run;
        }
      });
    }
  }

  function parseQuery(text) {
    const list = [];
    for (const piece of text.split("&")) {
      if (piece === "") continue;
      const equals = piece.indexOf("=");
      list.push(
        equals === -1
          ? [formDecode(piece), ""]
          : [formDecode(piece.slice(0, equals)), formDecode(piece.slice(equals + 1))],
      );
    }
    return list;
  }

  function changed(params) {
    const link = links.get(params);
    if (link) link(params.toString());
  }

  class URLSearchParams {
    constructor(init) {
      let list = [];

      if (init === undefined || init === null) {
        list = [];
      } else if (typeof init === "object" || typeof init === "function") {
        if (init instanceof URLSearchParams) {
          list = lists.get(init).map((pair) => [pair[0], pair[1]]);
        } else if (typeof init[Symbol.iterator] === "function") {
          for (const pair of init) {
            const items = Array.from(pair);
            if (items.length !== 2) {
              throw new TypeError("Each query pair must be an iterable [name, value] tuple");
            }
            list.push([String(items[0]).toWellFormed(), String(items[1]).toWellFormed()]);
          }
        } else {
          for (const key of Object.keys(init)) {
            list.push([key.toWellFormed(), String(init[key]).toWellFormed()]);
          }
        }
      } else {
        const text = String(init);
        list = parseQuery(text.startsWith("?") ? text.slice(1) : text);
      }

      lists.set(this, list);
    }

    get size() {
      return lists.get(this).length;
    }

    append(name, value) {
      if (arguments.length < 2) throw new TypeError("The name and value arguments are required");
      lists.get(this).push([String(name).toWellFormed(), String(value).toWellFormed()]);
      changed(this);
    }

    delete(name, value) {
      if (arguments.length < 1) throw new TypeError("The name argument is required");
      const key = String(name).toWellFormed();
      const wanted = value === undefined ? undefined : String(value).toWellFormed();
      lists.set(this, lists.get(this).filter((pair) => !(pair[0] === key && (wanted === undefined || pair[1] === wanted))));
      changed(this);
    }

    get(name) {
      if (arguments.length < 1) throw new TypeError("The name argument is required");
      const key = String(name).toWellFormed();
      const found = lists.get(this).find((pair) => pair[0] === key);
      return found === undefined ? null : found[1];
    }

    getAll(name) {
      if (arguments.length < 1) throw new TypeError("The name argument is required");
      const key = String(name).toWellFormed();
      return lists.get(this).filter((pair) => pair[0] === key).map((pair) => pair[1]);
    }

    has(name, value) {
      if (arguments.length < 1) throw new TypeError("The name argument is required");
      const key = String(name).toWellFormed();
      const wanted = value === undefined ? undefined : String(value).toWellFormed();
      return lists.get(this).some((pair) => pair[0] === key && (wanted === undefined || pair[1] === wanted));
    }

    set(name, value) {
      if (arguments.length < 2) throw new TypeError("The name and value arguments are required");
      const key = String(name).toWellFormed();
      const text = String(value).toWellFormed();
      const list = lists.get(this);
      const first = list.findIndex((pair) => pair[0] === key);

      if (first === -1) {
        list.push([key, text]);
      } else {
        list[first][1] = text;
        lists.set(this, list.filter((pair, index) => index <= first || pair[0] !== key));
      }
      changed(this);
    }

    sort() {
      const list = lists.get(this);
      const order = list.map((pair, index) => [pair, index]);
      order.sort((a, b) => (a[0][0] < b[0][0] ? -1 : a[0][0] > b[0][0] ? 1 : a[1] - b[1]));
      lists.set(this, order.map((entry) => entry[0]));
      changed(this);
    }

    forEach(callback, thisArg) {
      if (typeof callback !== "function") throw new TypeError("The callback must be a function");
      for (const pair of lists.get(this).slice()) {
        callback.call(thisArg, pair[1], pair[0], this);
      }
    }

    keys() {
      return lists.get(this).map((pair) => pair[0])[Symbol.iterator]();
    }

    values() {
      return lists.get(this).map((pair) => pair[1])[Symbol.iterator]();
    }

    entries() {
      return lists.get(this).map((pair) => [pair[0], pair[1]])[Symbol.iterator]();
    }

    [Symbol.iterator]() {
      return this.entries();
    }

    toString() {
      return lists.get(this).map((pair) => formEncode(pair[0]) + "=" + formEncode(pair[1])).join("&");
    }
  }

  Object.defineProperty(URLSearchParams.prototype, Symbol.toStringTag, { value: "URLSearchParams", configurable: true });

  // URL ----------------------------------------------------------------------

  class URL {
    #record;
    #params;

    constructor(url, base) {
      if (arguments.length === 0) throw new TypeError("The url argument is required");
      let baseRecord;
      if (base !== undefined) {
        baseRecord = parse(base);
        if (baseRecord === null) throw invalidUrl();
      }
      const record = parse(url, baseRecord);
      if (record === null) throw invalidUrl();
      this.#record = record;
      this.#params = new URLSearchParams(record.query === null ? "" : record.query);
      links.set(this.#params, (query) => {
        this.#record = Object.assign({}, this.#record, { query: query === "" ? null : query });
      });
    }

    static canParse(url, base) {
      try {
        new URL(url, base);
        return true;
      } catch (error) {
        return false;
      }
    }

    static parse(url, base) {
      try {
        return new URL(url, base);
      } catch (error) {
        return null;
      }
    }

    #update(changes) {
      this.#record = Object.assign({}, this.#record, changes);
    }

    #resetParams() {
      const query = this.#record.query;
      lists.set(this.#params, parseQuery(query === null ? "" : query));
    }

    get href() {
      return serialize(this.#record);
    }

    set href(value) {
      const record = parse(value);
      if (record === null) throw invalidUrl();
      this.#record = record;
      this.#resetParams();
    }

    get origin() {
      const record = this.#record;
      return isSpecial(record.scheme) && record.scheme !== "file"
        ? record.scheme + "://" + record.host + (record.port !== "" ? ":" + record.port : "")
        : "null";
    }

    get protocol() {
      return this.#record.scheme + ":";
    }

    set protocol(value) {
      const match = /^([a-zA-Z][a-zA-Z0-9+.\-]*):?/.exec(String(value));
      if (!match) return;
      const scheme = match[1].toLowerCase();
      if (isSpecial(scheme) !== isSpecial(this.#record.scheme) || this.#record.opaque) return;
      if (scheme === "file" && (this.#record.username !== "" || this.#record.password !== "" || this.#record.port !== "")) return;
      this.#update({
        scheme,
        port: this.#record.port === SPECIAL_PORTS[scheme] ? "" : this.#record.port,
      });
    }

    get username() {
      return this.#record.username;
    }

    set username(value) {
      if (this.#record.host === null || this.#record.host === "" || this.#record.scheme === "file") return;
      this.#update({ username: encode(String(value), USERINFO_SET) });
    }

    get password() {
      return this.#record.password;
    }

    set password(value) {
      if (this.#record.host === null || this.#record.host === "" || this.#record.scheme === "file") return;
      this.#update({ password: encode(String(value), USERINFO_SET) });
    }

    get host() {
      const record = this.#record;
      return record.host === null ? "" : record.host + (record.port !== "" ? ":" + record.port : "");
    }

    set host(value) {
      if (this.#record.host === null) return;
      const text = String(value).split(/[\/?#]/)[0];
      const record = parseAuthority(this.#record.scheme, text, null, null);
      if (record === null || text.indexOf("@") !== -1) return;
      const explicitPort = text.lastIndexOf(":") > text.lastIndexOf("]");
      this.#update({ host: record.host, port: explicitPort ? record.port : this.#record.port });
    }

    get hostname() {
      return this.#record.host === null ? "" : this.#record.host;
    }

    set hostname(value) {
      if (this.#record.host === null) return;
      const text = String(value).split(/[\/?#:]/)[0];
      if (text === "" && isSpecial(this.#record.scheme)) return;
      const host = text === "" ? "" : parseHost(text, isSpecial(this.#record.scheme));
      if (host !== null) this.#update({ host });
    }

    get port() {
      return this.#record.port;
    }

    set port(value) {
      const record = this.#record;
      if (record.host === null || record.host === "" || record.scheme === "file") return;
      const text = String(value);
      if (text === "") {
        this.#update({ port: "" });
        return;
      }
      const digits = /^[0-9]+/.exec(text);
      if (!digits || Number(digits[0]) > 65535) return;
      const port = String(Number(digits[0]));
      this.#update({ port: port === SPECIAL_PORTS[record.scheme] ? "" : port });
    }

    get pathname() {
      return this.#record.path;
    }

    set pathname(value) {
      if (this.#record.opaque) return;
      const special = isSpecial(this.#record.scheme);
      const text = String(value);
      this.#update({ path: normalizePath(special && !/^[\/\\]/.test(text) ? "/" + text : text, special) });
    }

    get search() {
      const query = this.#record.query;
      return query === null || query === "" ? "" : "?" + query;
    }

    set search(value) {
      const text = String(value);
      const query = text === "" ? null : encode(text.startsWith("?") ? text.slice(1) : text, isSpecial(this.#record.scheme) ? SPECIAL_QUERY_SET : QUERY_SET);
      this.#update({ query });
      this.#resetParams();
    }

    get searchParams() {
      return this.#params;
    }

    get hash() {
      const fragment = this.#record.fragment;
      return fragment === null || fragment === "" ? "" : "#" + fragment;
    }

    set hash(value) {
      const text = String(value);
      this.#update({ fragment: text === "" ? null : encode(text.startsWith("#") ? text.slice(1) : text, FRAGMENT_SET) });
    }

    toString() {
      return this.href;
    }

    toJSON() {
      return this.href;
    }
  }

  Object.defineProperty(URL.prototype, Symbol.toStringTag, { value: "URL", configurable: true });

  register(URLSearchParams, function (params) {
    return { entries: lists.get(params), map: true };
  });
  const readHref = Object.getOwnPropertyDescriptor(URL.prototype, "href").get;

  register(URL, function (url) {
    // Throws for anything that is not a real URL, such as a proxy that says it is.
    readHref.call(url);
    return {
      entries: [
        ["href", url.href],
        ["origin", url.origin],
        ["protocol", url.protocol],
        ["username", url.username],
        ["password", url.password],
        ["host", url.host],
        ["hostname", url.hostname],
        ["port", url.port],
        ["pathname", url.pathname],
        ["search", url.search],
        ["searchParams", url.searchParams],
        ["hash", url.hash],
      ],
      map: false,
    };
  });

  return { URL, URLSearchParams };
})
