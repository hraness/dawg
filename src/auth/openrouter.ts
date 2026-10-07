import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isValidKey } from "./credentials.ts";

/**
 * OpenRouter's OAuth PKCE flow for apps
 * (https://openrouter.ai/docs/use-cases/oauth-pkce): open
 * `https://openrouter.ai/auth?callback_url=…&code_challenge=…&code_challenge_method=S256`,
 * receive `?code=` on a localhost callback (any port is allowed), then
 * exchange it with `POST /api/v1/auth/keys` for a user-controlled key.
 */
export const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
export const OPENROUTER_API_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_KEYS_URL = "https://openrouter.ai/settings/keys";
export const OAUTH_TIMEOUT_MS = 5 * 60_000;
const MAX_EXCHANGE_BYTES = 16 * 1024;
const CODE_PATTERN = /^[A-Za-z0-9._~-]{8,512}$/;

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type Pkce = Readonly<{
  verifier: string;
  challenge: string;
  state: string;
}>;

function base64url(bytes: Buffer): string {
  return bytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** A 43-character verifier, its S256 challenge, and a CSRF state. */
export function createPkce(
  random: (size: number) => Buffer = randomBytes,
): Pkce {
  const verifier = base64url(random(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge, state: base64url(random(16)) };
}

export function authorizeUrl(
  callbackUrl: string,
  pkce: Pkce,
  base = OPENROUTER_AUTH_URL,
): string {
  const url = new URL(base);
  url.searchParams.set("callback_url", callbackUrl);
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("key_label", "dawg");
  url.searchParams.set("state", pkce.state);
  return url.toString();
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;margin:3rem;max-width:32rem"><h1 style="font-size:1.4rem">${title}</h1><p>${body}</p></body>`;

export type CallbackServer = Readonly<{
  /** `http://127.0.0.1:<port>/callback`. */
  url: string;
  /** Resolves with the code once a request carries the right state. */
  code: Promise<string>;
  stop(): void;
}>;

/**
 * A one-shot callback listener on 127.0.0.1 and an ephemeral port. Requests
 * with a missing or wrong `state` are refused and do not end the wait.
 */
export function startCallbackServer(
  state: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): CallbackServer {
  let settle: { resolve(code: string): void; reject(error: Error): void };
  const code = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject };
  });
  code.catch(() => undefined);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== "/callback")
        return new Response("not found", { status: 404 });
      const html = (status: number, title: string, body: string) =>
        new Response(PAGE(title, body), {
          status,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "referrer-policy": "no-referrer",
          },
        });
      const got = url.searchParams.get("state") ?? "";
      const value = url.searchParams.get("code") ?? "";
      if (!sameSecret(got, state))
        return html(
          400,
          "Sign-in not recognized",
          "This link does not match the sign-in dawg started. Return to the terminal and try again.",
        );
      if (!CODE_PATTERN.test(value)) {
        settle.reject(
          new Error("OpenRouter did not return a code (access denied?)"),
        );
        return html(
          400,
          "Sign-in cancelled",
          "No authorization code came back. You can close this tab.",
        );
      }
      settle.resolve(value);
      return html(
        200,
        "dawg is connected to OpenRouter",
        "You can close this tab and return to the terminal.",
      );
    },
  });
  const timer = setTimeout(
    () => settle.reject(new Error("timed out waiting for the browser")),
    options.timeoutMs ?? OAUTH_TIMEOUT_MS,
  );
  const onAbort = () => settle.reject(new Error("sign-in cancelled"));
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const stop = () => {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    // Graceful first so the browser still gets the "connected" page, then
    // force-close any idle keep-alive sockets.
    void server.stop(false);
    setTimeout(() => void server.stop(true), 1_000).unref?.();
  };
  void code.then(stop, stop);
  return { url: `http://127.0.0.1:${server.port}/callback`, code, stop };
}

/** `POST /api/v1/auth/keys` → the user's new key. */
export async function exchangeCode(
  code: string,
  pkce: Pick<Pkce, "verifier">,
  options: { fetcher?: Fetcher; baseUrl?: string } = {},
): Promise<string> {
  const fetcher = options.fetcher ?? fetch;
  const base = (options.baseUrl ?? OPENROUTER_API_URL).replace(/\/$/, "");
  const response = await fetcher(`${base}/auth/keys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code,
      code_verifier: pkce.verifier,
      code_challenge_method: "S256",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = (await response.text()).slice(0, MAX_EXCHANGE_BYTES);
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? "OpenRouter refused the code (expired or already used)"
        : `OpenRouter key exchange failed (${response.status})`,
    );
  let key: unknown;
  try {
    key = (JSON.parse(text) as { key?: unknown }).key;
  } catch {
    key = undefined;
  }
  if (!isValidKey(key)) throw new Error("OpenRouter returned no usable key");
  return key;
}

export type KeyCheck = "valid" | "rejected" | "unverified";

/** `GET /api/v1/key`: cheap, authenticated, and spends nothing. */
export async function checkOpenRouterKey(
  key: string,
  options: { fetcher?: Fetcher; baseUrl?: string } = {},
): Promise<KeyCheck> {
  const fetcher = options.fetcher ?? fetch;
  const base = (options.baseUrl ?? OPENROUTER_API_URL).replace(/\/$/, "");
  try {
    const response = await fetcher(`${base}/key`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8_000),
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.ok) return "valid";
    if (response.status === 401 || response.status === 403) return "rejected";
    return "unverified";
  } catch {
    return "unverified";
  }
}
