import { describe, expect, test } from "bun:test";
import { MAX_BACKOFF_MS, TuiApp } from "../tui/app.ts";
import type { TrackScoreSnapshot } from "../tui/highway.ts";
import { CellBuffer, ScreenWriter } from "../tui/screen.ts";
import type { TerminalCapabilities } from "../tui/theme.ts";
import { VirtualTerminal } from "./vt.ts";

const TRUECOLOR: TerminalCapabilities = {
  colorDepth: "truecolor",
  unicode: true,
};

const score: TrackScoreSnapshot = {
  trackName: "bass",
  trackId: "bass",
  sessionId: "7f3a91c2-0000",
  revision: 3,
  bpm: 120,
  key: "Am",
  playing: true,
  loopBeats: 8,
  beatsPerBar: 4,
  notes: Array.from({ length: 16 }, (_, index) => ({
    startBeat: index * 0.5,
    pitch: 45 + ((index * 5) % 14),
    velocity: 0.5 + (index % 3) * 0.2,
    durationBeats: 0.25,
  })),
};

/** Bytes a playing loop costs per second at 30 fps on a fixed clock. */
function playback(cols: number, rows: number, seconds: number) {
  let now = 0;
  const vt = new VirtualTerminal(cols, rows);
  const app = new TuiApp({
    io: {
      write: (data) => vt.write(data),
      columns: () => cols,
      rows: () => rows,
    },
    capabilities: TRUECOLOR,
    clock: () => now,
  });
  app.render({ score, beat: 0 }, { force: true });
  let bytes = 0;
  let largest = 0;
  const frames = seconds * 30;
  for (let frame = 1; frame <= frames; frame += 1) {
    now += 1000 / 30;
    // 120 BPM: two beats a second.
    const out = app.render({ score, beat: (frame / 30) * 2 });
    bytes += out.length;
    largest = Math.max(largest, out.length);
  }
  return { perSecond: bytes / seconds, perFrame: bytes / frames, largest };
}

describe("frame writer", () => {
  test("a changed row rewrites only its changed cells", () => {
    const writer = new ScreenWriter({ colorDepth: "none", unicode: true });
    const first = new CellBuffer(40, 2);
    first.text(0, 0, "a".repeat(40), undefined);
    writer.frame(first);
    const next = new CellBuffer(40, 2);
    next.text(0, 0, "a".repeat(40), undefined);
    next.set(20, 0, "b", undefined);
    const out = writer.frame(next);
    expect(out).toMatch(/\u001b\[1;21H(?:\u001b\[[0-9;]*m)*b/);
    expect(out).not.toContain("aaaa");
    expect(writer.lastRows).toBe(1);
    // One write per frame, between the synchronized-update markers.
    expect(out.startsWith("\u001b[?2026h")).toBe(true);
    expect(out.endsWith("\u001b[?2026l")).toBe(true);
  });

  test("a span never starts inside a wide character", () => {
    const writer = new ScreenWriter({ colorDepth: "none", unicode: true });
    const first = new CellBuffer(10, 1);
    first.text(2, 0, "音x", undefined);
    writer.frame(first);
    const next = new CellBuffer(10, 1);
    next.text(2, 0, "音y", undefined);
    const vt = new VirtualTerminal(10, 1);
    vt.write(
      new ScreenWriter({ colorDepth: "none", unicode: true }).frame(first),
    );
    const out = writer.frame(next);
    expect(out).toMatch(/\u001b\[1;5H(?:\u001b\[[0-9;]*m)*y/);
    vt.write(out);
    expect(vt.lines()[0]).toContain("音y");
  });

  test("a terminal that lags backs frames off, then recovers", () => {
    let now = 0;
    let accept = false;
    const app = new TuiApp({
      io: { write: () => accept, columns: () => 80, rows: () => 24 },
      capabilities: TRUECOLOR,
      clock: () => now,
    });
    app.render({ score, beat: 0 }, { force: true });
    expect(app.backoffMs).toBe(app.frameIntervalMs);
    for (let index = 0; index < 10; index += 1) {
      now += 1000;
      app.render({ score, beat: index + 1 });
    }
    expect(app.backoffMs).toBe(MAX_BACKOFF_MS);
    // Inside the backoff window nothing is built.
    now += app.frameIntervalMs + 1;
    expect(app.render({ score, beat: 20 })).toBe("");
    accept = true;
    now += MAX_BACKOFF_MS;
    expect(app.render({ score, beat: 21 })).not.toBe("");
    expect(app.backoffMs).toBe(0);
  });

  test("playback at 80x24 stays under 60 KB/s", () => {
    const run = playback(80, 24, 4);
    expect(run.perSecond).toBeLessThan(60_000);
  });

  test("playback at 120x40 keeps a bytes-per-frame budget", () => {
    const run = playback(120, 40, 4);
    // About 3.5 KB a frame today; the bound leaves room for richer rows.
    expect(run.perFrame).toBeLessThan(6_000);
    expect(run.largest).toBeLessThan(16_000);
  });
});
