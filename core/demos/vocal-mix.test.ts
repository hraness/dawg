import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { DEMOS, createDemo } from "./index.ts";
import { normalizeMaster } from "../master.ts";
import { applyMasterPcm, applyMonitorMaster } from "../../src/audio/master.ts";
import {
  foregroundVocalTracks,
  vocalMonitorGain,
  VOCAL_OUTPUT_HEADROOM,
  WORD_DELAY_MIX,
  WORD_REVERB_MIX,
  WORD_THROW_PEAK,
} from "./vocal-mix.ts";

const musicalBaseline: Readonly<Record<string, string>> = {
  "candy-fault":
    "adf8de9c3c91d299a27d2df43fb1ace7dd74be88ba4b3d9af0b2ac2dc21620ee",
  redline: "0c604e35acb0e4ad38f8cb03f80d9bcb3f3c2c6bd5d7fd13b9457b6182b49cb8",
  "glass-garden":
    "4f65659505cdd6392dbe930f92e90a7011bef2509186a06a742442be9855ada8",
  "night-swim":
    "50e91e843ae8fcaed31aff001417a6294700ae4cc26f6c652f62f0756d1c808a",
  "kite-season":
    "17328d0aaa85c7124d7d417c6786cc9b8b90987c3c7373905a4fbcc50f94a6f4",
  "bubble-wrap":
    "805bd60f5241c6dece041908a91544eb9054e68e044727f76bb63dac1cc29ceb",
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
    for (const track of score.tracks.filter((track) => track.id !== lead.id))
      expect(
        Number(track.fx?.postgain?.gain),
        demo.id + ":" + track.id,
      ).toBeLessThan(gain);
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
