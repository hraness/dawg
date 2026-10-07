import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyScoreOperation,
  createScore,
  normalizeWavetable,
} from "../../core/score.ts";
import { song, track, note, wavetable } from "../../core/sdk/v1.ts";
import { scriptedRunner } from "../auth/runner.ts";
import {
  isLocalTableName,
  listLocalWavetables,
  localTablePath,
  pickWavetable,
  wavetableListLines,
} from "../commands/wavetable.ts";
import {
  runContext,
  syntheticWav,
  tempProject,
} from "../media/media-fixtures.ts";
import { findMediaTool } from "../media/registry.ts";
import { makeWavetableFile } from "../media/wavetable.ts";
import { rootNodes, type MenuContext, type MenuNode } from "../tui/menu.ts";
import { PackStore } from "./packs.ts";
import { SampleLibrary } from "./samples.ts";
import { renderScorePcm } from "./wav.ts";
import {
  MAKE_FRAME_SIZE,
  encodeWavetableWav,
  makeWavetable,
} from "./wavetable-maker.ts";
import { analyzeFrame, wavetableFromWav } from "./wavetable.ts";

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups) await cleanup();
});

const RATE = 48_000;
const noFetch = (async () => {
  throw new Error("no network in tests");
}) as unknown as typeof fetch;

/** A 110 Hz tone whose harmonic count grows over `seconds` (a filter sweep). */
function sweep(seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  let phase = 0;
  for (let i = 0; i < out.length; i += 1) {
    phase += 110 / RATE;
    phase -= Math.floor(phase);
    const top = 1 + Math.floor((i / RATE) * 10);
    let value = 0;
    for (let h = 1; h <= top; h += 1)
      value += Math.sin(2 * Math.PI * h * phase) / h;
    out[i] = 0.5 * value;
  }
  return out;
}

function noise(seconds: number): Float32Array {
  let seed = 1;
  return new Float32Array(Math.round(seconds * RATE)).map(() => {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  });
}

function centroid(frame: Float32Array): number {
  const spectrum = analyzeFrame(frame);
  let weighted = 0;
  let total = 0;
  for (let h = 1; h < spectrum.re.length; h += 1) {
    const amp = Math.hypot(spectrum.re[h]!, spectrum.im[h]!);
    weighted += h * amp;
    total += amp;
  }
  return weighted / total;
}

describe("make wavetable", () => {
  test("slices a pitched sweep into cycles that brighten frame by frame", () => {
    const made = makeWavetable(sweep(3), RATE, { frames: 16 });
    expect(made.method).toBe("slice");
    expect(made.pitch?.hz).toBeCloseTo(110, 0);
    expect(made.pitch?.note).toBe("A2");
    expect(made.frames).toHaveLength(16);
    for (const frame of made.frames) {
      expect(frame).toHaveLength(MAKE_FRAME_SIZE);
      let peak = 0;
      for (const value of frame) peak = Math.max(peak, Math.abs(value));
      expect(peak).toBeCloseTo(0.98, 3);
    }
    expect(centroid(made.frames[15]!)).toBeGreaterThan(
      centroid(made.frames[0]!) + 1,
    );
    expect(made.sweep).toContain("brightens");
  });

  test("unpitched material falls back to spectral frames", () => {
    const made = makeWavetable(noise(2), RATE, { frames: 8 });
    expect(made.method).toBe("spectral");
    expect(made.pitch).toBeUndefined();
    expect(made.frames).toHaveLength(8);
  });

  test("an explicit region and method are honoured", () => {
    const made = makeWavetable(sweep(3), RATE, {
      frames: 4,
      start: 0.5,
      end: 1,
      method: "spectral",
    });
    expect(made.method).toBe("spectral");
    expect(made.region).toEqual({ start: 0.5, end: 1, auto: false });
  });

  test("is deterministic and round-trips through the clm WAV format", () => {
    const a = encodeWavetableWav(
      makeWavetable(sweep(2), RATE, { frames: 8 }).frames,
    );
    const b = encodeWavetableWav(
      makeWavetable(sweep(2), RATE, { frames: 8 }).frames,
    );
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const table = wavetableFromWav("made", "id", a);
    expect(table.frames).toBe(8);
  });

  test("rejects bad options", () => {
    expect(() => makeWavetable(sweep(1), RATE, { frames: 0 })).toThrow();
    expect(() => makeWavetable(sweep(1), RATE, { smooth: 2 })).toThrow();
    expect(() => makeWavetable(new Float32Array(100), RATE)).toThrow("50 ms");
  });
});

describe("make_wavetable media tool", () => {
  test("writes tracks/<slug>/wavetables/<name>.wav from a WAV without ffmpeg", async () => {
    const created = await tempProject();
    cleanups.push(created.cleanup);
    const tone = sweep(2);
    await Bun.write(
      join(created.downloads, "song.wav"),
      syntheticWav(
        2,
        (t) => tone[Math.min(tone.length - 1, Math.round(t * RATE))]!,
        RATE,
      ),
    );
    const result = await makeWavetableFile(
      { file: "song.wav", name: "growl", frames: 8 },
      runContext(
        { projectRoot: created.root, trackSlug: "main", fetch: noFetch },
        scriptedRunner([], []),
      ),
    );
    expect(result.outputs).toEqual(["tracks/main/wavetables/growl.wav"]);
    const info = result.content.wavetable as Record<string, unknown>;
    expect(info.frames).toBe(8);
    expect(info.method).toBe("slice");
    expect(info.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(String(result.content.next)).toContain("set_wavetable");
    expect(listLocalWavetables(created.root)).toEqual([
      "tracks/main/wavetables/growl.wav",
    ]);
  });

  test("validates arguments in plan()", () => {
    const tool = findMediaTool("make_wavetable")!;
    const context = {
      score: createScore({ tracks: [{ id: "main" }] }),
      focusedTrackId: "main",
      revision: 1,
      newNoteId: (id: string, index: number) => `${id}-${index}`,
    };
    expect(() => tool.plan({ file: "a.wav", name: "Bad!" }, context)).toThrow();
    expect(() =>
      tool.plan({ file: "a.wav", name: "ok", frames: 999 }, context),
    ).toThrow("frames");
    expect(() =>
      tool.plan({ file: "a.wav", name: "ok", start: 2, end: 1 }, context),
    ).toThrow("end");
    expect(tool.plan({ file: "a.wav", name: "ok" }, context).kind).toBe(
      "media",
    );
  });
});

describe("project wavetables", () => {
  async function projectWithTable() {
    const root = await mkdtemp(join(tmpdir(), "dawg-wtlocal-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, "tracks/lead/wavetables"), { recursive: true });
    const bytes = encodeWavetableWav(
      makeWavetable(sweep(2), RATE, { frames: 8 }).frames,
    );
    await writeFile(join(root, "tracks/lead/wavetables/growl.wav"), bytes);
    return root;
  }

  test("score accepts project .wav tables and rejects unsafe paths", () => {
    expect(
      normalizeWavetable({ table: { src: "tracks/lead/wavetables/growl.wav" } })
        ?.table.src,
    ).toBe("tracks/lead/wavetables/growl.wav");
    expect(() =>
      normalizeWavetable({ table: { src: "../outside.wav" } }),
    ).toThrow();
    expect(() => normalizeWavetable({ table: { src: "/abs.wav" } })).toThrow();
  });

  test("the SDK maps ./wavetables/x.wav into the track's directory", () => {
    const s = song({
      tracks: [
        track({
          name: "lead",
          instrument: wavetable("./wavetables/growl.wav", { wt: 0.5 }),
          notes: [note("A2", 0, 1)],
        }),
      ],
    });
    expect(s.tracks[0]?.wavetable?.table.src).toBe(
      "tracks/lead/wavetables/growl.wav",
    );
    expect(() => wavetable("../x.wav")).toThrow();
  });

  test("/wt picks a project table by file name, pins it, and it renders", async () => {
    const root = await projectWithTable();
    const score = createScore({ tracks: [{ id: "lead", name: "lead" }] });
    expect(isLocalTableName("growl.wav")).toBe(true);
    expect(localTablePath(score, "lead", "growl.wav", root)).toBe(
      "tracks/lead/wavetables/growl.wav",
    );
    const packs = new PackStore({
      fetch: noFetch,
      cacheDir: join(root, ".packs"),
    } as never);
    const picked = await pickWavetable(packs, score, "lead", "growl.wav", root);
    const next = applyScoreOperation(score, picked.operation);
    const table = next.tracks[0]!.wavetable!.table;
    expect(table.src).toBe("tracks/lead/wavetables/growl.wav");
    expect(table.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(picked.summary).toContain("growl.wav (project)");
    await expect(
      pickWavetable(packs, score, "lead", "missing.wav", root),
    ).rejects.toThrow("wt list");
    expect((await wavetableListLines(undefined, root)).join("\n")).toContain(
      "tracks/lead/wavetables/growl.wav",
    );

    const playing = applyScoreOperation(next, {
      type: "addNote",
      note: {
        id: "n",
        trackId: "lead",
        pitch: 45,
        startTick: 0,
        durationTicks: 960,
        velocity: 1,
      },
    } as never);
    const library = new SampleLibrary({ projectRoot: root, ffmpeg: null });
    const bank = await library.load(playing);
    expect(bank.problems).toEqual([]);
    expect(bank.wavetables?.get("lead")?.frames).toBe(8);
    const audio = renderScorePcm(playing, { samples: bank });
    let energy = 0;
    for (let i = 0; i < 4_000; i += 1) energy += Math.abs(audio.pcm[i]!);
    expect(energy).toBeGreaterThan(0);
  });

  test("a missing project table is a load problem, not a crash", async () => {
    const root = await projectWithTable();
    const score = createScore({
      tracks: [
        {
          id: "lead",
          instrument: "wavetable",
          wavetable: { table: { src: "tracks/lead/wavetables/gone.wav" } },
        },
      ],
    } as never);
    const bank = await new SampleLibrary({
      projectRoot: root,
      ffmpeg: null,
    }).load(score);
    expect(bank.problems[0]?.message).toContain("file is missing");
  });

  test("the menu's table picker lists project tables", async () => {
    const root = await projectWithTable();
    const ctx: MenuContext = {
      score: createScore({
        tracks: [
          {
            id: "lead",
            name: "lead",
            instrument: "wavetable",
            wavetable: { table: { src: "builtin:basic" } },
          },
        ],
      } as never),
      trackId: "lead",
      playing: false,
      grid: "1/16",
      grids: ["1/16"],
      clickOn: false,
      countInBars: 1,
      projectRoot: root,
    };
    const open = (nodes: MenuNode[], id: string): MenuNode[] => {
      const node = nodes.find((item) => item.kind === "menu" && item.id === id);
      if (!node || node.kind !== "menu") throw new Error(`no ${id}`);
      return node.build(ctx);
    };
    const tables = open(open(rootNodes(ctx), "parameters"), "wavetables");
    const actions = tables.filter(
      (node): node is Extract<MenuNode, { kind: "action" }> =>
        node.kind === "action",
    );
    expect(actions.map((node) => node.command)).toContain(
      "wt tracks/lead/wavetables/growl.wav",
    );
  });
});
