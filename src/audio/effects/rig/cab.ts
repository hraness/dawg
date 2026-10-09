/**
 * Speaker cabinets (`fx.cab`): a parametric speaker, box and microphone
 * model from cheap biquads (no impulse response, no setup cost). Ported
 * from the 0.6 guitar prototype; `8x10`, `1x15` and `di` are dawg
 * additions in the same model.
 */
import { Rbj, clamp } from "./filters.ts";

export const CAB_TYPES = [
  "1x12",
  "2x12",
  "4x12",
  "1x10",
  "open",
  "8x10",
  "1x15",
  "di",
] as const;
export type CabType = (typeof CAB_TYPES)[number];

type CabModel = Readonly<{
  hp: number;
  /** Low resonance: Hz, Q, dB. */
  low: readonly [number, number, number];
  peaks: readonly (readonly [number, number, number])[];
  /** Speaker roll-off (two biquads, Butterworth 4th order); 0 = none. */
  lp: number;
}>;

const CABS: Record<CabType, CabModel> = {
  "1x12": {
    hp: 75,
    low: [115, 1.4, 3],
    peaks: [
      [2100, 2, 3],
      [3600, 3, 2],
    ],
    lp: 5200,
  },
  "2x12": {
    hp: 70,
    low: [105, 1.3, 3.5],
    peaks: [
      [1200, 1.5, -2],
      [2800, 2.2, 4.5],
    ],
    lp: 6200,
  },
  "4x12": {
    hp: 65,
    low: [95, 1.2, 5],
    peaks: [
      [700, 1, -2.5],
      [2400, 2, 4],
      [3900, 3, 2],
    ],
    lp: 4700,
  },
  "1x10": { hp: 120, low: [160, 1.5, 2], peaks: [[1500, 1.5, 3]], lp: 4300 },
  open: { hp: 90, low: [120, 0.9, 1], peaks: [[2500, 1.2, 2]], lp: 7000 },
  // Bass cabinets: deep, rolled off early (10s brighter than a 15).
  "8x10": {
    hp: 45,
    low: [80, 1.0, 3],
    peaks: [
      [800, 1.2, -2],
      [2500, 2, 3],
    ],
    lp: 4500,
  },
  "1x15": {
    hp: 40,
    low: [70, 1.2, 4],
    peaks: [
      [1000, 1, -1.5],
      [2000, 1.5, 2],
    ],
    lp: 3500,
  },
  // Direct in: no speaker, only a subsonic high-pass.
  di: { hp: 20, low: [100, 0.7, 0], peaks: [], lp: 0 },
};

/** The cab's filter chain at `sr` for mic position `mic` (0..1). */
export function cabFilters(type: string, mic: number, sr: number): Rbj[] {
  const m = CABS[type as CabType] ?? CABS["2x12"];
  if (m.lp === 0) return [new Rbj("hpf", m.hp, 0.707, sr)];
  const edge = clamp(mic, 0, 1);
  return [
    new Rbj("hpf", m.hp, 0.707, sr),
    new Rbj("peak", m.low[0], m.low[1], sr, m.low[2]),
    ...m.peaks.map(
      ([f, q, db]) => new Rbj("peak", f, q, sr, db * (1 - 0.6 * edge)),
    ),
    new Rbj("highshelf", 3000, 0.7, sr, 2 - 8 * edge),
    new Rbj("lpf", m.lp * (1 - 0.3 * edge), 0.54, sr),
    new Rbj("lpf", m.lp * (1 - 0.3 * edge), 1.31, sr),
  ];
}
