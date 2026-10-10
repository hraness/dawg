import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { isStageable } from "./audition.ts";
import { rootNodes, type MenuContext, type MenuNode } from "./menu.ts";

const SHA = "b".repeat(64);
function context(): MenuContext {
  return {
    score: createScore({
      tempoBpm: 120,
      bars: 8,
      tracks: [
        {
          id: "vox",
          name: "vox",
          instrument: "vocal",
          clips: [
            {
              id: "hook",
              src: "tracks/vox/samples/hook.wav",
              sha256: SHA,
              startTick: 4 * 4 * 480,
              gain: 0.5,
            },
          ],
        },
      ],
      notes: [
        {
          id: "n1",
          trackId: "vox",
          startTick: 0,
          durationTicks: 480,
          pitch: 60,
          velocity: 0.8,
          lyric: "la",
        },
      ],
    } as never),
    trackId: "vox",
    playing: false,
    grid: "1/16",
    grids: ["1/16"],
    clickOn: false,
    countInBars: 1,
  };
}
function open(nodes: MenuNode[], id: string, ctx: MenuContext): MenuNode[] {
  const node = nodes.find((n) => n.kind === "menu" && n.id === id);
  if (!node || node.kind !== "menu") throw new Error(`no menu ${id}`);
  return node.build(ctx);
}

describe("Voice › clips and lyrics", () => {
  test("clip rows run /clip commands that stage for A/B", () => {
    const ctx = context();
    const voice = open(rootNodes(ctx), "voice", ctx);
    const clips = open(voice, "voice:clips", ctx);
    expect(clips.map((n) => n.label)).toEqual([
      "hook",
      "import a file",
      "vocals stem",
      "setup",
    ]);
    const rows = open(clips, "clip:hook", ctx);
    const gain = rows.find((n) => n.label === "gain")!;
    expect(gain.kind).toBe("number");
    if (gain.kind !== "number") return;
    expect(gain.value).toBeCloseTo(-6, 1);
    const louder = gain.command(gain.step(gain.value!, 1));
    expect(louder).toBe("/clip hook gain -5");
    expect(isStageable(louder)).toBe(true);
    expect(gain.reset).toBe("/clip hook gain 0");
    const repeat = rows.find((n) => n.label === "repeat")!;
    if (repeat.kind === "entry")
      expect(repeat.command("2 to 32")).toBe("/clip hook repeat every 2 to 32");
    const move = rows.find((n) => n.label === "move to bar")!;
    if (move.kind === "entry") expect(move.value).toBe("5");
  });

  test("lyrics row shows the sung text and runs /lyrics", () => {
    const ctx = context();
    const voice = open(rootNodes(ctx), "voice", ctx);
    const lyrics = voice.find((n) => n.label === "lyrics")!;
    if (lyrics.kind === "menu") expect(lyrics.detail).toBe("la");
    const rows = open(voice, "voice:lyrics", ctx);
    const entry = rows[0]!;
    if (entry.kind === "entry")
      expect(entry.command("hel-lo")).toBe("/lyrics hel-lo");
  });

  test("Voice › voice presets › vocal sets the vocal instrument", () => {
    const ctx = context();
    const voice = open(rootNodes(ctx), "voice", ctx);
    const voices = open(voice, "voice:presets", ctx);
    const vocal = voices[0]!;
    expect(vocal.label.startsWith("vocal")).toBe(true);
    if (vocal.kind === "action") {
      expect(vocal.command).toBe("instrument vocal");
      expect(isStageable(vocal.command)).toBe(true);
    }
  });
});
