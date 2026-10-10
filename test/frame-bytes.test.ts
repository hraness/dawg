import { describe, expect, test } from "bun:test";
import { best, budget } from "./perf.ts";
import { MAX_BACKOFF_MS, TuiApp } from "../tui/app.ts";
import { generateStyle, styleScore } from "../core/styles/generate.ts";
import type { TrackScoreSnapshot } from "../tui/highway.ts";
import { highwayLayers } from "../tui/layers.ts";
import { CellBuffer, ScreenWriter } from "../tui/screen.ts";
import type { Style, TerminalCapabilities } from "../tui/theme.ts";
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

/**
 * What `style house 8` puts on screen with bass focused: the focused notes
 * plus every other track overlaid (drums, chords, pad, lead), the way
 * src/main.ts snapshot() builds it in the default all-tracks view.
 */
function styleFixture(): TrackScoreSnapshot {
  const value = styleScore(generateStyle("house", { bars: 8 }));
  const tpb = value.ticksPerBeat;
  return {
    trackName: "bass",
    trackId: "bass",
    sessionId: "7f3a91c2-0000",
    revision: 4,
    bpm: value.tempoBpm,
    key: value.key ?? undefined,
    playing: true,
    loopBeats: value.bars * value.beatsPerBar,
    beatsPerBar: value.beatsPerBar,
    laneCount: 24,
    notes: value.notes
      .filter((note) => note.trackId === "bass")
      .map((note) => ({
        id: note.id,
        startBeat: note.startTick / tpb,
        durationBeats: note.durationTicks / tpb,
        pitch: note.pitch,
        velocity: note.velocity,
      })),
    layers: highwayLayers(value.tracks, value.notes, tpb, "bass"),
  };
}

/** Bytes a playing loop costs per second at 30 fps on a fixed clock. */
function playback(
  cols: number,
  rows: number,
  seconds: number,
  shown: TrackScoreSnapshot = score,
) {
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
  app.activity.pushCard("✓ house · A minor · 121 BPM · 8 bars · 5 tracks");
  app.activity.pushCard("/model key adds an agent · optional", { once: true });
  app.render({ score: shown, beat: 0 }, { force: true });
  let bytes = 0;
  let largest = 0;
  const frames = seconds * 30;
  for (let frame = 1; frame <= frames; frame += 1) {
    now += 1000 / 30;
    // 120 BPM: two beats a second.
    const out = app.render({ score: shown, beat: (frame / 30) * 2 });
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

  test("diffed frames leave the terminal showing exactly the buffer", () => {
    // Seeded: blanks between coloured glyphs, colour-only changes, bold,
    // backgrounds and wide characters, diffed frame after frame.
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const palette: Array<Style | undefined> = [
      undefined,
      {},
      { fg: { r: 48, g: 54, b: 66 } },
      { fg: { r: 68, g: 106, b: 78 } },
      { fg: { r: 68, g: 106, b: 78 }, bold: true },
      { fg: { r: 93, g: 98, b: 138 }, bg: { r: 20, g: 20, b: 30 } },
      { dim: true },
      { underline: true, fg: { r: 200, g: 10, b: 10 } },
    ];
    const glyphs = [" ", " ", " ", "┈", "┃", "▓", "a", "音"];
    const writer = new ScreenWriter(TRUECOLOR);
    const vt = new VirtualTerminal(30, 6);
    for (let frame = 0; frame < 60; frame += 1) {
      const buffer = new CellBuffer(30, 6);
      for (let y = 0; y < 6; y += 1)
        for (let x = 0; x < 30; x += 1) {
          const ch = glyphs[Math.floor(random() * glyphs.length)]!;
          const style = palette[Math.floor(random() * palette.length)];
          buffer.text(x, y, ch, style, 1);
          if (ch === "音" && x < 29) {
            buffer.text(x, y, ch, style, 2);
            x += 1;
          }
        }
      vt.write(writer.frame(buffer));
      for (let y = 0; y < 6; y += 1)
        for (let x = 0; x < 30; x += 1) {
          const want = buffer.get(x, y)!;
          if (want.ch === "") continue;
          const got = vt.cell(x, y);
          expect(got.ch).toBe(want.ch);
          const style = want.style ?? {};
          const rgb = (c: Style["fg"]) =>
            c ? `rgb(${c.r},${c.g},${c.b})` : undefined;
          expect(got.style.bg).toBe(rgb(style.bg));
          expect(!!got.style.underline).toBe(!!style.underline);
          expect(!!got.style.reverse).toBe(!!style.reverse);
          if (want.ch === " ") continue;
          // A glyph shows its foreground and weight exactly.
          expect(got.style.fg).toBe(rgb(style.fg));
          expect(!!got.style.bold).toBe(!!style.bold);
          expect(!!got.style.dim).toBe(!!style.dim);
        }
    }
  });

  test("bursts of render calls inside one frame write at most once", () => {
    let now = 0;
    const writes: string[] = [];
    const app = new TuiApp({
      io: {
        write: (data) => {
          writes.push(data);
          return true;
        },
        columns: () => 80,
        rows: () => 24,
      },
      capabilities: TRUECOLOR,
      clock: () => now,
    });
    app.render({ score, beat: 0 }, { force: true });
    // One second of tick(true) storms: 20 calls every 33 ms window.
    let written = 0;
    for (let window = 0; window < 30; window += 1) {
      let inWindow = 0;
      for (let call = 0; call < 20; call += 1) {
        now += app.frameIntervalMs / 20;
        if (app.render({ score, beat: now / 500 }) !== "") inWindow += 1;
      }
      expect(inWindow).toBeLessThanOrEqual(1);
      written += inWindow;
    }
    expect(written).toBeLessThanOrEqual(31);
    expect(writes.filter((w) => w.includes("\u001b[?2026h")).length).toBe(
      written + 1,
    );
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

  test("a five-track style playing at 80x24 stays under 60 KB/s", () => {
    const run = playback(80, 24, 4, styleFixture());
    expect(run.perSecond).toBeLessThan(60_000);
  });

  test("playback at 120x40 keeps a bytes-per-frame budget", () => {
    const run = playback(120, 40, 4);
    // About 3.5 KB a frame today; the bound leaves room for richer rows.
    expect(run.perFrame).toBeLessThan(6_000);
    expect(run.largest).toBeLessThan(16_000);
  });
});

describe("CellBuffer at large sizes", () => {
  test("the wide-character repair still holds beside the narrow fast path", () => {
    const buffer = new CellBuffer(6, 1);
    buffer.text(0, 0, "a界b", undefined);
    expect(buffer.get(1, 0)!.ch).toBe("界");
    expect(buffer.get(2, 0)!.ch).toBe("");
    // A narrow write over a wide character's trail blanks its lead.
    buffer.set(2, 0, "x", undefined);
    expect(buffer.get(1, 0)!.ch).toBe(" ");
    // And over its lead blanks the trail.
    buffer.text(3, 0, "界", undefined);
    buffer.set(3, 0, "y", undefined);
    expect(buffer.get(4, 0)!.ch).toBe(" ");
  });

  test("a 500x150 buffer allocates and fills well inside a frame", () => {
    const ms = best(() => {
      const buffer = new CellBuffer(500, 150);
      buffer.fill(0, 0, 500, 150, { fg: { r: 255, g: 255, b: 255 } });
    });
    // About 0.5 ms on the reference Mac; a frame is 33 ms.
    expect(ms).toBeLessThan(budget(4));
  });
});
