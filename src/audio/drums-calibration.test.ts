import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { note, song, track } from "../../core/sdk/v1.ts";
import { blepSquare, metalKindForPitch, tomRatio } from "./kits.ts";
import { pcmChannels } from "./loudness.ts";
import { renderScorePcm } from "./wav.ts";

const RATE = 22_050;

type Hit = readonly [pitch: number, beat: number];

function render(
  hits: readonly Hit[],
  options: { calibration?: number; kit?: string; rate?: number } = {},
): Float64Array {
  const s = song({
    tempo: 120,
    bars: 2,
    ...(options.calibration ? { calibration: options.calibration } : {}),
    tracks: [
      track({
        name: "d",
        instrument: "kit",
        ...(options.kit ? { kit: options.kit } : {}),
        notes: hits.map(([pitch, beat]) => note(pitch, beat, 0.25, 0.8)),
      } as never),
    ],
  } as never);
  const audio = renderScorePcm(createScore(s as never), {
    sampleRate: options.rate ?? RATE,
  });
  return pcmChannels(audio.pcm)[0];
}

function energyDb(
  buffer: Float64Array,
  from: number,
  to: number,
  rate = RATE,
): number {
  let sum = 0;
  const a = Math.floor(from * rate);
  const b = Math.min(buffer.length, Math.floor(to * rate));
  for (let i = a; i < b; i += 1) sum += buffer[i]! ** 2;
  return 10 * Math.log10(sum / Math.max(1, b - a) + 1e-20);
}

/** Zero-crossing pitch estimate (Hz) of a window. */
function crossingsHz(
  buffer: Float64Array,
  from: number,
  to: number,
  rate = RATE,
): number {
  let count = 0;
  const a = Math.floor(from * rate);
  const b = Math.floor(to * rate);
  for (let i = a + 1; i < b; i += 1)
    if (buffer[i - 1]! < 0 && buffer[i]! >= 0) count += 1;
  return count / (to - from);
}

describe("calibrated hat choke", () => {
  for (const kit of [undefined, "syn808", "syn909"]) {
    test(`a closed hat chokes a ringing open hat (${kit ?? "default"})`, () => {
      const open = render([[46, 0]], {
        calibration: 1,
        ...(kit ? { kit } : {}),
      });
      const choked = render(
        [
          [46, 0],
          [42, 0.25],
        ],
        { calibration: 1, ...(kit ? { kit } : {}) },
      );
      // The reviewer measured -43.9 vs -43.8 dB from 0.2 to 0.6 s.
      expect(energyDb(open, 0.2, 0.6)).toBeGreaterThan(-60);
      expect(energyDb(choked, 0.2, 0.6)).toBeLessThan(
        energyDb(open, 0.2, 0.6) - 15,
      );
    });
  }

  test("a pedal hat chokes too; a later kick does not", () => {
    const open = energyDb(render([[46, 0]], { calibration: 1 }), 0.2, 0.6);
    const pedal = render(
      [
        [46, 0],
        [44, 0.25],
      ],
      { calibration: 1 },
    );
    expect(energyDb(pedal, 0.2, 0.6)).toBeLessThan(open - 15);
    const kick = render(
      [
        [46, 0],
        [36, 1],
      ],
      { calibration: 1 },
    );
    expect(energyDb(kick, 0.2, 0.45)).toBeCloseTo(
      energyDb(render([[46, 0]], { calibration: 1 }), 0.2, 0.45),
      3,
    );
  });

  test("legacy songs keep the open hat ringing (byte-identical)", () => {
    const plain = render([[46, 0]]);
    const legacy = render([
      [46, 0],
      [42, 0.25],
    ]);
    expect(energyDb(legacy, 0.2, 0.6)).toBeCloseTo(
      energyDb(plain, 0.2, 0.6),
      0,
    );
  });
});

describe("calibrated toms", () => {
  test("GM toms 41..50 rise in pitch instead of folding onto one", () => {
    const toms = [41, 43, 45, 47, 48, 50];
    for (const kit of [undefined, "syn808"]) {
      const hz = toms.map((pitch) =>
        crossingsHz(
          render([[pitch, 0]], { calibration: 1, ...(kit ? { kit } : {}) }),
          0.1,
          0.3,
        ),
      );
      for (let i = 1; i < hz.length; i += 1)
        expect(hz[i]!).toBeGreaterThan(hz[i - 1]! * 1.02);
    }
  });

  test("legacy toms stay folded", () => {
    const a = render([[41, 0]]);
    const b = render([[50, 0]]);
    expect(crossingsHz(a, 0.1, 0.3)).toBe(crossingsHz(b, 0.1, 0.3));
  });

  test("tomRatio is monotone and centred on 45", () => {
    expect(tomRatio(45)).toBe(1);
    for (let p = 36; p < 55; p += 1)
      expect(tomRatio(p + 1)).toBeGreaterThan(tomRatio(p));
  });
});

describe("calibrated cymbals and cowbell", () => {
  test("49, 51, 56 and 57 resolve to metal, others do not", () => {
    expect(metalKindForPitch(49)).toBe("crash");
    expect(metalKindForPitch(57)).toBe("crash");
    expect(metalKindForPitch(51)).toBe("ride");
    expect(metalKindForPitch(56)).toBe("cowbell");
    expect(metalKindForPitch(37)).toBeUndefined();
    expect(metalKindForPitch(46)).toBeUndefined();
  });

  test("a crash rings for a second instead of a rim click", () => {
    const rim = render([[37, 0]], { calibration: 1 });
    const crash = render([[49, 0]], { calibration: 1 });
    const legacy = render([[49, 0]]);
    // Rim decays in tens of ms; the legacy 49 is that rim click.
    expect(energyDb(legacy, 0.3, 0.6)).toBeLessThan(-80);
    expect(energyDb(crash, 0.3, 0.6)).toBeGreaterThan(-50);
    expect(energyDb(crash, 0.8, 1.2)).toBeGreaterThan(-65);
    expect(energyDb(rim, 0.3, 0.6)).toBeLessThan(-80);
  });

  test("ride and cowbell differ from the crash and from each other", () => {
    const crash = render([[49, 0]], { calibration: 1 });
    const ride = render([[51, 0]], { calibration: 1 });
    const bell = render([[56, 0]], { calibration: 1 });
    const fp = (b: Float64Array) =>
      [energyDb(b, 0, 0.05), energyDb(b, 0.3, 0.6)].map(Math.round).join();
    expect(new Set([fp(crash), fp(ride), fp(bell)]).size).toBe(3);
    expect(Math.abs(crossingsHz(bell, 0.005, 0.05) - 540)).toBeLessThan(250);
  });

  test("metal never clips at full velocity", () => {
    for (const pitch of [49, 51, 56, 57]) {
      const b = render([[pitch, 0]], { calibration: 1 });
      expect(Math.max(...b.map(Math.abs))).toBeLessThan(0.5);
    }
  });
});

describe("band-limited hat metal", () => {
  /** Share of energy (0..1) away from the square's own harmonics. */
  function aliasShare(make: (t: number) => number, hz: number): number {
    const n = 8192;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i += 1)
      x[i] = make(i / RATE) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
    let harmonic = 0;
    let total = 0;
    for (let k = 1; k < n / 2; k += 4) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < n; i += 1) {
        const w = (2 * Math.PI * k * i) / n;
        re += x[i]! * Math.cos(w);
        im -= x[i]! * Math.sin(w);
      }
      const power = re * re + im * im;
      total += power;
      const f = (k * RATE) / n;
      const order = f / hz;
      if (Math.abs(order - Math.round(order)) * hz < 12) harmonic += power;
    }
    return 1 - harmonic / total;
  }

  test("polyBLEP squares carry far less alias energy than naive ones", () => {
    const hz = 800;
    const naive = aliasShare((t) => ((t * hz) % 1 < 0.5 ? 1 : -1), hz);
    const blep = aliasShare((t) => blepSquare(hz, t, RATE), hz);
    expect(blep).toBeLessThan(naive / 3);
  });

  test("a calibrated 808 hat differs from the naive one only in its top", () => {
    const naive = render([[42, 0]], { kit: "syn808" });
    const blep = render([[42, 0]], { calibration: 1, kit: "syn808" });
    expect(blep).not.toEqual(naive);
    expect(
      Math.abs(energyDb(blep, 0, 0.1) - energyDb(naive, 0, 0.1)),
    ).toBeLessThan(3);
  });
});
