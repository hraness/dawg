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
): FetchLike & { urls: string[] } {
  const urls: string[] = [];
  const fetcher = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    urls.push(url.toString());
    const route =
      routes[url.toString()] ?? routes[`${url.origin}${url.pathname}`];
    if (!route) throw new TypeError(`unexpected fetch ${url}`);
    return route(url, init ?? {});
  }) as FetchLike & { urls: string[] };
  fetcher.urls = urls;
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
