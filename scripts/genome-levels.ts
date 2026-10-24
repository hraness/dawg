#!/usr/bin/env bun
/**
 * Measures every sound in the hyperpop genome's palette playing its role's
 * standard part (held chords for a pad, offbeat stabs, a 16th arp, an 8th
 * lead or bass line) at the current engine calibration, and prints how far
 * each sits from its role's target: the mean loudness of the role's
 * hand-built demo voices. Fugue voices answer to the lead's target. `--write`
 * rewrites core/distill/hyperpop/genome/levels.ts with the trims.
 *
 *   bun scripts/genome-levels.ts            # report
 *   bun scripts/genome-levels.ts --write    # rewrite the trims
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CALIBRATION_LATEST,
  scoreFromJSON,
  type TrackInput,
} from "../core/score.ts";
import { KITS } from "../core/distill/hyperpop/genome/genome.ts";
import {
  ARP,
  BAROQUE,
  BASS,
  drumTracks,
  LEAD,
  PAD,
  STAB,
} from "../core/distill/hyperpop/genome/sounds.ts";
import { renderArrangedPcm } from "../src/audio/arrange.ts";
import { measureLoudness, pcmChannels } from "../src/audio/loudness.ts";
import { PackStore } from "../src/audio/packs.ts";
import { SampleLibrary } from "../src/audio/samples.ts";

const write = process.argv.includes("--write");
const root = join(import.meta.dir, "..");
const temp = mkdtempSync(join(tmpdir(), "dawg-genome-levels-"));
const library = new SampleLibrary({
  projectRoot: root,
  cacheDir: join(temp, "assets"),
  packs: new PackStore({
    dir: join(temp, "packs"),
    offline: true,
    fetch: async () => {
      throw new Error("offline");
    },
  }),
});

const design = {
  brightness: 0.5,
  grit: 0.5,
  space: 0.5,
  width: 0.5,
  echo: 0.5,
};
const TPB = 480;
const BPM = 160;
const RATE = 22050;
/** beat, length, pitch, velocity */
type Note = readonly [number, number, number, number];
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const PARTS: Readonly<Record<string, readonly Note[]>> = {
  bass: range(32).map((i) => [i / 2, 0.45, 40, 0.75]),
  lead: range(32).map((i) => [i / 2, 0.45, [72, 74, 76, 79][i % 4]!, 0.7]),
  pad: range(4).flatMap((b) =>
    [57, 60, 64, 67].map((p): Note => [b * 4, 4, p, 0.35]),
  ),
  stab: range(16).flatMap((i) =>
    [64, 67, 72].map((p): Note => [i + 0.5, 0.25, p, 0.6]),
  ),
  arp: range(64).map((i) => [i / 4, 0.25, [69, 72, 76, 79][i % 4]!, 0.35]),
};
PARTS.baroque = PARTS.lead!;

type Make = (typeof PAD)[string];
const ROLES: readonly [string, Readonly<Record<string, Make>>][] = [
  ["bass", BASS],
  ["lead", LEAD],
  ["pad", PAD],
  ["stab", STAB],
  ["arp", ARP],
  ["baroque", BAROQUE],
];

async function loudness(
  track: TrackInput,
  part: readonly Note[],
): Promise<number> {
  const score = scoreFromJSON({
    version: 1,
    calibration: CALIBRATION_LATEST,
    tempoBpm: BPM,
    beatsPerBar: 4,
    bars: 5,
    ticksPerBeat: TPB,
    key: "C",
    tracks: [track],
    notes: part.map(([beat, len, pitch, velocity], i) => ({
      id: `n${i}`,
      trackId: track.id,
      startTick: Math.round(beat * TPB),
      durationTicks: Math.round(len * TPB),
      pitch,
      velocity,
    })),
  });
  const samples = await library.load(score);
  const audio = renderArrangedPcm(score, { samples, sampleRate: RATE });
  const [left, right] = pcmChannels(audio.pcm as Int16Array);
  const frames = Math.round((RATE * 60 * 16) / BPM);
  return measureLoudness(left.slice(0, frames), right.slice(0, frames), RATE, {
    truePeak: false,
  }).integrated;
}

const measured: Record<string, Record<string, number>> = {};
const handBuilt: Record<string, number[]> = {};
for (const [role, table] of ROLES) {
  measured[role] = {};
  handBuilt[role] = [];
  for (const [key, make] of Object.entries(table)) {
    const lufs = await loudness(
      { ...make("t", "T", 0.3, design), id: "t" },
      PARTS[role]!,
    );
    measured[role]![key] = lufs;
    if (make("t", "T", 1, design).instrument !== "patch")
      handBuilt[role]!.push(lufs);
  }
}
const mean = (xs: readonly number[]) =>
  xs.reduce((a, b) => a + b, 0) / xs.length;
const target = (role: string) =>
  mean(handBuilt[role === "baroque" ? "lead" : role]!);

const trims: Record<string, Record<string, number>> = {};
for (const [role] of ROLES) {
  trims[role] = {};
  const goal = target(role);
  console.log(`${role} target ${goal.toFixed(1)} LUFS`);
  for (const [key, lufs] of Object.entries(measured[role]!)) {
    const db = Math.max(-30, Math.min(12, goal - lufs));
    trims[role]![key] = Math.round(10 ** (db / 20) * 1000) / 1000;
    console.log(
      `  ${key.padEnd(11)} ${lufs.toFixed(1).padStart(6)}  ${db >= 0 ? "+" : ""}${db.toFixed(1)} dB`,
    );
  }
}

// Drums: every kit's kick, snare and hats at Redline's balance on the 909
// kit (snare a touch under it, since the genome's grooves are busier).
const DRUM_PARTS: Readonly<Record<string, readonly Note[]>> = {
  kick: range(16).map((i) => [i, 0.25, 36, 0.9]),
  snare: range(8).map((i) => [i * 2 + 1, 0.25, 38, 0.85]),
  hats: range(32).map((i) => [i / 2, 0.25, 42, 0.5]),
};
const drumLoudness = async (kit: string) => {
  const tracks = drumTracks(BPM, { kick: kit, snare: kit, hats: kit }, design);
  const out: Record<string, number> = {};
  for (const [id, part] of Object.entries(DRUM_PARTS))
    out[id] = await loudness(
      tracks.find((t) => t.id === id)!,
      part,
    );
  return out;
};
const ref = await drumLoudness("syn909");
const genome = Object.fromEntries(
  drumTracks(BPM, { kick: "syn909", snare: "syn909", hats: "syn909" }, design)
    .filter((t) => t.id in DRUM_PARTS)
    .map((t) => [t.id, t.volume ?? 1]),
);
const db = (x: number) => 20 * Math.log10(x);
// Redline's kit levels: kick 0.5, snare 0.54, hats 0.13.
const drumGoal: Record<string, number> = {
  kick: ref.kick!,
  snare: ref.snare! + db(0.54 / 0.5 / (genome.snare! / genome.kick!)) - 2,
  hats: ref.hats! + db(0.13 / 0.5 / (genome.hats! / genome.kick!)),
};
const drumTrims: Record<string, Record<string, number>> = {
  kick: {},
  snare: {},
  hats: {},
};
for (const kit of KITS) {
  const m = await drumLoudness(kit);
  const row = [kit.padEnd(9)];
  for (const id of Object.keys(DRUM_PARTS)) {
    const gain = Math.max(-18, Math.min(16, drumGoal[id]! - m[id]!));
    drumTrims[id]![kit] = Math.round(10 ** (gain / 20) * 1000) / 1000;
    row.push(
      `${id} ${m[id]!.toFixed(1)} ${gain >= 0 ? "+" : ""}${gain.toFixed(1)}`,
    );
  }
  console.log(row.join("  "));
}

const table = (t: Record<string, Record<string, number>>) =>
  Object.entries(t)
    .map(
      ([role, r]) =>
        `  ${role}: {\n${Object.entries(r)
          .map(
            ([k, v]) => `    ${/^\w+$/.test(k) ? k : JSON.stringify(k)}: ${v},`,
          )
          .join("\n")}\n  },`,
    )
    .join("\n");

if (write) {
  writeFileSync(
    join(root, "core/distill/hyperpop/genome/levels.ts"),
    `/**
 * Gain trims that put every sound in the genome's palette at its role's
 * loudness: the mean of the role's hand-built demo voices playing the role's
 * standard part (fugue voices answer to the lead). Generated by
 * \`bun scripts/genome-levels.ts --write\`; do not edit by hand.
 */
export const SOUND_TRIMS: Readonly<
  Record<string, Readonly<Record<string, number>>>
> = {
${table(trims)}
};

/** Per-kit gains for the kick, snare and hats at Redline's 909 balance. */
export const DRUM_TRIMS: Readonly<
  Record<string, Readonly<Record<string, number>>>
> = {
${table(drumTrims)}
};
`,
  );
  console.log("wrote core/distill/hyperpop/genome/levels.ts");
}
