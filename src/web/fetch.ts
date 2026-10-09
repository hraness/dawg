/**
 * Fetch a public http(s) URL for the agent and reduce it to readable text.
 * Hostnames are resolved first and every address must be public (no
 * loopback, private, link-local, CGNAT or multicast ranges); redirects are
 * followed manually so each hop gets the same check. Bodies are capped at
 * 2 MiB and the text handed to the model at 32 KiB.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { checkServerIdentity, type PeerCertificate } from "node:tls";
import {
  decodeEntities,
  describeFetchError,
  readBounded,
  timeoutSignal,
  WebError,
  type FetchLike,
} from "./http.ts";

export const FETCH_LIMITS = Object.freeze({
  maxUrlChars: 2048,
  timeoutMs: 20_000,
  maxBodyBytes: 2 * 1024 * 1024,
  maxOutputChars: 32 * 1024,
  maxRedirects: 3,
  maxLinkChars: 120,
});

/** Resolve a hostname to its addresses; injected in tests. */
export type Lookup = (hostname: string) => Promise<readonly string[]>;

export type FetchUrlOptions = Readonly<{
  fetch?: FetchLike;
  lookup?: Lookup;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputChars?: number;
}>;

export type FetchedPage = Readonly<{
  url: string;
  status: number;
  contentType: string;
  title?: string;
  /** Readable text, at most `maxOutputChars`. */
  text: string;
  bytes: number;
  /** The body hit the byte cap or the text hit the output cap. */
  truncated: boolean;
}>;

const defaultLookup: Lookup = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map(
    (entry) => entry.address,
  );

/** True for loopback, unspecified, private, link-local, CGNAT, multicast and reserved addresses. */
export function isPrivateAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return isPrivateV4(address);
  if (kind === 6) return isPrivateV6(address);
  return true;
}

function isPrivateV4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && parts[2] === 0) ||
    (a === 192 && b === 0 && parts[2] === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && parts[2] === 100) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    a >= 224
  );
}

/** Expand an IPv6 address (zone stripped, embedded dotted IPv4 allowed) to 8 groups. */
function expandV6(address: string): number[] | undefined {
  let text = address.toLowerCase().split("%")[0]!;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [
      number,
      number,
      number,
      number,
    ];
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const parse = (part: string) =>
    part === ""
      ? []
      : part.split(":").map((group) => Number.parseInt(group, 16));
  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return undefined;
  const groups = [
    ...head,
    ...new Array<number>(halves.length === 2 ? fill : 0).fill(0),
    ...tail,
  ];
  return groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff)
    ? groups
    : undefined;
}

function v4From(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function isPrivateV6(address: string): boolean {
  const g = expandV6(address);
  if (!g) return true;
  const zero = (from: number, to: number) =>
    g.slice(from, to).every((x) => x === 0);
  // ::/96 covers :: and ::1 and the deprecated IPv4-compatible form (::a.b.c.d).
  if (zero(0, 6)) return true;
  // ::ffff:0:0/96 IPv4-mapped: as private as the address it carries.
  if (zero(0, 5) && g[5] === 0xffff) return isPrivateV4(v4From(g[6]!, g[7]!));
  // 2002::/16 6to4 embeds an IPv4 address in bits 16..47.
  if (g[0] === 0x2002) return isPrivateV4(v4From(g[1]!, g[2]!));
  const first = g[0]!;
  return (
    (first === 0x64 && g[1] === 0xff9b) || // 64:ff9b::/96 and 64:ff9b:1::/48 NAT64
    (first === 0x100 && zero(1, 4)) || // 100::/64 discard
    (first === 0x2001 && g[1] === 0) || // 2001::/32 Teredo (obfuscated IPv4)
    (first === 0x2001 && g[1] === 0xdb8) || // 2001:db8::/32 documentation
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xffc0) === 0xfec0 || // fec0::/10 deprecated site-local
    (first & 0xff00) === 0xff00 // ff00::/8 multicast
  );
}

/** Parse and admit a URL: http(s) only, bounded, host not an obvious local name. */
export function admitUrl(raw: unknown): URL {
  if (typeof raw !== "string" || raw.trim().length === 0)
    throw new WebError("url must be a non-empty string");
  const text = raw.trim();
  if (text.length > FETCH_LIMITS.maxUrlChars)
    throw new WebError(
      `url is longer than ${FETCH_LIMITS.maxUrlChars} characters`,
    );
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new WebError("url is not a valid absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new WebError(
      `only http and https URLs are fetched (got ${url.protocol})`,
    );
  if (url.username || url.password)
    throw new WebError("urls with embedded credentials are not fetched");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  )
    throw new WebError(`${host || "empty host"} is not a public host`);
  return url;
}

/**
 * Check that a URL's host is public and return the address to connect to.
 * Every resolved address must be public; the first one is returned so the
 * request connects to exactly the address that was checked, never to a
 * second, independent DNS answer (which a rebinding domain could point at
 * loopback or a metadata service).
 */
async function assertPublicHost(url: URL, lookup: Lookup): Promise<string> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateAddress(host))
      throw new WebError(`${host} is a private or local address`);
    return host;
  }
  let addresses: readonly string[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new WebError(`${host} did not resolve`);
  }
  if (addresses.length === 0) throw new WebError(`${host} did not resolve`);
  for (const address of addresses)
    if (isPrivateAddress(address))
      throw new WebError(`${host} resolves to a private or local address`);
  return addresses[0]!;
}

/** Bun's fetch accepts TLS options beyond the standard RequestInit. */
type PinnedInit = RequestInit & {
  tls?: {
    serverName?: string;
    checkServerIdentity?: (
      hostname: string,
      cert: PeerCertificate,
    ) => Error | undefined;
  };
};

/**
 * Address a request to a checked IP while keeping the original name for the
 * Host header and for TLS (SNI and certificate verification), so the
 * connection cannot be redirected by a later DNS answer.
 */
export function pinRequest(
  url: URL,
  address: string,
): { target: string; host: string; tls?: PinnedInit["tls"] } {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const pinned = new URL(url.toString());
  pinned.hostname = isIP(address) === 6 ? `[${address}]` : address;
  const result: { target: string; host: string; tls?: PinnedInit["tls"] } = {
    target: pinned.toString(),
    host: url.host,
  };
  if (url.protocol === "https:" && !isIP(hostname))
    result.tls = {
      serverName: hostname,
      checkServerIdentity: (_name, cert) => checkServerIdentity(hostname, cert),
    };
  return result;
}

export async function fetchUrl(
  raw: unknown,
  options: FetchUrlOptions = {},
): Promise<FetchedPage> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const lookup = options.lookup ?? defaultLookup;
  const timeoutMs = options.timeoutMs ?? FETCH_LIMITS.timeoutMs;
  const maxOutputChars = options.maxOutputChars ?? FETCH_LIMITS.maxOutputChars;
  const timer = timeoutSignal(timeoutMs, options.signal);
  try {
    let url = admitUrl(raw);
    let response: Response | undefined;
    for (let hop = 0; hop <= FETCH_LIMITS.maxRedirects; hop += 1) {
      const address = await assertPublicHost(url, lookup);
      const pin = pinRequest(url, address);
      const init: PinnedInit = {
        method: "GET",
        redirect: "manual",
        headers: {
          host: pin.host,
          accept:
            "text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5",
          "user-agent": "Mozilla/5.0 (compatible; dawg-agent)",
        },
        signal: timer.signal,
      };
      if (pin.tls) init.tls = pin.tls;
      try {
        response = await fetcher(pin.target, init);
      } catch (error) {
        throw new WebError(
          `fetch failed: ${timer.timedOut() ? `timed out after ${timeoutMs / 1000}s` : describeFetchError(error)}`,
        );
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location)
          throw new WebError(`HTTP ${response.status} without a location`);
        if (hop === FETCH_LIMITS.maxRedirects)
          throw new WebError(
            `more than ${FETCH_LIMITS.maxRedirects} redirects`,
          );
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          throw new WebError("redirect to an invalid URL");
        }
        url = admitUrl(next.toString());
        response = undefined;
        continue;
      }
      break;
    }
    if (!response) throw new WebError("no response");
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new WebError(`HTTP ${response.status} from ${url.hostname}`);
    }
    const contentType = (response.headers.get("content-type") ?? "")
      .split(";")[0]!
      .trim()
      .toLowerCase();
    const { bytes, truncated: bodyTruncated } = await readBounded(
      response,
      FETCH_LIMITS.maxBodyBytes,
      timer.signal,
    );
    const base = {
      url: url.toString(),
      status: response.status,
      contentType: contentType || "application/octet-stream",
      bytes: bytes.byteLength,
    };
    if (!isTextual(contentType, bytes)) {
      return {
        ...base,
        text: `${base.contentType}, ${bytes.byteLength}${bodyTruncated ? "+" : ""} bytes; not text`,
        truncated: bodyTruncated,
      };
    }
    const decoded = new TextDecoder("utf-8").decode(bytes);
    const readable =
      contentType.includes("html") || looksLikeHtml(decoded)
        ? htmlToText(decoded)
        : { text: decoded.replace(/\r\n?/g, "\n").trim() };
    const clipped = readable.text.length > maxOutputChars;
    const text = clipped
      ? `${readable.text.slice(0, maxOutputChars)}\n\n[truncated: showing ${maxOutputChars} of ${readable.text.length} characters${bodyTruncated ? "; the body itself was cut at 2 MiB" : ""}]`
      : bodyTruncated
        ? `${readable.text}\n\n[truncated: the body was cut at 2 MiB]`
        : readable.text;
    return {
      ...base,
      ...(readable.title ? { title: readable.title } : {}),
      text,
      truncated: clipped || bodyTruncated,
    };
  } finally {
    timer.dispose();
  }
}

function isTextual(contentType: string, bytes: Uint8Array): boolean {
  if (
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("xml") ||
    contentType.includes("javascript")
  )
    return true;
  if (contentType && contentType !== "application/octet-stream") return false;
  return !bytes.subarray(0, 8192).includes(0);
}

function looksLikeHtml(text: string): boolean {
  return /^\s*(?:<!doctype html|<html|<head|<body)/i.test(text.slice(0, 512));
}

const INLINE_TAGS =
  "a|em|strong|b|i|u|s|span|code|kbd|var|samp|small|sup|sub|mark|abbr|cite|q|time|label|del|ins|wbr";
const BLOCK_TAGS =
  "p|div|section|article|main|aside|header|footer|ul|ol|table|tr|blockquote|pre|figure|figcaption|form|fieldset|hr|dl|dt|dd|address|details|summary";

/**
 * HTML → readable text: drops script, style, nav and similar; keeps heading
 * levels as `#` prefixes, list items as `- `, and absolute links as
 * `text (url)`; collapses whitespace.
 */
export function htmlToText(html: string): { title?: string; text: string } {
  const titleMatch = /<title[^>]{0,200}>([\s\S]{0,500}?)<\/title>/i.exec(html);
  const title = titleMatch
    ? decodeEntities(titleMatch[1]!).replace(/\s+/g, " ").trim()
    : undefined;
  let text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      /<(script|style|noscript|template|svg|canvas|iframe|nav|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      " ",
    )
    .replace(
      /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi,
      (_m, level: string, body: string) =>
        `\n\n${"#".repeat(Number(level))} ${inline(body)}\n\n`,
    )
    .replace(
      /<a\b[^>]*?href="(https?:\/\/[^"]{1,2000})"[^>]*>([\s\S]{0,2000}?)<\/a\s*>/gi,
      (_m, href: string, body: string) => {
        const label = inline(body);
        if (!label) return " ";
        const target = decodeEntities(href);
        return target.length > FETCH_LIMITS.maxLinkChars
          ? label
          : `${label} (${target})`;
      },
    )
    .replace(/\s*<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(new RegExp(`</?(?:${INLINE_TAGS})\\b[^>]*>`, "gi"), "")
    .replace(/<\/(?:td|th)\s*>/gi, " \t")
    .replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n\n")
    .replace(/<[^>]{0,1000}>/g, " ");
  text = decodeEntities(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return title ? { title, text } : { text };
}

function inline(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]{0,1000}>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Render a fetched page as the text the model reads. */
export function formatFetchedPage(page: FetchedPage): string {
  const head = [
    `${page.url} · HTTP ${page.status} · ${page.contentType} · ${page.bytes} bytes`,
    ...(page.title ? [`title: ${page.title}`] : []),
  ];
  return `${head.join("\n")}\n\n${page.text}`;
}
