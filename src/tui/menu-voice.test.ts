import { describe, expect, test } from "bun:test";
import { AUTOMATION_PARAMETERS, createScore } from "../../core/score.ts";
import {
  EditMenu,
  rootNodes,
  type MenuContext,
  type MenuNode,
} from "./menu.ts";
import { voiceGroup } from "./menu-voice.ts";

function context(): MenuContext {
  return {
    score: createScore({
      tempoBpm: 120,
      bars: 2,
      tracks: [{ id: "lead", name: "lead", instrument: "saw" }],
      notes: [],
    }),
    trackId: "lead",
    playing: false,
    grid: "1/16",
    grids: ["1/4", "1/8", "1/16"],
    clickOn: false,
    countInBars: 1,
  };
}

function open(nodes: MenuNode[], id: string, ctx: MenuContext): MenuNode[] {
  const node = nodes.find((n) => n.kind === "menu" && n.id === id);
  if (!node || node.kind !== "menu") throw new Error(`no menu ${id}`);
  return node.build(ctx);
}

const labels = (nodes: MenuNode[]) => nodes.map((node) => node.label);

describe("0.7 voice menu groups", () => {
  test("Voice groups mount once with clips, formant, sing and vocoder rows", () => {
    const ctx = context();
    const root = rootNodes(ctx);
    // Seven top-level sections, unchanged.
    expect(root).toHaveLength(7);
    const sound = open(root, "sound", ctx);
    const effects = open(root, "effects", ctx);
    const browse = open(sound, "browse", ctx);
    // The formant lane fills Effects > Voice.
    expect(labels(effects)).toContain("Voice");
    expect(labels(open(effects, "voice", ctx))).toContain("Formant");
    // The sing lane fills browse sounds › Voices (Choir, Solo, Throat).
    expect(labels(browse).filter((label) => label === "Voices")).toHaveLength(
      1,
    );
    // The clips lane fills Sound > Voice (Clips, Lyrics) and Voices > Vocal.
    expect(labels(sound).filter((l) => l === "Voice")).toHaveLength(1);
    expect(labels(open(sound, "voice", ctx)).slice(0, 2)).toEqual([
      "Clips",
      "Lyrics",
    ]);
    expect(labels(browse)).toContain("Voices");
    // The vocoder lane adds Effects > Voice > Vocoder.
    expect(labels(effects).filter((l) => l === "Voice")).toHaveLength(1);
    expect(labels(open(effects, "voice", ctx))).toContain("Vocoder");
    expect(labels(sound).slice(-2)).toEqual(["performance", "browse sounds"]);
    // Effects > Voice has no rows until the formant or vocoder lane lands.
    expect(
      labels(effects).filter((l) => l === "Voice").length,
    ).toBeLessThanOrEqual(1);
  });

  test("a group with rows mounts once as a sub-menu", () => {
    const ctx = context();
    const row: MenuNode = {
      kind: "action",
      label: "Clips",
      command: "/clip",
      help: "audio clips",
    };
    const group = voiceGroup("voice", "Voice", "help", () => [row], ctx);
    expect(group).toHaveLength(1);
    expect(group[0]!.kind).toBe("menu");
    expect(group[0]!.label).toBe("Voice");
    if (group[0]!.kind === "menu")
      expect(labels(group[0]!.build(ctx))).toEqual(["Clips"]);
    expect(voiceGroup("voice", "Voice", "help", () => [], ctx)).toEqual([]);
  });

  test("Formant rows: on, preset, shift, mix; the vowel gains to and morph", () => {
    const ctx = context();
    const effects = open(rootNodes(ctx), "effects", ctx);
    const formant = open(open(effects, "voice", ctx), "formant", ctx);
    expect(labels(formant)).toEqual([
      "on",
      "preset",
      "shift",
      "mix",
      "advanced",
    ]);
    const shift = formant.find((node) => node.label === "shift")!;
    expect(shift.kind === "number" && shift.command(-4)).toBe(
      "fx formant shift -4",
    );
    // Not duplicated under more effects.
    expect(labels(open(effects, "more effects", ctx))).not.toContain("Formant");
    const vowel = open(open(effects, "more effects", ctx), "vowel", ctx);
    expect(labels(vowel)).toEqual(
      expect.arrayContaining(["vowel", "mix", "to", "morph"]),
    );
    const to = vowel.find((node) => node.label === "to")!;
    expect(to.kind === "choice" && to.command("o")).toBe("/vowel to o");
  });

  test("Mix & automation offers the formant and vowel-morph lanes", () => {
    expect(AUTOMATION_PARAMETERS).toEqual(
      expect.arrayContaining(["formant-shift", "formant-mix", "vowel-morph"]),
    );
  });
});

describe("Sound > Voice > Pitch (pitch lane)", () => {
  test("shows only for a track with audio, with analyze, trace and notes rows", async () => {
    const { pitchMenuRows, pitchSoundRows } = await import("./menu-voice.ts");
    const ctx = context();
    expect(pitchSoundRows(ctx)).toEqual([]);
    const withClip: MenuContext = {
      ...ctx,
      score: createScore({
        tracks: [
          {
            id: "lead",
            instrument: "sine",
            clips: [
              {
                id: "verse",
                src: "tracks/lead/samples/verse.wav",
                sha256: "a".repeat(64),
                startTick: 0,
              },
            ],
          },
        ],
      } as never),
    };
    const rows = pitchSoundRows(withClip);
    expect(labels(rows)).toEqual(["Pitch"]);
    const sound = open(rootNodes(withClip), "sound", withClip);
    const voice = open(sound, "voice", withClip);
    expect(labels(voice)).toContain("Pitch");
    const pitch = pitchMenuRows(withClip);
    expect(labels(pitch)).toEqual([
      "Analyze",
      "detected key",
      "median pitch",
      "trace",
      "Make notes",
    ]);
    const trace = pitch.find((row) => row.label === "trace")!;
    if (trace.kind !== "toggle") throw new Error("trace is a toggle");
    expect(trace.value).toBe(false);
    expect(trace.command(true)).toBe("/vocal pitch trace on");
    const make = pitch.find((row) => row.label === "Make notes")!;
    expect(make.kind === "action" && make.command).toBe("/vocal notes");
  });

  test("Sound > Voice > Autotune on a sampler track: rows run /autotune", () => {
    const ctx: MenuContext = {
      ...context(),
      trackId: "vox",
      score: createScore({
        tempoBpm: 120,
        bars: 2,
        tracks: [
          { id: "lead", name: "lead", instrument: "saw" },
          {
            id: "vox",
            name: "vox",
            instrument: "sampler",
            sampler: {
              mode: "oneshot",
              voices: { take: { src: "tracks/vox/samples/take.wav" } },
            },
            autotune: { preset: "hard", speed: 10 },
          },
        ],
        notes: [],
      }),
    };
    const sound = open(rootNodes(ctx), "sound", ctx);
    const voice = open(sound, "voice", ctx);
    expect(labels(voice)).toContain("Autotune");
    // The root filter finds nested voice groups by name.
    const menu = new EditMenu();
    menu.show(ctx);
    menu.key("/", ctx);
    for (const ch of "autotune") menu.key(ch, ctx);
    const found = menu.view(ctx).items.map((item) => item.label);
    expect(found.some((label) => label.includes("Voice › Autotune"))).toBe(
      true,
    );
    menu.key("\r", ctx);
    expect(menu.view(ctx).items[0]!.label).toStartWith("Preset");
    const rows = open(voice, "voice:autotune", ctx);
    expect(labels(rows).slice(0, 4)).toEqual(["Preset", "To", "From", "Key"]);
    expect(labels(rows)).toContain("Speed");
    expect(labels(rows)).toContain("Drift");
    expect(labels(rows)).toContain("Voice");
    const preset = rows.find((row) => row.label === "Preset")!;
    if (preset.kind !== "choice") throw new Error("preset is a choice");
    expect(preset.value).toBe("hard");
    expect(preset.command("gentle")).toBe("autotune gentle");
    expect(preset.command("off")).toBe("autotune off");
    const speed = rows.find((row) => row.label === "Speed")!;
    if (speed.kind !== "number") throw new Error("speed is a number");
    expect(speed.value).toBe(10);
    expect(speed.command(speed.step(10, 1))).toBe("autotune speed 15");
    expect(speed.reset).toBe("autotune speed off");
    const from = rows.find((row) => row.label === "From")!;
    if (from.kind !== "choice") throw new Error("from is a choice");
    expect(from.options).toEqual(["own notes", "lead"]);
    expect(from.command("lead")).toBe("autotune to notes lead");
    expect(labels(rows).at(-1)).toBe("reset to preset");
  });

  test("a synth track has no Autotune row", () => {
    const ctx = context();
    const sound = open(rootNodes(ctx), "sound", ctx);
    // Voice may show for other lanes (Clips); Autotune stays hidden.
    if (labels(sound).includes("Voice"))
      expect(labels(open(sound, "voice", ctx))).not.toContain("Autotune");
  });
});
