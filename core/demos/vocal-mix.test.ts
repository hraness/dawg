import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { DEMOS, createDemo } from "./index.ts";
import { normalizeMaster } from "../master.ts";
import { applyMasterPcm, applyMonitorMaster } from "../../src/audio/master.ts";
import {
  BED_POCKET,
  CHORUS_RIDE,
  foregroundVocalTracks,
  vocalMonitorGain,
  VOCAL_DUCK_DEPTH,
  VOCAL_OUTPUT_HEADROOM,
  WORD_DELAY_MIX,
  WORD_REVERB_MIX,
  WORD_THROW_PEAK,
} from "./vocal-mix.ts";

const musicalBaseline: Readonly<Record<string, string>> = {
  "candy-fault":
    "494cace369a7b6a1f7b81e1d3af449b8485d5fa946efee0becf08fb12c44f4a5",
  redline: "d3b29d13564cf4409e3fc5ab937cfb53d895a287f8227103e0a21940006ab87b",
  "glass-garden":
    "8739af97a90677fba27eb6a981d010e9559b35588342eb0d1c10632e692e749a",
  "night-swim":
    "aa19cbd9be922e74c7e2d7a3116c226adb87756c2ac69192b9a165b4a1b413be",
  "kite-season":
    "c0bdd90e8bd84972833b6dd7259013fd0ce4c335a6a55712c4aaaf775a00f1fe",
  "bubble-wrap":
    "c94d1a7fa835a9b1c1eeb6d9c704855cf9e0ea6663ab37628047343ee0a3b4d8",
  "glow-stick":
    "89d620f23fb283c3256c73c13acd2adf0d00ec887fdf46e0168aabe73982ee8c",
  "window-seat":
    "7ccecdbe5c7917e1b000a571a2ba4d45a87ed92a48f8896d763bbe52e2f123b0",
  "light-one":
    "370cf48ba74894568c54d692fb766e6e1286edf4723abca2c34bdb197dd89697",
};
const mixFields = new Set([
  "volume",
  "volumeAutomation",
  "pan",
  "panAutomation",
  "fx",
  "fxAutomation",
  "filter",
  "filterAutomation",
  "delay",
  "delayMixAutomation",
  "reverb",
]);
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, field]) => field !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, field]) => [key, canonical(field)]),
    );
  return value;
}

test("vocal foreground preserves every authored note, form, tuning, loop and pinned source", () => {
  expect(DEMOS.map((demo) => demo.id).sort()).toEqual(
    Object.keys(musicalBaseline).sort(),
  );
  for (const demo of DEMOS) {
    const json = createDemo(demo.id).toJSON();
    // The allowed common-master changes are the output margin and fixed monitor drive.
    const master = json.master
      ? {
          ...json.master,
          limiter: { ...json.master.limiter, ceiling: -1, gain: 0 },
        }
      : json.master;
    const invariant = {
      ...json,
      master,
      tracks: json.tracks!.map((track) =>
        Object.fromEntries(
          Object.entries(track).filter(([key]) => !mixFields.has(key)),
        ),
      ),
    };
    expect(
      createHash("sha256")
        .update(JSON.stringify(canonical(invariant)))
        .digest("hex"),
      demo.id,
    ).toBe(musicalBaseline[demo.id]!);
  }
});

test("words lead the backing through clean, dry gain stages with pre-window headroom", () => {
  for (const demo of DEMOS) {
    const score = createDemo(demo.id),
      lead = score.tracks.find(
        (track) => track.id === (demo.id === "candy-fault" ? "vocal" : "vox"),
      )!;
    const gain = Number(lead.fx?.postgain?.gain);
    expect(gain, demo.id).toBeGreaterThan(0);
    // Balance is measured against the backing as heard, not by gain order:
    // a light duck, a presence pocket in pitched parts and a chorus ride.
    expect(lead.fx?.duck?.depth, demo.id).toBe(VOCAL_DUCK_DEPTH);
    const ride = lead.fxAutomation?.["postgain-gain"] ?? [];
    expect(ride[0]?.value, demo.id).toBe(gain);
    expect(Math.max(...ride.map((point) => point.value)), demo.id).toBeCloseTo(
      gain * CHORUS_RIDE,
      9,
    );
    const pocketed = score.tracks.filter(
      (track) => track.fx?.eq?.mid === BED_POCKET.mid,
    );
    expect(pocketed.length, demo.id).toBeGreaterThan(0);
    expect(pocketed.map((track) => track.id)).not.toContain(lead.id);
    expect(lead.fx?.crush).toBeUndefined();
    expect(Number(lead.reverb?.mix ?? 0)).toBeLessThanOrEqual(WORD_REVERB_MIX);
    expect(Number(lead.delay?.mix ?? 0)).toBeLessThanOrEqual(WORD_DELAY_MIX);
    expect(
      Math.max(...(lead.delayMixAutomation ?? []).map((point) => point.value)),
    ).toBeLessThanOrEqual(WORD_THROW_PEAK);
    expect(score.master?.target).toBe(-14);
    expect(score.master?.limiter?.ceiling).toBe(-1.1);
    expect(score.master?.limiter?.gain).toBe(
      20 * Math.log10(1 / VOCAL_OUTPUT_HEADROOM),
    );
  }
});

test("normalized local stock keeps preview gain while its backing stays behind the words", () => {
  const tracks = foregroundVocalTracks(
    [
      {
        id: "bvox",
        sampler: {
          mode: "oneshot",
          voices: { line: { src: "tracks/vocals/samples/stock/take.wav" } },
        },
      },
      { id: "pad" },
      { id: "harm" },
    ],
    "new-original",
  );
  expect(tracks[0]?.fx?.postgain?.gain).toBe(1.1);
  expect(tracks[1]?.fx?.postgain?.gain).toBe(0.8);
  expect(tracks[2]?.fx?.postgain?.gain).toBe(0.48);
});

test("fixed vocal monitoring restores headroom without changing target-mastered export", () => {
  const tracks = [
    {
      id: "vox",
      sampler: {
        mode: "oneshot" as const,
        voices: { line: { src: "pack:studio/redline-vox" } },
      },
    },
  ];
  const drive = vocalMonitorGain(tracks);
  expect(drive).toBeCloseTo(12.0412, 4);
  expect(
    vocalMonitorGain([
      {
        id: "bvox",
        sampler: {
          mode: "oneshot",
          voices: { line: { src: "tracks/vocals/take.wav" } },
        },
      },
    ]),
  ).toBe(0);
  expect(vocalMonitorGain([{ id: "pad" }])).toBe(0);
  const rate = 8000;
  const pcm = Int16Array.from({ length: rate * 4 }, (_, index) =>
    Math.round(Math.sin(index * 0.17) * 1500),
  );
  const before = normalizeMaster({
    target: -14,
    limiter: { ceiling: -1.1, gain: 0 },
  })!;
  const after = normalizeMaster({
    target: -14,
    limiter: { ceiling: -1.1, gain: drive },
  })!;
  const original = applyMasterPcm(pcm, rate * 2, rate, before, false)!;
  const compensated = applyMasterPcm(pcm, rate * 2, rate, after, false)!;
  expect(compensated.left).toEqual(original.left);
  expect(compensated.right).toEqual(original.right);
  expect(compensated.report).toEqual(original.report);
  const oldMonitor = applyMonitorMaster(pcm, rate, before);
  const newMonitor = applyMonitorMaster(pcm, rate, after);
  const power = (values: Int16Array) =>
    values.reduce((sum, value) => sum + value ** 2, 0);
  expect(Math.sqrt(power(newMonitor) / power(oldMonitor))).toBeCloseTo(4, 2);
});

test("the lead rides up over choruses and drops, staying up across adjacent ones", () => {
  const bar = 1920;
  const [lead] = foregroundVocalTracks(
    [
      {
        id: "vox",
        sampler: {
          mode: "oneshot",
          voices: { line: { src: "pack:studio/redline-vox" } },
        },
      },
      { id: "pad" },
    ],
    "new-original",
    [
      { name: "Verse 1", startBar: 0, bars: 8 },
      { name: "Chorus 1", startBar: 8, bars: 8 },
      { name: "Drop 1", startBar: 16, bars: 8 },
      { name: "Verse 2", startBar: 24, bars: 8 },
      { name: "Last chorus", startBar: 32, bars: 8 },
    ],
    bar,
  );
  const base = Number(lead!.fx?.postgain?.gain);
  const up = base * CHORUS_RIDE;
  expect(lead!.fxAutomation?.["postgain-gain"]).toEqual([
    { tick: 0, value: base },
    { tick: 8 * bar - bar / 4, value: base },
    { tick: 8 * bar, value: up },
    { tick: 24 * bar, value: up },
    { tick: 24 * bar + bar / 4, value: base },
    { tick: 32 * bar - bar / 4, value: base },
    { tick: 32 * bar, value: up },
    { tick: 40 * bar, value: up },
    { tick: 40 * bar + bar / 4, value: base },
  ]);
});
