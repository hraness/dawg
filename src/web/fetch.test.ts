import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { WebError, type FetchLike } from "./http.ts";
import {
  admitUrl,
  FETCH_LIMITS,
  fetchUrl,
  formatFetchedPage,
  htmlToText,
  isPrivateAddress,
  pinRequest,
  type Lookup,
} from "./fetch.ts";

const fixture = (name: string) =>
  readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const publicLookup: Lookup = async (host) => {
  if (host.endsWith(".internal")) return ["10.0.0.5"];
  if (host === "v6.example") return ["2001:db8::1"];
  if (host === "mixed.example") return ["93.184.216.34", "::ffff:127.0.0.1"];
  if (host === "dead.example") throw new Error("ENOTFOUND");
  if (host === "empty.example") return [];
  return ["93.184.216.34"];
};

type Route = (url: URL, init: RequestInit) => Response;

function scripted(
  routes: Record<string, Route>,
): FetchLike & { urls: string[]; connected: string[] } {
  const urls: string[] = [];
  const connected: string[] = [];
  const fetcher = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const target = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    // fetchUrl connects to the checked address and names the host in the
    // Host header; route on the logical URL it stands for.
    const host = new Headers(init?.headers).get("host");
    const url = new URL(target.toString());
    if (host) url.host = host;
    urls.push(url.toString());
    connected.push(target.hostname);
    const route =
      routes[url.toString()] ?? routes[`${url.origin}${url.pathname}`];
    if (!route) throw new TypeError(`unexpected fetch ${url}`);
    return route(url, init ?? {});
  }) as FetchLike & { urls: string[]; connected: string[] };
  fetcher.urls = urls;
  fetcher.connected = connected;
  return fetcher;
}

const respond = (
  body: BodyInit | null,
  type: string,
  status = 200,
  extra: Record<string, string> = {},
) =>
  new Response(body, { status, headers: { "content-type": type, ...extra } });

const expectWebError = async (promise: Promise<unknown>, pattern: RegExp) => {
  let error: unknown;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(WebError);
  expect((error as Error).message).toMatch(pattern);
};

describe("address policy", () => {
  test("flags private, loopback, link-local, CGNAT, multicast and mapped addresses", () => {
    for (const address of [
      "127.0.0.1",
      "127.8.8.8",
      "0.0.0.0",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "100.127.1.1",
      "192.0.0.1",
      "192.0.2.1",
      "198.18.0.1",
      "198.51.100.7",
      "203.0.113.9",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fe80::1",
      "fe80::1%en0",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "::ffff:7f00:1",
      "::ffff:c0a8:101",
      "64:ff9b::a00:1",
      "2001:db8::1",
      "::127.0.0.1",
      "::7f00:1",
      "::a00:1",
      "2002:7f00:1::",
      "2002:a9fe:a9fe::1",
      "2002:c0a8:0101::5",
      "fec0::1",
      "feff::1",
      "100::1",
      "64:ff9b:1::a",
      "2001:0:4136:e378::1",
      "0:0:0:0:0:ffff:127.0.0.1",
      "::FFFF:7F00:1",
      "not-an-ip",
    ])
      expect(isPrivateAddress(address)).toBe(true);
    for (const address of [
      "8.8.8.8",
      "93.184.216.34",
      "172.32.0.1",
      "100.128.0.1",
      "2606:4700::1111",
      "::ffff:5db8:d822",
      "2002:5db8:d822::1",
      "2001:4860:4860::8888",
      "101::1",
      "2a00:1450:4001:80b::200e",
    ])
      expect(isPrivateAddress(address)).toBe(false);
  });

  test("admitUrl accepts public http(s) and rejects the rest", () => {
    expect(admitUrl(" https://example.com/a?b=c ").toString()).toBe(
      "https://example.com/a?b=c",
    );
    expect(() => admitUrl("")).toThrow(/non-empty string/);
    expect(() => admitUrl(42)).toThrow(/non-empty string/);
    expect(() => admitUrl("x".repeat(FETCH_LIMITS.maxUrlChars + 1))).toThrow(
      /longer than 2048/,
    );
    expect(() => admitUrl("example.com/no-scheme")).toThrow(
      /not a valid absolute URL/,
    );
    expect(() => admitUrl("file:///etc/passwd")).toThrow(
      /only http and https.*file:/,
    );
    expect(() => admitUrl("ftp://example.com/")).toThrow(/only http and https/);
    expect(() => admitUrl("https://user:pw@example.com/")).toThrow(
      /embedded credentials/,
    );
    expect(() => admitUrl("http://localhost:3000/")).toThrow(
      /localhost is not a public host/,
    );
    expect(() => admitUrl("http://foo.localhost/")).toThrow(
      /not a public host/,
    );
    expect(() => admitUrl("http://printer.local/")).toThrow(
      /not a public host/,
    );
  });
});

describe("fetchUrl", () => {
  test("rejects hosts that resolve privately, fail to resolve, or are private literals", async () => {
    const fetcher = scripted({});
    const options = { fetch: fetcher, lookup: publicLookup };
    await expectWebError(
      fetchUrl("http://db.internal/", options),
      /db\.internal resolves to a private or local address/,
    );
    await expectWebError(
      fetchUrl("http://mixed.example/", options),
      /resolves to a private/,
    );
    await expectWebError(
      fetchUrl("http://v6.example/", options),
      /resolves to a private/,
    );
    await expectWebError(
      fetchUrl("http://dead.example/", options),
      /did not resolve/,
    );
    await expectWebError(
      fetchUrl("http://empty.example/", options),
      /did not resolve/,
    );
    await expectWebError(
      fetchUrl("http://169.254.169.254/latest/meta-data", options),
      /private or local address/,
    );
    await expectWebError(
      fetchUrl("http://[::1]:8080/", options),
      /::1 is a private or local address/,
    );
    expect(fetcher.urls).toEqual([]);
  });

  test("follows up to three redirects and revalidates every hop", async () => {
    const fetcher = scripted({
      "https://example.com/start": () =>
        respond(null, "text/html", 302, { location: "/hop1" }),
      "https://example.com/hop1": () =>
        respond(null, "text/html", 301, {
          location: "https://other.example/hop2",
        }),
      "https://other.example/hop2": () =>
        respond(null, "text/html", 307, {
          location: "https://other.example/final",
        }),
      "https://other.example/final": () => respond("done", "text/plain"),
      "https://example.com/loop": () =>
        respond(null, "text/html", 302, { location: "/loop" }),
      "https://example.com/leak": () =>
        respond(null, "text/html", 302, {
          location: "http://db.internal/secret",
        }),
      "https://example.com/nowhere": () => respond(null, "text/html", 302),
      "https://example.com/scheme": () =>
        respond(null, "text/html", 302, { location: "file:///etc/passwd" }),
    });
    const options = { fetch: fetcher, lookup: publicLookup };
    const page = await fetchUrl("https://example.com/start", options);
    expect(page).toMatchObject({
      url: "https://other.example/final",
      status: 200,
      text: "done",
      bytes: 4,
      truncated: false,
    });
    expect(fetcher.urls).toEqual([
      "https://example.com/start",
      "https://example.com/hop1",
      "https://other.example/hop2",
      "https://other.example/final",
    ]);
    await expectWebError(
      fetchUrl("https://example.com/loop", options),
      /more than 3 redirects/,
    );
    await expectWebError(
      fetchUrl("https://example.com/leak", options),
      /db\.internal resolves to a private/,
    );
    expect(fetcher.urls).not.toContain("http://db.internal/secret");
    await expectWebError(
      fetchUrl("https://example.com/nowhere", options),
      /HTTP 302 without a location/,
    );
    await expectWebError(
      fetchUrl("https://example.com/scheme", options),
      /only http and https/,
    );
    for (const url of fetcher.urls) expect(url.startsWith("http")).toBe(true);
  });

  test("passes a manual-redirect GET with the agent user-agent", async () => {
    let seen: RequestInit | undefined;
    const fetcher = scripted({
      "https://example.com/": (_url, init) => {
        seen = init;
        return respond("ok", "text/plain");
      },
    });
    await fetchUrl("https://example.com/", {
      fetch: fetcher,
      lookup: publicLookup,
    });
    expect(seen?.method).toBe("GET");
    expect(seen?.redirect).toBe("manual");
    expect((seen?.headers as Record<string, string>)["user-agent"]).toContain(
      "dawg-agent",
    );
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });

  test("reports HTTP errors, non-text bodies, and reduces HTML to text", async () => {
    const page = await fixture("page.html");
    const wav = new Uint8Array(40);
    wav.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    const fetcher = scripted({
      "https://example.com/missing": () => respond("gone", "text/html", 404),
      "https://example.com/kick.wav": () => respond(wav, "audio/wav"),
      "https://example.com/blob": () => respond(new Uint8Array([1, 0, 2]), ""),
      "https://example.com/data.json": () =>
        respond('{"a":1}\r\n', "application/json; charset=utf-8"),
      "https://example.com/doc": () =>
        respond(page, "text/html; charset=utf-8"),
      "https://example.com/sniffed": () =>
        respond("<!doctype html><title>Sniffed</title><p>body</p>", ""),
    });
    const options = { fetch: fetcher, lookup: publicLookup };
    await expectWebError(
      fetchUrl("https://example.com/missing", options),
      /HTTP 404 from example\.com/,
    );
    expect(await fetchUrl("https://example.com/kick.wav", options)).toEqual({
      url: "https://example.com/kick.wav",
      status: 200,
      contentType: "audio/wav",
      bytes: 40,
      text: "audio/wav, 40 bytes; not text",
      truncated: false,
    });
    expect((await fetchUrl("https://example.com/blob", options)).text).toBe(
      "application/octet-stream, 3 bytes; not text",
    );
    const data = await fetchUrl("https://example.com/data.json", options);
    expect(data.contentType).toBe("application/json");
    expect(data.text).toBe('{"a":1}');
    const doc = await fetchUrl("https://example.com/doc", options);
    expect(doc.title).toBe("Freeverb & friends — notes");
    expect(doc.text).toContain("# Freeverb");
    expect(formatFetchedPage(doc)).toMatch(
      /^https:\/\/example\.com\/doc · HTTP 200 · text\/html · \d+ bytes\ntitle: Freeverb & friends — notes\n\n# Freeverb/,
    );
    const sniffed = await fetchUrl("https://example.com/sniffed", options);
    expect(sniffed.title).toBe("Sniffed");
    expect(sniffed.text).toBe("body");
  });

  test("caps the text handed to the model and notes the truncation", async () => {
    const long = Array.from(
      { length: 500 },
      (_, index) => `line ${index}`,
    ).join("\n");
    const fetcher = scripted({
      "https://example.com/long": () => respond(long, "text/plain"),
    });
    const page = await fetchUrl("https://example.com/long", {
      fetch: fetcher,
      lookup: publicLookup,
      maxOutputChars: 100,
    });
    expect(page.truncated).toBe(true);
    expect(page.text.startsWith(long.slice(0, 100))).toBe(true);
    expect(
      page.text.endsWith(
        `[truncated: showing 100 of ${long.length} characters]`,
      ),
    ).toBe(true);
  });

  test("times out a stalled server", async () => {
    const stalled: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    await expectWebError(
      fetchUrl("https://example.com/slow", {
        fetch: stalled,
        lookup: publicLookup,
        timeoutMs: 20,
      }),
      /fetch failed: timed out after 0\.02s/,
    );
  });
});

describe("htmlToText", () => {
  test("keeps headings, lists, links and code; drops chrome", async () => {
    const { title, text } = htmlToText(await fixture("page.html"));
    expect(title).toBe("Freeverb & friends — notes");
    expect(text).not.toMatch(
      /ignored|color: red|Home|About|a comment|vector noise|Enable JavaScript/,
    );
    expect(text).toContain(
      "# Freeverb\n\nFreeverb is a public-domain reverb by Jezar at Dreampoint (https://example.com/dreampoint?utm_source=x).",
    );
    expect(text).toContain(
      "## Structure\n\n- Eight parallel comb filters\n- Four series allpass filters",
    );
    expect(text).toContain("Stage Count\n\ncomb 8");
    expect(text).toContain("the long link and a relative one.");
    expect(text).toContain("delay = 1116;\nfeedback = 0.84;");
    expect(text).toContain("© 2026");
    expect(text).not.toMatch(/\n{3}/);
  });

  test("handles pages without a title or any markup", () => {
    expect(htmlToText("plain   text\n\n\n\nmore")).toEqual({
      text: "plain text\n\nmore",
    });
    expect(htmlToText("<p>&lt;tag&gt; &amp; &quot;q&quot;</p>")).toEqual({
      text: '<tag> & "q"',
    });
  });
});

describe("DNS rebinding", () => {
  test("connects to the address that was checked, never re-resolving the name", async () => {
    // A rebinding name answers public first; a second lookup (by fetch
    // itself) could answer 127.0.0.1. The fetcher must receive the checked
    // IP with the name only in the Host header.
    let lookups = 0;
    const rebinding: Lookup = async () => {
      lookups += 1;
      return lookups === 1 ? ["93.184.216.34"] : ["127.0.0.1"];
    };
    const fetcher = scripted({
      "http://rebind.example:8080/a": () => respond("ok", "text/plain"),
    });
    const page = await fetchUrl("http://rebind.example:8080/a", {
      fetch: fetcher,
      lookup: rebinding,
    });
    expect(page.text).toBe("ok");
    expect(page.url).toBe("http://rebind.example:8080/a");
    expect(fetcher.connected).toEqual(["93.184.216.34"]);
    expect(lookups).toBe(1);
  });

  test("pins https with SNI and certificate checks on the original name", () => {
    const pin = pinRequest(
      new URL("https://site.example/p?q=1"),
      "2001:4860::8",
    );
    expect(pin.target).toBe("https://[2001:4860::8]/p?q=1");
    expect(pin.host).toBe("site.example");
    expect(pin.tls?.serverName).toBe("site.example");
    expect(typeof pin.tls?.checkServerIdentity).toBe("function");
    const literal = pinRequest(
      new URL("http://93.184.216.34:81/"),
      "93.184.216.34",
    );
    expect(literal).toEqual({
      target: "http://93.184.216.34:81/",
      host: "93.184.216.34:81",
    });
  });

  test("a pinned request reaches the pinned address with the original Host", async () => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request) => new Response(request.headers.get("host") ?? ""),
    });
    try {
      const pin = pinRequest(
        new URL(`http://site.example:${server.port}/x`),
        "127.0.0.1",
      );
      const response = await fetch(pin.target, { headers: { host: pin.host } });
      expect(await response.text()).toBe(`site.example:${server.port}`);
    } finally {
      await server.stop(true);
    }
  });

  test("property: every connection goes to an address the lookup returned and the policy admitted", async () => {
    let seed = 0x9e3779b9;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const pick = <T>(items: readonly T[]) =>
      items[Math.floor(rand() * items.length)]!;
    const publics = [
      "93.184.216.34",
      "1.1.1.1",
      "8.8.4.4",
      "2606:4700::1111",
      "2a00:1450::1",
    ];
    const privates = [
      "127.0.0.1",
      "10.1.2.3",
      "169.254.169.254",
      "::1",
      "fd00::1",
      "::ffff:10.0.0.1",
    ];
    for (let run = 0; run < 200; run += 1) {
      const answers = new Map<string, string[]>();
      const hosts = ["a.example", "b.example", "c.example"];
      for (const host of hosts) {
        const n = 1 + Math.floor(rand() * 3);
        answers.set(
          host,
          Array.from({ length: n }, () =>
            rand() < 0.2 ? pick(privates) : pick(publics),
          ),
        );
      }
      const hops = Array.from({ length: 1 + Math.floor(rand() * 3) }, () =>
        pick(hosts),
      );
      const routes: Record<string, Route> = {};
      hops.forEach((host, i) => {
        const next = hops[i + 1];
        routes[`http://${host}/${i}`] = () =>
          next === undefined
            ? respond("end", "text/plain")
            : respond(null, "text/html", 302, {
                location: `http://${next}/${i + 1}`,
              });
      });
      const fetcher = scripted(routes);
      const lookup: Lookup = async (host) => answers.get(host) ?? [];
      const allPublic = hops.every((h) =>
        answers.get(h)!.every((a) => !isPrivateAddress(a)),
      );
      const result = await fetchUrl(`http://${hops[0]}/0`, {
        fetch: fetcher,
        lookup,
      }).then(
        (page) => page.text,
        (error: unknown) =>
          error instanceof WebError ? "rejected" : String(error),
      );
      expect(result).toBe(allPublic ? "end" : "rejected");
      fetcher.connected.forEach((address, i) => {
        const host = new URL(fetcher.urls[i]!).hostname;
        const bare = address.replace(/^\[|\]$/g, "");
        expect(answers.get(host)).toContain(bare);
        expect(isPrivateAddress(bare)).toBe(false);
      });
    }
  });
});

describe("address policy properties", () => {
  let seed = 0x1234abcd;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const byte = () => Math.floor(rand() * 256);
  const hex = (n: number) => n.toString(16);

  test("embedded IPv4 forms classify like the IPv4 address they carry", () => {
    for (let i = 0; i < 2000; i += 1) {
      const [a, b, c, d] = [byte(), byte(), byte(), byte()];
      const v4 = `${a}.${b}.${c}.${d}`;
      const high = hex((a << 8) | b);
      const low = hex((c << 8) | d);
      const expected = isPrivateAddress(v4);
      expect(isPrivateAddress(`::ffff:${v4}`)).toBe(expected);
      expect(isPrivateAddress(`::ffff:${high}:${low}`)).toBe(expected);
      expect(isPrivateAddress(`2002:${high}:${low}::1`)).toBe(expected);
      // IPv4-compatible ::/96 is never a public destination.
      expect(isPrivateAddress(`::${v4}`)).toBe(true);
    }
  });

  test("compressed and expanded spellings agree, and junk never throws", () => {
    for (let i = 0; i < 2000; i += 1) {
      const groups = Array.from({ length: 8 }, () =>
        rand() < 0.4 ? 0 : Math.floor(rand() * 0x10000),
      );
      const full = groups.map(hex).join(":");
      const compressed = full.replace(/(^|:)0(:0)+(:|$)/, "::");
      expect(isPrivateAddress(compressed)).toBe(isPrivateAddress(full));
      expect(isPrivateAddress(full.toUpperCase())).toBe(isPrivateAddress(full));
      const junk = Array.from(
        { length: 1 + Math.floor(rand() * 20) },
        () => ":.0123456789abcdefg%[]"[Math.floor(rand() * 22)],
      ).join("");
      expect(typeof isPrivateAddress(junk)).toBe("boolean");
    }
  });
});
