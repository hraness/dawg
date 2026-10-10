/** Effects › Voice › vocoder and browse › Voices › vocoder rows. */
import { describe, expect, test } from "bun:test";
import { createScore, type TrackInput } from "../../core/score.ts";
import { VOCODER_PARAMS } from "../../core/vocoder.ts";
import { parseVocoderCommand } from "../commands/vocoder.ts";
import { rootNodes, type MenuContext, type MenuNode } from "./menu.ts";

const vox: TrackInput = {
  id: "vox",
  name: "vox",
  instrument: "sampler",
  sampler: { mode: "oneshot", voices: { vox: { src: "tracks/vox/v.wav" } } },
};

function ctx(tracks: TrackInput[], trackId: string): MenuContext {
  return {
    score: createScore({ tempoBpm: 120, bars: 2, tracks, notes: [] }),
    trackId,
    playing: false,
    grid: "1/16",
    grids: ["1/16"],
    clickOn: false,
    countInBars: 1,
  };
}

function open(nodes: MenuNode[], id: string, c: MenuContext): MenuNode[] {
  const node = nodes.find((n) => n.kind === "menu" && n.id === id);
  if (!node || node.kind !== "menu") throw new Error(`no menu ${id}`);
  return node.build(c);
}

function vocoderRows(c: MenuContext): MenuNode[] {
  const effects = open(rootNodes(c), "effects", c);
  return open(open(effects, "voice", c), "voice:vocoder", c);
}

describe("vocoder menu", () => {
  test("the Source picker shows track names and quotes them back", () => {
    const c = ctx(
      [
        { ...vox, name: "Lead Vox" },
        {
          id: "pad",
          name: "pad",
          instrument: "vocoder",
          vocoder: { src: "vox" },
        },
      ],
      "pad",
    );
    const source = vocoderRows(c)[0]!;
    if (source.kind !== "choice") throw new Error("source is a choice");
    expect(source.value).toBe("Lead Vox");
    expect(source.options).toContain("Lead Vox");
    const command = source.command("Lead Vox");
    expect(command).toBe('vocoder src "Lead Vox"');
    expect(parseVocoderCommand(command)).toMatchObject({ src: "Lead Vox" });
  });
  test("Source, Preset, then one row per VOCODER_PARAMS key in order", () => {
    const c = ctx(
      [
        vox,
        {
          id: "lead",
          name: "lead",
          instrument: "vocoder",
          vocoder: { src: "vox" },
        },
      ],
      "lead",
    );
    const rows = vocoderRows(c);
    const labels = rows.map((row) => row.label);
    expect(labels.slice(0, 2)).toEqual(["source", "preset"]);
    expect(labels.slice(2, 2 + Object.keys(VOCODER_PARAMS).length)).toEqual(
      Object.keys(VOCODER_PARAMS),
    );
    for (const row of rows) {
      const command =
        row.kind === "number"
          ? row.command(row.value ?? row.min)
          : row.kind === "choice"
            ? row.command(row.options.at(-1)!)
            : row.kind === "action"
              ? row.command
              : undefined;
      if (command === undefined) continue;
      expect(parseVocoderCommand(command)?.type).not.toBe("vocoder-usage");
      if (row.kind === "number") {
        expect(row.reset).toBe(`vocoder ${row.label} reset`);
        expect(parseVocoderCommand(row.reset!)?.type).toBe("vocoder-set");
      }
    }
  });

  test("Entry guidance when nothing can be vocoded; one-step action on a vocal", () => {
    const lone = ctx([{ id: "lead", name: "lead", instrument: "saw" }], "lead");
    const rows = vocoderRows(lone);
    expect(rows.every((row) => row.kind === "info")).toBe(true);
    expect(JSON.stringify(rows)).toContain("/vocoder src <track>");
    const onVocal = vocoderRows(ctx([vox], "vox"));
    expect(onVocal).toEqual([
      expect.objectContaining({ kind: "action", command: "vocoder" }),
    ]);
  });

  test("Voice › voice presets › vocoder makes a carrier or lists presets", () => {
    const c = ctx(
      [vox, { id: "lead", name: "lead", instrument: "saw" }],
      "lead",
    );
    const voices = open(open(rootNodes(c), "voice", c), "voice:presets", c);
    const rows = open(voices, "voices:vocoder", c);
    expect(rows[0]).toEqual(
      expect.objectContaining({ command: "instrument vocoder" }),
    );
    const carrier = ctx(
      [vox, { id: "lead", name: "lead", instrument: "vocoder" }],
      "lead",
    );
    const presets = open(
      open(
        open(rootNodes(carrier), "voice", carrier),
        "voice:presets",
        carrier,
      ),
      "voices:vocoder",
      carrier,
    );
    expect(presets.map((row) => row.label.split(" ")[0])).toContain("talkbox");
    expect(presets.at(-1)!.label).toBe("source");
  });
});
