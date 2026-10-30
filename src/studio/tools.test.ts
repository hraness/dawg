import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrackScore } from "../../core/score.ts";
import type { CommandRunner } from "../auth/runner.ts";
import { parseVocalBookSpec, VOCAL_MODEL } from "../vocals/index.ts";
import { expectedVocalFrames } from "../vocals/spec.ts";
import { readWorkflowResource } from "../workflows/catalog.ts";
import {
  parseSongChart,
  singSongChart,
  CHART_VOCAL_ID,
  CHART_VOCAL_TRACK,
} from "./song.ts";
import { SONG_TOOLS } from "./tools.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "dawg-chart-tools-"));
  roots.push(root);
  const chart = parseSongChart(
    JSON.parse(
      await readWorkflowResource(
        "original-house",
        "examples/original.chart.json",
      ),
    ),
  );
  await writeFile(join(root, "chart.json"), JSON.stringify(chart));
  return { root, chart };
}
const context = {
  score: new TrackScore(),
  focusedTrackId: "unrelated-track",
  revision: 0,
  newNoteId: (_track: string, i: number) => `n${i}`,
};

test("performing an un-sung chart explains the next step without inference or writes", async () => {
  const { root } = await fixture();
  const plan = SONG_TOOLS.find((tool) => tool.name === "perform_chart")!.plan(
    { file: "chart.json" },
    context,
  );
  if (plan.kind !== "prepare-replace")
    throw new Error("expected prepared chart");
  let effects = 0;
  const runner: CommandRunner = {
    which: () => {
      effects++;
      return undefined;
    },
    run: async () => {
      effects++;
      throw new Error("unexpected inference");
    },
  };
  await expect(
    plan.run({ workspace: { root }, media: { runner } }),
  ).rejects.toThrow("run sing_chart");
  expect(effects).toBe(0);
  expect(await readdir(root)).toEqual(["chart.json"]);
});

test("malformed chart is rejected before backend discovery or asset writes", async () => {
  const { root, chart } = await fixture();
  await writeFile(
    join(root, "chart.json"),
    JSON.stringify({ ...chart, bpm: null }),
  );
  const plan = SONG_TOOLS.find((tool) => tool.name === "sing_chart")!.plan(
    { file: "chart.json" },
    context,
  );
  if (plan.kind !== "media") throw new Error("expected media plan");
  let effects = 0;
  const runner: CommandRunner = {
    which: () => {
      effects++;
      return undefined;
    },
    run: async () => {
      effects++;
      throw new Error("unexpected backend");
    },
  };
  await expect(
    plan.run({
      projectRoot: root,
      trackSlug: "focused-other",
      runner,
      signal: new AbortController().signal,
      progress() {},
    }),
  ).rejects.toThrow("bpm");
  expect(effects).toBe(0);
  expect(await readdir(root)).toEqual(["chart.json"]);
});

test("accepted chart vocals replay from one namespace after inspection focus changes", async () => {
  const { root, chart } = await fixture();
  let calls = 0;
  const runner: CommandRunner = {
    which: () => undefined,
    async run(_command, args) {
      calls++;
      const spec = parseVocalBookSpec(
        JSON.parse(await readFile(args.at(-2)!, "utf8")),
      );
      const frames = expectedVocalFrames(spec),
        wav = Buffer.alloc(44 + frames * 2);
      wav.write("RIFF");
      wav.writeUInt32LE(wav.length - 8, 4);
      wav.write("WAVEfmt ", 8);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(24000, 24);
      wav.writeUInt32LE(48000, 28);
      wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34);
      wav.write("data", 36);
      wav.writeUInt32LE(frames * 2, 40);
      wav.fill(0x1f, 44);
      await writeFile(args.at(-1)!, wav);
      let cursor = 0;
      const slices = spec.parts.map(([name, beats]) => {
        const begin = cursor;
        cursor += Math.round((((beats + spec.lead) * 60) / spec.bpm) * 24000);
        return {
          name,
          begin: Number((begin / frames).toFixed(6)),
          end: Number((cursor / frames).toFixed(6)),
        };
      });
      return {
        code: 0,
        killed: false,
        stderr: "",
        stdout: JSON.stringify({
          seconds: Number((frames / 24000).toFixed(6)),
          slices,
          provenance: {
            python: "3.12.8",
            dependencies: {
              kokoro: "0.9.4",
              misaki: "0.9.4",
              pyworld: "0.3.5",
              numpy: "2.5.4",
              soundfile: "0.14.0",
              torch: "2.14.1",
              spacy: "3.8.7",
              en_core_web_sm: "3.8.0",
            },
            model: VOCAL_MODEL,
          },
        }),
      };
    },
  };
  const accepted = await singSongChart(chart, {
    projectRoot: root,
    trackSlug: CHART_VOCAL_TRACK,
    id: CHART_VOCAL_ID,
    backend: { python: process.execPath, source: "configured" },
    runner,
  });
  const sing = SONG_TOOLS.find((tool) => tool.name === "sing_chart")!.plan(
    { file: "chart.json" },
    context,
  );
  if (sing.kind !== "media") throw new Error("expected media plan");
  const result = await sing.run({
    projectRoot: root,
    trackSlug: "some-other-focus",
    runner,
    env: { DAWG_VOCAL_PYTHON: "/nonexistent" },
    signal: new AbortController().signal,
    progress() {},
  });
  expect(result.content.reused).toBe(true);
  expect(
    result.outputs.every((path) => path.startsWith("tracks/vocals/")),
  ).toBe(true);
  const perform = SONG_TOOLS.find(
    (tool) => tool.name === "perform_chart",
  )!.plan({ file: "chart.json" }, context);
  if (perform.kind !== "prepare-replace")
    throw new Error("expected replacement preparation");
  const replacement = await perform.run({
    workspace: { root },
    media: { runner },
  });
  const vocal = replacement.next.tracks.find((track) => track.id === "bvox")!;
  expect(
    Object.values(vocal.sampler!.voices).every(
      (voice) => voice.src === accepted.wavPath,
    ),
  ).toBe(true);
  expect(await readdir(join(root, "tracks"))).toEqual(["vocals"]);
  expect(calls).toBe(1);
});
