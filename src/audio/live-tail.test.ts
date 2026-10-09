/**
 * Live note-on latency (q08): a damped key renders a buffer sized by its
 * engine's release instead of the whole 8 s tail window. The renderer is
 * causal, so that buffer must be a byte-exact prefix of the full one.
 */
import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../core/score.ts";
import { LiveSynth } from "./live.ts";

const RATE = 48_000;

function score(track: Record<string, unknown>): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 2,
    tracks: [{ id: "p", name: "p", ...track }],
    notes: [],
  } as never);
}

// Organs are left out: a live organ note takes its wheel phase from the
// wall clock (f061-organ), so two renders differ by design.
const TRACKS: [string, Record<string, unknown>][] = [
  ...["grand", "upright", "felt", "honkytonk", "prepared"].map(
    (id) =>
      [id, { instrument: id, keys: {} }] as [string, Record<string, unknown>],
  ),
  ...["epiano", "wurli", "clav"].map(
    (id) =>
      [id, { instrument: id, keys: {} }] as [string, Record<string, unknown>],
  ),
  ["kethuk", { instrument: "modal", modal: { preset: "kethuk" } }],
  ["gong", { instrument: "modal", modal: { preset: "gong" } }],
  ["sitar", { instrument: "string", string: { preset: "sitar" } }],
  ["flute", { instrument: "wind", wind: { preset: "flute" } }],
  ["sing", { instrument: "sing", sing: {} }],
  [
    "grand reverb",
    { instrument: "grand", keys: {}, reverb: { mix: 0.3, size: 0.5 } },
  ],
];

describe("live note tails (q08)", () => {
  test("the release-sized render equals the full-window render", () => {
    for (const [name, track] of TRACKS) {
      const s = score(track);
      const fast = new LiveSynth(RATE);
      const full = new LiveSynth(RATE, { fastTail: false });
      for (const pitch of [33, 60, 88])
        for (const seconds of [0.08, 0.6]) {
          const request = {
            score: s,
            trackId: "p",
            pitch,
            velocity: 0.8,
            seconds,
          };
          const a = fast.render(request)!;
          const b = full.render(request)!;
          if (a.frames !== b.frames || !Bun.deepEquals(a.pcm, b.pcm))
            throw new Error(
              `${name} ${pitch} ${seconds}s: ${a.frames} vs ${b.frames} frames`,
            );
          expect(a.releaseSeconds).toBe(b.releaseSeconds);
        }
    }
  }, 30_000); // a sweep of full renders; CI runners take ~7 s

  // The budget the reviewer measured as 21 ms warm: a deterministic proxy
  // (rendered frames), not wall-clock time. A damped grand key at 48 kHz
  // renders under 2 s of audio instead of the 10 s window.
  test("a damped grand key renders a short buffer", () => {
    const s = score({ instrument: "grand", keys: {} });
    let rendered = 0;
    const spy = (frames: number) => (rendered = Math.max(rendered, frames));
    for (const pitch of [36, 60, 84]) {
      const note = new LiveSynth(RATE, { onRender: spy }).render({
        score: s,
        trackId: "p",
        pitch,
        velocity: 0.8,
        seconds: 0.25,
      })!;
      expect(note.frames).toBeGreaterThan(0);
    }
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(2 * RATE);
  });
});
