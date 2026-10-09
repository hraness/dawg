/**
 * `/vocoder` (vocoder.md §8, §9 tests 4, 5 and 16): parsing, the one-step
 * carrier, Entry guidance, src resolution, provenance and help.
 */
import { describe, expect, test } from "bun:test";
import {
  createScore,
  removeTrack,
  updateTrack,
  type TrackInput,
} from "../../core/score.ts";
import { VOCODER_PARAMS } from "../../core/vocoder.ts";
import { HELP_SECTIONS, nearestCommand } from "./help.ts";
import { parseVocalCommand, runVocalCommand } from "./vocal.ts";
import {
  applyVocoderCommand,
  parseVocoderCommand,
  VOCODER_COMMAND_KEYS,
  vocodeTrack,
} from "./vocoder.ts";

const vox: TrackInput = {
  id: "vox",
  name: "Lead Vox",
  instrument: "sampler",
  sampler: {
    mode: "oneshot",
    voices: {
      vox: { src: "tracks/vox/samples/vox.wav", license: "CC-BY-4.0" },
    },
  },
};

function score(tracks: TrackInput[]) {
  return createScore({ tempoBpm: 120, bars: 4, tracks, notes: [] });
}

describe("/vocoder parse", () => {
  test("presets, params, src, reset, off", () => {
    expect(parseVocoderCommand("vocoder")).toEqual({ type: "vocoder-show" });
    expect(parseVocoderCommand("/vocoder talkbox")).toEqual({
      type: "vocoder-set",
      preset: "talkbox",
      values: {},
    });
    expect(parseVocoderCommand("vocoder formant +3")).toEqual({
      type: "vocoder-set",
      values: { formant: 3 },
    });
    expect(parseVocoderCommand("vocoder gate auto freeze on")).toEqual({
      type: "vocoder-set",
      values: { gate: "auto", freeze: true },
    });
    expect(parseVocoderCommand("vocoder formant reset")).toEqual({
      type: "vocoder-set",
      values: { formant: null },
    });
    expect(parseVocoderCommand("vocoder src Robot")).toEqual({
      type: "vocoder-set",
      src: "Robot",
      values: {},
    });
    expect(parseVocoderCommand("vocoder off")?.type).toBe("vocoder-off");
    expect(parseVocoderCommand("vocoder reset")?.type).toBe("vocoder-reset");
    expect(parseVocoderCommand("vocoder bands 41")?.type).toBe("vocoder-usage");
    expect(parseVocoderCommand("vocoder bands 3")?.type).toBe("vocoder-usage");
    expect(parseVocoderCommand("vocoder formant 25")?.type).toBe(
      "vocoder-usage",
    );
    const typo = parseVocoderCommand("vocoder bandz 8");
    expect(typo?.type === "vocoder-usage" && typo.message).toContain(
      "did you mean bands",
    );
    expect(parseVocoderCommand("vocal vocoder")).toBeUndefined();
  });

  test("every VOCODER_PARAMS key is a /vocoder key", () => {
    expect([...VOCODER_COMMAND_KEYS]).toEqual(Object.keys(VOCODER_PARAMS));
    for (const key of VOCODER_COMMAND_KEYS) {
      const spec = VOCODER_PARAMS[key]!;
      const word =
        spec.kind === "number"
          ? String(spec.default)
          : spec.kind === "enum"
            ? spec.values[0]!
            : "on";
      expect(parseVocoderCommand(`vocoder ${key} ${word}`)?.type).toBe(
        "vocoder-set",
      );
    }
  });
});

describe("/vocoder apply", () => {
  test("on a vocal: one new carrier track, the vocal muted, licence echoed", () => {
    const s = score([vox]);
    const result = applyVocoderCommand(s, "vox", { type: "vocoder-show" });
    expect(result.ok).toBe(true);
    expect(result.next!.tracks).toHaveLength(2);
    const carrier = result.next!.tracks[1]!;
    expect(carrier.instrument).toBe("vocoder");
    expect(carrier.name).toBe("Lead Vox vocoder");
    expect(carrier.vocoder).toEqual({
      src: "vox",
      preset: "classic",
      follow: "drone",
    });
    expect(result.next!.tracks[0]!.muted).toBe(true);
    expect(result.message).toContain("CC-BY-4.0");
    expect(result.message).toContain("tap ignores mute");
    expect(result.trackId).toBe(carrier.id);
  });

  test("follows the song's chords when it has harmonic tracks", () => {
    const s = createScore({
      tempoBpm: 120,
      bars: 4,
      tracks: [vox, { id: "keys", name: "keys", instrument: "piano" }],
      notes: [
        {
          id: "n1",
          trackId: "keys",
          startTick: 0,
          durationTicks: 480,
          pitch: 60,
          velocity: 0.8,
        },
      ],
    });
    const result = vocodeTrack(s, "vox", { preset: "talkbox" });
    expect(result.next!.tracks.at(-1)!.vocoder).toEqual({
      src: "vox",
      preset: "talkbox",
      follow: "chords",
    });
  });

  test("Entry guidance: nothing to vocode changes nothing", () => {
    const s = score([{ id: "lead", name: "lead", instrument: "supersaw" }]);
    const result = applyVocoderCommand(s, "lead", { type: "vocoder-show" });
    expect(result.ok).toBe(true);
    expect(result.next).toBeUndefined();
    expect(result.message).toContain("no voice to vocode");
    expect(result.message).toContain("/sample <file.wav>");
  });

  test("on a synth with one vocal: drives it from the vocal", () => {
    const s = score([
      vox,
      { id: "lead", name: "lead", instrument: "supersaw" },
    ]);
    const result = applyVocoderCommand(s, "lead", { type: "vocoder-show" });
    expect(result.next!.tracks[1]!.vocoder).toEqual({ src: "vox" });
    expect(result.next!.tracks[1]!.instrument).toBe("supersaw");
  });

  test("src by slug, preset words win, self and unknown rejected", () => {
    const s = score([
      vox,
      {
        id: "robot",
        name: "robot",
        instrument: "sampler",
        sampler: vox.sampler,
      },
      { id: "lead", name: "lead", instrument: "supersaw" },
    ]);
    const bySlug = applyVocoderCommand(
      s,
      "lead",
      parseVocoderCommand("vocoder src lead-vox")!,
    );
    expect(bySlug.next!.tracks[2]!.vocoder?.src).toBe("vox");
    const preset = applyVocoderCommand(
      bySlug.next!,
      "lead",
      parseVocoderCommand("vocoder robot")!,
    );
    expect(preset.next!.tracks[2]!.vocoder).toEqual({
      src: "vox",
      preset: "robot",
    });
    const named = applyVocoderCommand(
      preset.next!,
      "lead",
      parseVocoderCommand("vocoder src robot")!,
    );
    expect(named.next!.tracks[2]!.vocoder?.src).toBe("robot");
    expect(
      applyVocoderCommand(s, "lead", parseVocoderCommand("vocoder src lead")!)
        .ok,
    ).toBe(false);
    expect(
      applyVocoderCommand(s, "lead", parseVocoderCommand("vocoder src nope")!)
        .message,
    ).toContain("names no track");
  });

  test("cycles rejected; off, null and removeTrack drop", () => {
    const s = score([
      { ...vox, vocoder: { src: "lead" } },
      { id: "lead", name: "lead", instrument: "supersaw" },
    ]);
    const cycle = applyVocoderCommand(
      s,
      "lead",
      parseVocoderCommand("vocoder src vox")!,
    );
    expect(cycle.ok).toBe(false);
    expect(cycle.message).toContain("cycle");
    const set = applyVocoderCommand(
      score([vox, { id: "lead", name: "lead", instrument: "supersaw" }]),
      "lead",
      parseVocoderCommand("vocoder src vox formant 3")!,
    ).next!;
    const off = applyVocoderCommand(set, "lead", { type: "vocoder-off" });
    expect(off.next!.tracks[1]!.vocoder).toBeUndefined();
    expect(
      updateTrack(set, "lead", { vocoder: null }).tracks[1]!.vocoder,
    ).toBeUndefined();
    const removed = removeTrack(set, "vox");
    expect(removed.tracks[0]!.vocoder).toEqual({ formant: 3 });
  });

  test("/vocal vocoder is the same command; /help lists /vocoder", async () => {
    const vocal = parseVocalCommand("/vocal vocoder talkbox");
    expect(vocal?.kind).toBe("verb");
    const s = score([
      vox,
      { id: "lead", name: "lead", instrument: "supersaw" },
    ]);
    const result = await runVocalCommand(vocal!, {
      score: s,
      trackId: "lead",
      cwd: "/tmp",
    });
    // The one voice in the song becomes the source.
    expect(result.next!.tracks[1]!.vocoder).toEqual({
      src: "vox",
      preset: "talkbox",
    });
    // On the vocal it makes the carrier and names it, so main.ts focuses it.
    const made = await runVocalCommand(vocal!, {
      score: score([vox]),
      trackId: "vox",
      cwd: "/tmp",
    });
    expect(made.trackId).toBe("lead-vox-vocoder");
    const commands = HELP_SECTIONS.flatMap((group) =>
      group.entries.map((entry) => entry.command),
    );
    expect(commands.some((command) => command.startsWith("/vocoder"))).toBe(
      true,
    );
    expect(nearestCommand("vocodr")).toContain("vocoder");
  });
});

describe("/vocoder on a vocal (review fixes)", () => {
  const apply = (text: string, start = score([vox]), id = "vox") =>
    applyVocoderCommand(start, id, parseVocoderCommand(text)!);

  test("/vocoder talkbox and /vocoder formant 3 make a carrier", () => {
    for (const [text, check] of [
      ["vocoder talkbox", { preset: "talkbox" }],
      ["vocoder formant 3", { formant: 3 }],
      ["vocoder robot", { preset: "robot" }],
    ] as const) {
      const result = apply(text);
      expect(result.ok).toBe(true);
      const next = result.next!;
      expect(next.tracks).toHaveLength(2);
      const vocal = next.tracks.find((t) => t.id === "vox")!;
      expect(vocal.muted).toBe(true);
      expect(vocal.vocoder).toBeUndefined();
      const carrier = next.tracks.find((t) => t.id === result.trackId)!;
      expect(carrier.instrument).toBe("vocoder");
      expect(carrier.vocoder).toMatchObject({ src: "vox", ...check });
    }
  });

  test("a second /vocoder shows the existing carrier; /vocoder new makes another", () => {
    const first = apply("vocoder");
    const again = apply("vocoder", first.next!);
    expect(again.next).toBeUndefined();
    expect(again.trackId).toBe(first.trackId);
    expect(again.message).toContain("preset");
    // Settings typed on the vocal go to its carrier.
    const tuned = apply("vocoder formant 3", first.next!);
    expect(tuned.trackId).toBe(first.trackId);
    expect(
      tuned.next!.tracks.find((t) => t.id === first.trackId)!.vocoder?.formant,
    ).toBe(3);
    expect(tuned.next!.tracks.find((t) => t.id === "vox")!.vocoder).toBe(
      undefined,
    );
    const second = apply("vocoder new", first.next!);
    expect(second.next!.tracks).toHaveLength(3);
    const made = second.next!.tracks.find((t) => t.id === second.trackId)!;
    expect(made.name).toBe("Lead Vox vocoder 2");
  });

  test("/vocoder src takes a multi-word name, quoted or not", () => {
    expect(parseVocoderCommand("vocoder src Lead Vox formant 3")).toEqual({
      type: "vocoder-set",
      src: "Lead Vox",
      values: { formant: 3 },
    });
    expect(parseVocoderCommand('vocoder src "Lead Vox" mix 0.5')).toEqual({
      type: "vocoder-set",
      src: "Lead Vox",
      values: { mix: 0.5 },
    });
    const start = score([vox, { id: "pad", instrument: "saw" }]);
    const result = apply("vocoder src Lead Vox formant 3", start, "pad");
    expect(result.ok).toBe(true);
    expect(
      result.next!.tracks.find((t) => t.id === "pad")!.vocoder,
    ).toMatchObject({ src: "vox", formant: 3 });
  });

  test("a drone preset sits on the key's tonic", () => {
    const keyed = createScore({
      tempoBpm: 120,
      bars: 4,
      key: "C major",
      tracks: [vox],
      notes: [],
    } as never);
    const result = vocodeTrack(keyed, "vox", { preset: "robot" });
    const carrier = result.next!.tracks.find((t) => t.id === result.trackId)!;
    expect(carrier.vocoder?.root).toBe(48);
  });

  test("every command the Entry guidance names parses", () => {
    const empty = score([{ id: "pad", instrument: "saw" }]);
    const message = applyVocoderCommand(empty, "pad", {
      type: "vocoder-show",
    }).message;
    for (const match of message.matchAll(/\/(vocal \w+|vocoder \w+|sample)/g)) {
      const word = match[1]!;
      if (word.startsWith("vocal "))
        expect(parseVocalCommand(`/${word}`)?.kind).toBe("verb");
      else if (word.startsWith("vocoder "))
        expect(parseVocoderCommand(word)).toBeDefined();
    }
  });
});

describe("vocoder agent tools", () => {
  const context = (s: ReturnType<typeof score>, focus = "lead") => ({
    score: s,
    focusedTrackId: focus,
    revision: 1,
    newNoteId: (trackId: string, index: number) => `${trackId}-${index}`,
  });

  test("set_vocoder params keys equal VOCODER_PARAMS; sets and resets", async () => {
    // tools.ts first: it spreads voice-tools.ts, which imports it back.
    const { AGENT_TOOLS } = await import("../agent/tools.ts");
    const { VOCODER_TOOLS, VOCODER_TOOL_PARAM_KEYS } =
      await import("../agent/voice-tools.ts");
    const { PREVIEWABLE_TOOLS } = await import("../agent/preview-tool.ts");
    expect([...VOCODER_TOOL_PARAM_KEYS]).toEqual(Object.keys(VOCODER_PARAMS));
    expect(AGENT_TOOLS.map((tool) => tool.name)).toContain("set_vocoder");
    expect(PREVIEWABLE_TOOLS).toContain("set_vocoder");
    const tool = VOCODER_TOOLS.find((t) => t.name === "set_vocoder")!;
    const schema = tool.parameters.properties as Record<
      string,
      { description?: string }
    >;
    for (const key of Object.keys(VOCODER_PARAMS))
      expect(schema.params!.description).toContain(key);
    const s = score([
      vox,
      { id: "lead", name: "lead", instrument: "supersaw" },
    ]);
    const plan = tool.plan(
      { preset: "talkbox", params: { formant: 3, gate: "auto" } },
      context(s),
    );
    expect(plan.kind).toBe("score");
    if (plan.kind !== "score") return;
    expect(plan.operations[0]).toEqual({
      type: "updateTrack",
      trackId: "lead",
      patch: {
        vocoder: { src: "vox", preset: "talkbox", formant: 3, gate: "auto" },
      },
    });
    expect(plan.summary).toContain("CC-BY-4.0");
    expect(() => tool.plan({ params: { bands: 99 } }, context(s))).toThrow();
  });

  test("vocode creates the carrier and echoes the licence; Entry without a voice", async () => {
    await import("../agent/tools.ts");
    const { VOCODER_TOOLS } = await import("../agent/voice-tools.ts");
    const vocode = VOCODER_TOOLS.find((t) => t.name === "vocode")!;
    const s = score([vox]);
    const plan = vocode.plan(
      { src: "vox", preset: "robot" },
      context(s, "vox"),
    );
    if (plan.kind !== "score") throw new Error(plan.kind);
    expect(plan.operations[0]!.type).toBe("addTrack");
    expect(plan.operations[1]).toEqual({
      type: "updateTrack",
      trackId: "vox",
      patch: { muted: true },
    });
    expect(plan.summary).toContain("CC-BY-4.0");
    const setVocoder = VOCODER_TOOLS.find((t) => t.name === "set_vocoder")!;
    const lone = score([{ id: "lead", name: "lead", instrument: "supersaw" }]);
    expect(() => setVocoder.plan({}, context(lone))).toThrow(
      "no voice to vocode",
    );
  });
});
