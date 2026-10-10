/**
 * Preload for the docs screens (`bun --preload`, via BUN_OPTIONS so dawgd
 * and pane processes get it too): a frozen clock the driver advances by
 * writing milliseconds to `DAWG_SCREEN_CLOCK`, a seeded Math.random and
 * counted UUIDs, so the same scene draws the same cells on every machine.
 *
 * The base time is in the future on purpose: a frozen clock behind the real
 * one would leave FrameGate's last-built stamp ahead of "now" and stall it.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const control = process.env.DAWG_SCREEN_CLOCK;
if (control) {
  const DATE_BASE = 4_102_444_800_000; // 2100-01-01
  const PERF_BASE = 1_000_000_000;
  let ms = 0;
  Date.now = () => DATE_BASE + ms;
  performance.now = () => PERF_BASE + ms;
  // The shared transport puts its clock on the epoch as timeOrigin + now();
  // the real timeOrigin is this process's start, different every run.
  Object.defineProperty(performance, "timeOrigin", {
    value: DATE_BASE - PERF_BASE,
    configurable: true,
  });
  let seen = "";
  const poll = setInterval(() => {
    let text = "";
    try {
      text = readFileSync(control, "utf8").trim();
    } catch {
      return;
    }
    if (text === seen || text === "") return;
    seen = text;
    const next = Number(text);
    if (Number.isFinite(next)) ms = next;
  }, 5);
  poll.unref?.();

  let seed = 0x9e3779b9;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let uuids = 0;
  const uuid = (): `${string}-${string}-${string}-${string}-${string}` => {
    uuids += 1;
    return `5c1e0a7d-0000-4000-8000-${uuids.toString(16).padStart(12, "0")}`;
  };
  globalThis.crypto.randomUUID = uuid;
  // The CommonJS module object is writable; the ESM namespace is not.
  const nodeCrypto = createRequire(import.meta.url)("node:crypto") as {
    randomUUID: typeof uuid;
  };
  nodeCrypto.randomUUID = uuid;
}
