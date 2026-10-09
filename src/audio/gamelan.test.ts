/**
 * Gamelan presets and paired ombak (0.6.1, lane f061-gamelan-winds):
 * the pengisep/pengumbang pair beats at `ombak` Hz, slendro notes land on
 * the tuning table, gong-family rings follow the preset T60, and the new
 * presets keep the modal print round trip.
 */
import { describe, expect, test } from "bun:test";
import {
  GAMELAN_PRESETS,
  MODAL_PRESETS,
  MODAL_PRESET_NAMES,
  modalPairWarnings,
  modalSettings,
  normalizeModal,
  RESONATOR_TABLE_VERSION,
} from "../../core/resonators.ts";
import { createScore, type TrackScore } from "../../core/score.ts";
import { noteHz, resolveTuning } from "../../core/tuning.ts";
import { printTrack } from "../../core/sdk/print.ts";
import {
  modal,
  song as sdkSong,
  track as sdkTrack,
} from "../../core/sdk/v1.ts";
import { applyModalCommand, parseModalCommand } from "../commands/modal.ts";
import { ModalBank } from "./dsp/modal.ts";
import { renderScorePcm } from "./wav.ts";

const SR = 22_050;

function score(
  tracks: readonly Record<string, unknown>[],
  notes: readonly Record<string, unknown>[],
  extra: Record<string, unknown> = {},
): TrackScore {
  return createScore({
    tempoBpm: 60,
    bars: 2,
    ...extra,
    tracks,
    notes: notes.map((n, i) => ({
      id: `n${i}`,
      startTick: 0,
      durationTicks: 1920,
      pitch: 69,
      velocity: 0.8,
      ...n,
    })),
  } as never);
}

function mono(s: TrackScore): Float64Array {
  const { pcm } = renderScorePcm(s, { sampleRate: SR });
  const out = new Float64Array(pcm.length / 2);
  for (let i = 0; i < out.length; i += 1)
    out[i] = (pcm[2 * i]! + pcm[2 * i + 1]!) / 65536;
  return out;
}

/** Envelope-FFT beat rate between lo and hi Hz after removing the decay. */
function beatHz(x: Float64Array, lo: number, hi: number, from = 0.1): number {
  const hop = 64;
  const frames = Math.floor(x.length / hop);
  const log: number[] = [];
  for (let f = Math.round((from * SR) / hop); f < frames; f += 1) {
    let sum = 0;
    for (let i = f * hop; i < (f + 1) * hop; i += 1) sum += x[i]! ** 2;
    log.push(Math.log(Math.sqrt(sum / hop) + 1e-12));
  }
  const n = log.length;
  const mean = log.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (i - n / 2) * (log[i]! - mean);
    sxx += (i - n / 2) ** 2;
  }
  const slope = sxy / sxx;
  const flat = log.map((v, i) => v - mean - slope * (i - n / 2));
  const fr = SR / hop;
  let best = -1;
  let hz = lo;
  for (let f = lo; f <= hi; f += 0.01) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * f) / fr;
    for (let i = 0; i < n; i += 1) {
      const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      re += flat[i]! * win * Math.cos(w * i);
      im -= flat[i]! * win * Math.sin(w * i);
    }
    const p = re * re + im * im;
    if (p > best) {
      best = p;
      hz = f;
    }
  }
  return hz;
}

/** Peak frequency near `guess` (Goertzel scan with parabolic refinement). */
function peakHz(x: Float64Array, guess: number, span = 0.03): number {
  const power = (f: number) => {
    const w = (2 * Math.PI * f) / SR;
    let re = 0;
    let im = 0;
    const n = x.length;
    for (let i = 0; i < n; i += 1) {
      const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      re += x[i]! * win * Math.cos(w * i);
      im -= x[i]! * win * Math.sin(w * i);
    }
    return re * re + im * im;
  };
  let best = guess;
  let bestP = -1;
  for (let k = -60; k <= 60; k += 1) {
    const f = guess * (1 + (span * k) / 60);
    const p = power(f);
    if (p > bestP) {
      bestP = p;
      best = f;
    }
  }
  let step = (guess * span) / 60;
  for (let round = 0; round < 30; round += 1) {
    const a = power(best - step);
    const b = power(best + step);
    if (a > bestP) {
      best -= step;
      bestP = a;
    } else if (b > bestP) {
      best += step;
      bestP = b;
    } else step /= 2;
  }
  return best;
}

const cents = (hz: number, target: number) => 1200 * Math.log2(hz / target);

describe("gamelan presets (lane A2)", () => {
  test("15 presets appended after the 12 core ones; table version 2", () => {
    expect(MODAL_PRESET_NAMES.slice(0, 12)).toEqual([
      "marimba",
      "vibes",
      "xylophone",
      "glock",
      "celesta",
      "chimes",
      "kalimba",
      "mbira",
      "steelpan",
      "bowl",
      "gong",
      "timpani",
    ]);
    expect(MODAL_PRESET_NAMES.slice(12)).toEqual([
      "crotales",
      "musicbox",
      "toypiano",
      "saron",
      "demung",
      "slenthem",
      "gangsa",
      "gender",
      "bonang",
      "kenong",
      "kethuk",
      "kempul",
      "daf",
      "bodhran",
      "tabla",
    ]);
    expect(RESONATOR_TABLE_VERSION).toBe(2);
    for (const name of GAMELAN_PRESETS)
      expect(MODAL_PRESET_NAMES).toContain(name);
  });

  test("gangsa pair: pengisep against pengumbang beats at ombak 6 ± 0.3 Hz", () => {
    let s = score(
      [
        { id: "umbang", name: "umbang", instrument: "modal" },
        { id: "isep", name: "isep", instrument: "modal" },
      ],
      [
        { trackId: "umbang", pitch: 69 },
        { trackId: "isep", pitch: 69 },
      ],
    );
    for (const [id, line] of [
      ["umbang", "modal gangsa"],
      ["isep", "modal gangsa"],
      ["isep", "modal ombak 6"],
      ["isep", "modal pair umbang"],
    ] as const) {
      const result = applyModalCommand(s, id, parseModalCommand(line)!);
      expect(result.ok).toBe(true);
      s = result.next!;
    }
    // The partner plays straight; the pair carries the beat.
    expect(s.tracks[0]!.modal).toEqual({ preset: "gangsa", ombak: 0 });
    expect(s.tracks[1]!.modal).toEqual({
      preset: "gangsa",
      ombak: 6,
      pair: "umbang",
    });
    expect(Math.abs(beatHz(mono(s), 3, 12) - 6)).toBeLessThan(0.3);
    // Each voice alone does not beat at 6 Hz: one voice per track.
    const umbang = mono(
      createScore({
        ...s,
        notes: s.notes.filter((n) => n.trackId === "umbang"),
      } as never),
    );
    const isep = mono(
      createScore({
        ...s,
        notes: s.notes.filter((n) => n.trackId === "isep"),
      } as never),
    );
    const a = peakHz(umbang.subarray(Math.round(0.05 * SR)), 440, 0.03);
    const b = peakHz(isep.subarray(Math.round(0.05 * SR)), 446, 0.03);
    expect(Math.abs(a - 440)).toBeLessThan(0.3);
    expect(Math.abs(b - 446)).toBeLessThan(0.3);
  });

  test("saron, demung, gangsa and bonang damp at the next note (tutupan)", () => {
    const rms = (x: Float64Array, from: number, to: number) => {
      let sum = 0;
      for (let i = Math.round(from * SR); i < Math.round(to * SR); i += 1)
        sum += x[i]! ** 2;
      return Math.sqrt(sum / ((to - from) * SR));
    };
    for (const preset of ["saron", "demung", "gangsa", "bonang"]) {
      // A balungan step of one beat (1 s at 60 bpm): the key lifts where the
      // next note lands; that note is moved later to keep the window clean.
      const s = score(
        [{ id: "a", name: "a", instrument: "modal", modal: { preset } }],
        [
          { trackId: "a", pitch: 67, durationTicks: 480 },
          { trackId: "a", pitch: 67, startTick: 480 * 4, durationTicks: 480 },
        ],
      );
      const x = mono(s);
      const before = rms(x, 0.85, 0.95);
      const after = rms(x, 1.15, 1.25);
      expect([preset, 20 * Math.log10(after / before) <= -20]).toEqual([
        preset,
        true,
      ]);
    }
  });

  test("an unpaired gangsa keeps its twin bank (centre on pitch)", () => {
    const settings = modalSettings(normalizeModal({ preset: "gangsa" }));
    expect(settings.ombak).toBeGreaterThan(0);
  });

  test("`modal ombak N` and `modal pair` on a non-modal track write gangsa", () => {
    const s = score(
      [
        { id: "a", name: "a", instrument: "piano" },
        { id: "b", name: "b", instrument: "lead" },
      ],
      [],
    );
    const result = applyModalCommand(
      s,
      "a",
      parseModalCommand("modal ombak 6")!,
    );
    expect(result.next!.tracks[0]!.instrument).toBe("modal");
    expect(result.next!.tracks[0]!.modal).toEqual({
      preset: "gangsa",
      ombak: 6,
    });
    // pair needs a modal partner.
    const bad = applyModalCommand(s, "a", parseModalCommand("modal pair b")!);
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain("not a modal track");
    const self = applyModalCommand(s, "a", parseModalCommand("modal pair a")!);
    expect(self.ok).toBe(false);
  });

  test("`modal gamelan` is a hint, not a preset", () => {
    const command = parseModalCommand("modal gamelan")!;
    expect(command.type).toBe("modal-hint");
    const result = applyModalCommand(score([], []), "x", command);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("gangsa");
    expect(result.next).toBeUndefined();
  });

  test("slendro: a saron fundamental within 1 cent of the tuning table", () => {
    const tuning = { name: "slendro" };
    const table = resolveTuning(tuning, undefined)!;
    for (const pitch of [60, 62, 64, 67, 69]) {
      const s = score(
        [
          {
            id: "s",
            name: "s",
            instrument: "modal",
            modal: { preset: "saron" },
          },
        ],
        [{ trackId: "s", pitch, durationTicks: 480 }],
        { tuning },
      );
      const target = noteHz(pitch, undefined, table);
      const x = mono(s).subarray(Math.round(0.02 * SR), Math.round(0.5 * SR));
      expect(Math.abs(cents(peakHz(x, target, 0.01), target))).toBeLessThan(1);
    }
  });

  test("gong family T60 within 10% of the decay law", () => {
    for (const name of ["kempul", "gong", "kenong"] as const) {
      const settings = modalSettings(
        normalizeModal({ preset: name, ombak: 0 }),
      );
      const hz = 261.63;
      const seconds = Math.max(4, Math.min(8, settings.ring));
      const voice = new ModalBank(
        { ...settings, ombak: 0 },
        { hz, velocity: 0.8, start: 0, duration: seconds, seed: "t" },
        SR,
        30,
      );
      const x = new Float64Array(Math.round(seconds * SR));
      voice.process(x, 0, x.length);
      // Energy over 1 s windows, which average the split-mode beating; by
      // then the fundamental (the slowest mode) dominates.
      const level = (t: number) => {
        let sum = 0;
        for (let i = Math.round(t * SR); i < Math.round((t + 1) * SR); i += 1)
          sum += x[i]! ** 2;
        return 10 * Math.log10(sum + 1e-30);
      };
      const t1 = 1;
      const t2 = seconds - 1.05;
      const t60 = (-60 * (t2 - t1)) / (level(t2) - level(t1));
      const expected = settings.ring;
      expect(Math.abs(t60 / expected - 1)).toBeLessThan(0.1);
    }
  });

  test("print round trip: preset words, overrides and pair", () => {
    const s = score(
      [
        { id: "a", name: "a", instrument: "modal", modal: { preset: "saron" } },
        {
          id: "b",
          name: "b",
          instrument: "modal",
          modal: { preset: "gangsa", ombak: 6, pair: "a" },
        },
      ],
      [],
    );
    expect(printTrack(s, s.tracks[0]!)).toContain('instrument: "saron",');
    const printed = printTrack(s, s.tracks[1]!);
    expect(printed).toContain('modal("gangsa", { ombak: 6, pair: "a" })');
    // The SDK stores what the printer wrote.
    const back = sdkSong({
      tempo: 60,
      bars: 1,
      tracks: [
        sdkTrack({ name: "a", instrument: "saron", notes: [] }),
        sdkTrack({
          name: "b",
          instrument: modal("gangsa", { ombak: 6, pair: "a" }),
          notes: [],
        }),
      ],
    });
    expect(back.tracks.map((t) => [t.instrument, t.modal])).toEqual([
      ["modal", { preset: "saron" }],
      ["modal", { preset: "gangsa", ombak: 6, pair: "a" }],
    ]);
    expect(() => createScore(back as never)).not.toThrow();
  });

  test("SDK pair: a gangsa partner plays straight; check warns on a bad pair", () => {
    const back = sdkSong({
      tempo: 60,
      bars: 1,
      tracks: [
        sdkTrack({ name: "a", instrument: modal("gangsa"), notes: [] }),
        sdkTrack({
          name: "b",
          instrument: modal("gangsa", { ombak: 6, pair: "a" }),
          notes: [],
        }),
        sdkTrack({
          name: "c",
          instrument: modal("gangsa", { pair: "zz" }),
          notes: [],
        }),
      ],
    });
    expect(back.tracks[0]!.modal).toEqual({ preset: "gangsa", ombak: 0 });
    expect(modalPairWarnings(back.tracks as never)).toEqual([
      'track c: modal pair "zz" names no track; it plays ombak Hz sharp alone',
    ]);
    // Round trip: the printed partner keeps ombak 0.
    const s = createScore(back as never);
    expect(printTrack(s, s.tracks[0]!)).toContain("ombak: 0");
    // MODAL_TWIN_PRESETS in the SDK lists exactly the presets with an ombak.
    const twins = Object.keys(MODAL_PRESETS).filter(
      (name) =>
        MODAL_PRESETS[name as keyof typeof MODAL_PRESETS].settings.ombak > 0,
    );
    expect(twins).toEqual(["gangsa"]);
  });

  test("each new preset has a range, doc and styles", () => {
    for (const name of MODAL_PRESET_NAMES.slice(12)) {
      const p = MODAL_PRESETS[name];
      expect(p.range[0]).toBeLessThan(p.range[1]);
      expect(p.doc.length).toBeGreaterThan(5);
      expect(p.styles.length).toBeGreaterThan(2);
    }
  });
});
