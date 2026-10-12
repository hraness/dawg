import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUNDLED_SAMPLE_BASE,
  BUNDLED_SAMPLES,
  bundledSample,
  bundledSampleRef,
  searchBundledSamples,
} from "../../core/bundled-samples.ts";
import {
  applyScoreOperation,
  createScore,
  scoreFromJSON,
} from "../../core/score.ts";
import { readBundledSample, bundledSampleForUrl } from "./bundled-samples.ts";
import { PackStore } from "./packs.ts";
import { SampleLibrary } from "./samples.ts";
import { renderScorePcm } from "./wav.ts";
import { useSound } from "../commands/pack.ts";
import {
  sampleChopArgs,
  sampleLibraryLines,
  parseSampleCommand,
  sampleChopTarget,
  sampleLibraryTarget,
} from "../commands/sample.ts";
import { runChop } from "./chop/run.ts";
import { slicesToSampler } from "./chop/sampler.ts";
import { PACK_TOOLS } from "../agent/pack-tools.ts";
import { AUDIO_TOOL } from "../agent/audio-tool.ts";
import type { ToolContext } from "../agent/tools.ts";
import type { CommandRunner } from "../auth/runner.ts";

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), "dawg-studio-"));
  dirs.push(dir);
  return dir;
}
const noTools: CommandRunner = {
  which: () => undefined,
  run: async () => {
    throw new Error("no process allowed");
  },
};
async function offline() {
  return new PackStore({
    dir: await temp(),
    offline: true,
    fetch: async () => {
      throw new Error("no network allowed");
    },
  });
}
const score = createScore({
  tracks: [{ id: "main", name: "Main", instrument: "sine" }],
  bars: 1,
  tempoBpm: 120,
});
const context: ToolContext = {
  score,
  focusedTrackId: "main",
  revision: 0,
  newNoteId: (track, i) => `${track}-${i}`,
};

test("all eight packaged files match manifest, pitch metadata, guards and canonical digests", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../../assets/samples/studio/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  expect(BUNDLED_SAMPLES).toHaveLength(8);
  for (const sample of BUNDLED_SAMPLES) {
    const file = await readBundledSample(sample.id);
    expect(manifest.samples[sample.id]).toEqual({
      sha256: file.sha256,
      seconds: sample.seconds,
      bytes: file.bytes.length,
    });
    const ref = bundledSampleRef(sample.id);
    expect(ref.root).toBe(sample.root);
    const value = createScore({
      tracks: [
        {
          id: "v",
          name: "Voice",
          instrument: "sampler",
          sampler: { mode: "keyed", voices: { voice: ref } },
        },
      ],
    });
    expect(scoreFromJSON(JSON.parse(JSON.stringify(value)))).toEqual(value);
    const data = new DataView(file.bytes.buffer, file.bytes.byteOffset);
    expect(data.getUint32(24, true)).toBe(24_000);
    let peak = 0;
    for (let i = 44; i < file.bytes.length; i += 2)
      peak = Math.max(peak, Math.abs(data.getInt16(i, true)));
    expect(peak).toBeGreaterThan(8_000);
    expect(peak).toBeLessThanOrEqual(16_384);
  }
});

test("catalogued bundled URLs refuse bad pins and never fall back to network", async () => {
  const store = await offline();
  expect(bundledSample("../../outside")).toBeUndefined();
  expect(
    bundledSampleForUrl(`${BUNDLED_SAMPLE_BASE}../hold-on.wav`),
  ).toBeUndefined();
  await expect(
    store.fetchFile(`${BUNDLED_SAMPLE_BASE}hold-on.wav`, "0".repeat(64)),
  ).rejects.toThrow("SHA-256");
  await expect(
    store.fetchFile(`${BUNDLED_SAMPLE_BASE}unknown.wav`),
  ).rejects.toThrow("unknown bundled");
  await expect(readBundledSample("../outside")).rejects.toThrow("Unknown");
});

test("fresh offline install discovers, loads and renders the original playable voice", async () => {
  const packs = await offline();
  const root = await temp();
  expect(
    (await packs.search("vocal garage", { pack: "studio" })).map(
      (x) => x.sound,
    ),
  ).toEqual(["hold-on"]);
  expect(searchBundledSamples("pad").map((x) => x.id)).toEqual([
    "vowel-ah",
    "vowel-oh",
  ]);
  const result = await useSound(packs, score, "main", "studio/hold-on");
  let next = result.operations.reduce(applyScoreOperation, score);
  expect(next.tracks[0]!.sampler?.mode).toBe("keyed");
  next = applyScoreOperation(next, {
    type: "addNote",
    note: {
      id: "n",
      trackId: "main",
      pitch: 60,
      velocity: 0.8,
      startTick: 0,
      durationTicks: 1920,
    },
  });
  const bank = await new SampleLibrary({ projectRoot: root, packs }).load(next);
  expect(bank.problems).toEqual([]);
  const pcm = renderScorePcm(next, { sampleRate: 24_000, samples: bank });
  expect(pcm.pcm.some((value) => value !== 0)).toBe(true);
  expect((await packs.pin("pack:studio/glass-hit")).root).toBe(84);
});

test("manual sample aliases are bounded and provide the shared grid-slice request", () => {
  expect(parseSampleCommand("/sample library vocal")).toEqual({
    kind: "library",
    query: "vocal",
  });
  expect(parseSampleCommand("/sample use HOLD-ON")).toEqual({
    kind: "use",
    id: "hold-on",
  });
  expect(parseSampleCommand("/sample use missing")?.kind).toBe("error");
  expect(parseSampleCommand("/sample preview HOLD-ON")).toEqual({
    kind: "preview",
    id: "hold-on",
  });
  expect(parseSampleCommand("/sample preview ../outside")?.kind).toBe("error");
  expect(parseSampleCommand("/sample chop hold-on 8")).toEqual({
    kind: "chop",
    id: "hold-on",
    count: 8,
  });
  expect(parseSampleCommand("/sample chop 16")).toEqual({
    kind: "chop",
    count: 16,
  });
  expect(parseSampleCommand("/sample chop hold-on 10000")?.kind).toBe("error");
  expect(sampleLibraryLines("vocal").join("\n")).toContain("hold-on");
  expect(sampleChopArgs(score, "main", "chops", "hold-on", 4)).toEqual({
    input: "pack:studio/hold-on",
    method: "grid",
    count: 4,
    track: "chops",
    pattern: true,
  });
});

test("typed and agent chops share bundled bytes, output safety and playable score operations", async () => {
  const root = await temp();
  const ctx = {
    root,
    runner: noTools,
    signal: new AbortController().signal,
    tempo: { bpm: 120, beatsPerBar: 4 },
  };
  const args = sampleChopArgs(score, "main", "chops", "hold-on", 4);
  const sliced = await runChop("slice", args, ctx);
  expect(sliced.outputs).toHaveLength(4);
  expect(
    sliced.outputs.every((out) => out.seconds > 0.49 && out.seconds < 0.51),
  ).toBe(true);
  const ops = slicesToSampler(score, "chops", "hold-on", sliced.outputs, {
    pattern: true,
    newNoteId: (i) => `chop-${i}`,
  });
  const next = ops.operations.reduce(applyScoreOperation, score);
  expect(next.notes).toHaveLength(4);
  expect(
    Object.keys(next.tracks.find((t) => t.id === "chops")!.sampler!.voices),
  ).toHaveLength(4);
  await expect(
    runChop(
      "cut",
      { input: args.input, from: "0s", to: "0.5s", output: "../escape.wav" },
      ctx,
    ),
  ).rejects.toThrow("outside");
  await expect(
    runChop("info", { input: "pack:studio/../../outside" }, ctx),
  ).rejects.toThrow("unknown bundled");
  const plan = AUDIO_TOOL.plan({ op: "slice", ...args }, context);
  if (plan.kind !== "prepare") throw new Error("expected prepare plan");
  const result = await plan.run({
    workspace: { root } as never,
    media: { runner: noTools },
    signal: ctx.signal,
  });
  expect(result.operations.filter((op) => op.type === "addNote")).toHaveLength(
    4,
  );
});

test("sample shelf and chop targets preserve keyed voices, note performances and occupied IDs", () => {
  const existing = createScore({
    tracks: [
      {
        id: "keys",
        name: "Keys",
        instrument: "sampler",
        sampler: { mode: "keyed", voices: { v: bundledSampleRef("vowel-ah") } },
      },
      {
        id: "hits",
        name: "Hits",
        instrument: "sampler",
        sampler: {
          mode: "oneshot",
          voices: { v: bundledSampleRef("glass-hit") },
        },
      },
      { id: "slices", name: "Reserved", instrument: "sine" },
      { id: "samples", name: "Reserved", instrument: "sine" },
    ],
    notes: [
      {
        id: "n",
        trackId: "hits",
        startTick: 0,
        durationTicks: 120,
        pitch: 36,
        velocity: 0.8,
      },
    ],
  });
  expect(sampleLibraryTarget(existing, "keys")).toBe("samples-2");
  expect(sampleLibraryTarget(existing, "hits")).toBe("samples-2");
  expect(sampleLibraryTarget(existing, "slices")).toBe("slices");
  expect(sampleChopTarget(existing, "keys")).toBe("slices-2");
  expect(sampleChopTarget(existing, "hits")).toBe("slices-2");
  expect(sampleChopTarget(existing, "slices")).toBe("slices-2");
  expect(sampleChopTarget(existing, "new")).toBe("new");
  const local = createScore({
    tracks: [
      {
        id: "v",
        name: "My Voice",
        instrument: "sampler",
        sampler: {
          mode: "keyed",
          voices: {
            voice: { src: "samples/vocal.wav", sha256: "a".repeat(64) },
          },
        },
      },
    ],
  });
  expect(sampleChopArgs(local, "v", "slices").input).toBe(
    "tracks/my-voice/samples/vocal.wav",
  );
});

test("chopping a trimmed voice stays within its selected source window", async () => {
  const source = createScore({
    tracks: [
      {
        id: "voice",
        instrument: "sampler",
        sampler: {
          mode: "keyed",
          voices: {
            trimmed: { ...bundledSampleRef("hold-on"), begin: 0.25, end: 0.5 },
          },
        },
      },
    ],
  });
  const before = source.toJSON();
  const args = sampleChopArgs(source, "voice", "slices", "trimmed", 4);
  const result = await runChop("slice", args, {
    root: await temp(),
    runner: noTools,
    signal: new AbortController().signal,
    tempo: { bpm: 120, beatsPerBar: 4 },
  });
  expect(result.outputs).toHaveLength(4);
  expect(result.outputs.map((out) => out.from)).toEqual([
    0.5, 0.625, 0.75, 0.875,
  ]);
  expect(result.outputs.map((out) => out.to)).toEqual([0.625, 0.75, 0.875, 1]);
  for (const output of result.outputs)
    expect(output.seconds).toBeCloseTo(0.125, 4);
  expect(source.toJSON()).toEqual(before);
});

test("agent library detail exposes offline source, roots and normalized named syllables", async () => {
  const tool = PACK_TOOLS.find((tool) => tool.name === "list_packs")!;
  const plan = tool.plan({ pack: "studio" }, context);
  if (plan.kind !== "action") throw new Error("expected action");
  const result = await plan.run({ packs: await offline() });
  const data = JSON.parse(result.content);
  expect(data.offline).toBe(true);
  expect(data.samples[0].slices).toEqual([
    { name: "hold", begin: 0, end: 0.25 },
    { name: "on", begin: 0.25, end: 0.5 },
    { name: "hold", begin: 0.5, end: 0.75 },
    { name: "on", begin: 0.75, end: 1 },
  ]);
  expect(data.samples[0].ref).toEqual(bundledSampleRef("hold-on"));
});
