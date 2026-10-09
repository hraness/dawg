import { describe, expect, test } from "bun:test";
import { resolveInstrumentWord } from "../../core/instruments.ts";
import {
  MODAL_MALLETS,
  type ModalPresetName,
  modalSettings,
  normalizeModal,
} from "../../core/resonators.ts";
import { createScore, type TrackScore } from "../../core/score.ts";
import { DawgSdkError, modal } from "../../core/sdk/v1.ts";
import { findAgentTool } from "../agent/tools.ts";
import { applyModalCommand, parseModalCommand } from "../commands/modal.ts";
import { ModalBank } from "./dsp/modal.ts";
import { applyModalKnee, MODAL_KNEE } from "./resonators.ts";
import { renderScorePcm } from "./wav.ts";

const SR = 22_050;

function oneNote(preset: ModalPresetName, pitch: number): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [{ id: "m", name: "m", instrument: "modal", modal: { preset } }],
    notes: [
      {
        id: "n",
        trackId: "m",
        startTick: 0,
        durationTicks: 240,
        pitch,
        velocity: 0.8,
      },
    ],
  });
}

function tailStats(pcm: Int16Array): { seconds: number; endDb: number } {
  let peak = 0;
  for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  const window = Math.round(0.05 * SR) * 2;
  let end = 0;
  for (let i = pcm.length - window; i < pcm.length; i += 1)
    end = Math.max(end, Math.abs(pcm[i]!));
  return {
    seconds: pcm.length / 2 / SR,
    endDb: 20 * Math.log10((end + 1e-9) / peak),
  };
}

describe("modal one-shot tails reach the 30 s engine cap", () => {
  test("a bowl and a low gong ring past the 8 s loop cap to silence", () => {
    for (const [preset, pitch] of [
      ["bowl", 60],
      ["gong", 36],
    ] as const) {
      const { pcm } = renderScorePcm(oneNote(preset, pitch), {
        sampleRate: SR,
      });
      const { seconds, endDb } = tailStats(pcm);
      expect(seconds).toBeGreaterThan(15);
      expect(seconds).toBeLessThanOrEqual(30 + 2);
      // No hard cut: the last 50 ms sit at least 60 dB under the peak.
      expect(endDb).toBeLessThan(-60);
    }
  });

  test("a marimba stays short", () => {
    const { pcm } = renderScorePcm(oneNote("marimba", 60), { sampleRate: SR });
    expect(tailStats(pcm).seconds).toBeLessThan(6);
  });
});

describe("modal safety knee", () => {
  test("is exactly transparent below the knee", () => {
    const settings = modalSettings(normalizeModal({ preset: "glock" }));
    const bank = new ModalBank(
      settings,
      { hz: 1046.5, velocity: 0.8, start: 0, duration: 0.5, seed: "k" },
      SR,
      30,
    );
    const dry = new Float64Array(SR);
    bank.process(dry, 0, dry.length);
    let peak = 0;
    for (const v of dry) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThan(MODAL_KNEE);
    const limited = Float64Array.from(dry);
    applyModalKnee(limited, limited.length);
    expect(limited).toEqual(dry);
  });

  test("bounds loud sums under the ceiling", () => {
    const loud = Float64Array.from(
      { length: 2000 },
      (_, i) => Math.sin(i / 7) * 5,
    );
    applyModalKnee(loud, loud.length);
    for (const v of loud) expect(Math.abs(v)).toBeLessThan(1.4);
  });
});

function modalScore(preset: ModalPresetName = "vibes"): TrackScore {
  return createScore({
    bars: 1,
    tracks: [{ id: "m", name: "m", instrument: "modal", modal: { preset } }],
    notes: [],
  });
}

function run(value: TrackScore, command: string) {
  const parsed = parseModalCommand(command);
  if (!parsed) throw new Error(`not a modal command: ${command}`);
  return applyModalCommand(value, "m", parsed);
}

describe("modal mallet and hardness", () => {
  test("the last of mallet or hardness wins", () => {
    let value = run(modalScore("marimba"), "modal hardness 0.3").next!;
    value = run(value, "modal mallet brass").next!;
    expect(modalSettings(value.tracks[0]!.modal).hardness).toBe(
      MODAL_MALLETS.brass,
    );
    expect(value.tracks[0]!.modal?.hardness).toBeUndefined();
    value = run(value, "modal hardness 0.2").next!;
    expect(value.tracks[0]!.modal?.mallet).toBeUndefined();
    expect(modalSettings(value.tracks[0]!.modal).hardness).toBe(0.2);
  });
});

describe("modal off", () => {
  test("leaves the engine like string off; reset keeps it", () => {
    const reset = run(modalScore(), "modal reset");
    expect(reset.next?.tracks[0]!.instrument).toBe("modal");
    const off = run(modalScore(), "modal off");
    expect(off.ok).toBe(true);
    expect(off.next?.tracks[0]!.instrument).toBe("marimba");
    expect(off.next?.tracks[0]!.modal).toBeUndefined();
  });
});

describe("set_modal", () => {
  const tool = findAgentTool("set_modal")!;
  const context = {
    score: modalScore("vibes"),
    focusedTrackId: "m",
    revision: 1,
    newNoteId: (_trackId: string, index: number) => `n${index}`,
  };

  test("an empty call keeps a modal track's preset", () => {
    const plan = tool.plan({}, context);
    expect(plan.kind).toBe("score");
    if (plan.kind !== "score") return;
    expect(plan.operations).toEqual([
      {
        type: "updateTrack",
        trackId: "m",
        patch: { instrument: "modal", modal: { preset: "vibes" } },
      },
    ]);
  });

  test("mallet after a hardness override takes effect", () => {
    const first = tool.plan({ params: { hardness: 0.3 } }, context);
    if (first.kind !== "score") throw new Error("expected score");
    const patch = first.operations[0] as { patch: { modal: object } };
    const next = createScore({
      bars: 1,
      tracks: [
        { id: "m", name: "m", instrument: "modal", modal: patch.patch.modal },
      ],
      notes: [],
    });
    const plan = tool.plan({ mallet: "brass" }, { ...context, score: next });
    if (plan.kind !== "score") throw new Error("expected score");
    const modalField = (plan.operations[0] as { patch: { modal: object } })
      .patch.modal;
    expect(modalSettings(normalizeModal(modalField)).hardness).toBe(0.95);
  });
});

describe("SDK modal() validation", () => {
  test("rejects unknown mallets and bodies and out-of-range numbers", () => {
    expect(() => modal("vibes", { mallet: "steel" as never })).toThrow(
      DawgSdkError,
    );
    expect(() => modal("vibes", { body: "drumkit" })).toThrow(DawgSdkError);
    expect(() => modal("vibes", { ring: 400 })).toThrow(DawgSdkError);
    expect(() => modal("vibes", { hardness: -1 })).toThrow(DawgSdkError);
    expect(modal("vibes", { mallet: "yarn", ring: 3 })).toMatchObject({
      kind: "modal",
      preset: "vibes",
      mallet: "yarn",
      ring: 3,
    });
  });
});

describe("modal aliases", () => {
  test("common names reach their presets; bell stays legacy", () => {
    for (const [word, preset] of [
      ["steeldrum", "steelpan"],
      ["singingbowl", "bowl"],
      ["kettledrum", "timpani"],
      ["tubularbells", "chimes"],
    ] as const)
      expect(resolveInstrumentWord(word)).toMatchObject({
        instrument: "modal",
        preset,
      });
    expect(resolveInstrumentWord("bell")?.instrument).toBe("bell");
  });
});

describe("modal voice stealing", () => {
  function gongRoll(skipFirst: boolean): TrackScore {
    const notes = Array.from({ length: 33 }, (_, i) => ({
      id: `n${i}`,
      trackId: "m",
      startTick: i * 30,
      durationTicks: 1920,
      pitch: 48 + (i % 12),
      // Quiet, so the summed roll stays under the soft knee (linear).
      velocity: 0.05,
    })).filter((note) => !(skipFirst && note.id === "n0"));
    return createScore({
      tempoBpm: 120,
      bars: 2,
      tracks: [
        { id: "m", name: "m", instrument: "modal", modal: { preset: "gong" } },
      ],
      notes,
    });
  }

  test("a stolen voice fades out smoothly over 80 ms", () => {
    const full = renderScorePcm(gongRoll(false), { sampleRate: SR }).pcm;
    const rest = renderScorePcm(gongRoll(true), { sampleRate: SR }).pcm;
    // The 33rd onset (tick 960 = 1 s at 120 BPM) steals the first voice.
    const steal = SR;
    const diff = (frame: number) =>
      Math.abs(full[frame * 2]! - rest[frame * 2]!);
    const peak = (from: number, to: number) => {
      let max = 0;
      for (let f = from; f < to; f += 1) max = Math.max(max, diff(f));
      return max;
    };
    const ms = (n: number) => Math.round((n / 1000) * SR);
    const before = peak(steal - ms(10), steal);
    expect(before).toBeGreaterThan(20);
    // A 5 ms linear fade had gone in 5 ms; the raised cosine is near full
    // level 2 ms in, and the voice is gone 80 ms after the steal.
    expect(peak(steal + ms(3), steal + ms(6))).toBeGreaterThan(0.6 * before);
    expect(peak(steal + ms(82), steal + ms(300))).toBeLessThanOrEqual(1);
  });
});

describe("modal <body>", () => {
  test("a gamelan body word sets the body", () => {
    // 0.6.1: the gamelan words are presets now; a body word with no
    // preset of its own still sets the body.
    expect(parseModalCommand("modal saron")).toEqual({
      type: "modal-preset",
      preset: "saron",
    });
    expect(parseModalCommand("modal frame")).toEqual({
      type: "modal-set",
      values: { body: "frame" },
    });
    expect(parseModalCommand("modal nope")?.type).toBe("modal-usage");
  });
});
