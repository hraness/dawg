import { describe, expect, test } from "bun:test";
import { createScore, removeTrack } from "../../core/score.ts";
import {
  applyAutotuneCommand,
  nextAutotune,
  parseAutotuneCommand,
} from "./autotune.ts";
import { builtinPitchEngine } from "../audio/autotune-engine.ts";
import { setPitchEngine } from "../audio/autotune.ts";
import { parseTuningCommand } from "./tuning.ts";
import { VOCAL_VERBS, parseVocalCommand } from "./vocal.ts";

const score = createScore({
  bars: 2,
  tempoBpm: 120,
  tracks: [
    { id: "vox", name: "vox", instrument: "saw" },
    { id: "melody", name: "melody", instrument: "saw" },
  ],
  notes: [],
});

describe("/autotune parse", () => {
  test("bare, presets, fields and off", () => {
    expect(parseAutotuneCommand("/autotune")).toEqual({
      type: "autotune-show",
    });
    expect(parseAutotuneCommand("/autotune hard")).toEqual({
      type: "autotune-set",
      preset: "hard",
      values: {},
    });
    expect(parseAutotuneCommand("autotune pop speed 35ms relax 40%")).toEqual({
      type: "autotune-set",
      preset: "pop",
      values: { speed: 35, relax: 0.4 },
    });
    expect(parseAutotuneCommand("/autotune to notes melody speed 0")).toEqual({
      type: "autotune-set",
      values: { to: "notes", from: "melody", speed: 0 },
    });
    expect(parseAutotuneCommand("/autotune key D bayati flex 30")).toEqual({
      type: "autotune-set",
      values: { key: "D bayati", flex: 30 },
    });
    expect(parseAutotuneCommand("/autotune speed off")).toEqual({
      type: "autotune-set",
      values: { speed: null },
    });
    expect(parseAutotuneCommand("/autotune off")?.type).toBe("autotune-off");
    expect(parseAutotuneCommand("/autotune presets")?.type).toBe(
      "autotune-list",
    );
    expect(parseAutotuneCommand("/automate x")).toBeUndefined();
  });

  test("typos suggest a field and bad values name the range", () => {
    const typo = parseAutotuneCommand("/autotune sped 10");
    expect(typo?.type).toBe("autotune-usage");
    expect(JSON.stringify(typo)).toContain("did you mean speed");
    expect(
      JSON.stringify(parseAutotuneCommand("/autotune to bogus")),
    ).toContain("scale chromatic chord notes");
  });

  test("/tune stays tuning and hints at /autotune", () => {
    expect(parseTuningCommand("/tune 19edo")?.type).toBe("tuning-set");
    const hint = parseAutotuneCommand("/tune hard");
    expect(hint?.type).toBe("autotune-usage");
    expect(JSON.stringify(hint)).toContain("/autotune hard");
    expect(parseAutotuneCommand("/tune 19edo")).toBeUndefined();
  });
});

describe("/autotune apply", () => {
  test("one revision per command, shortest stored form", () => {
    const hard = applyAutotuneCommand(
      score,
      "vox",
      parseAutotuneCommand("/autotune hard")!,
    );
    expect(hard.ok).toBe(true);
    expect(hard.kind).toBe("score.autotune");
    const vox = hard.next!.tracks.find((t) => t.id === "vox")!;
    expect(vox.autotune).toEqual({ preset: "hard" });
    expect(hard.message).toContain("chromatic");
    const off = applyAutotuneCommand(
      hard.next!,
      "vox",
      parseAutotuneCommand("/autotune off")!,
    );
    expect(off.next!.tracks.find((t) => t.id === "vox")!.autotune).toBe(
      undefined,
    );
  });

  test("from names a track; a missing one fails without a change", () => {
    const good = applyAutotuneCommand(
      score,
      "vox",
      parseAutotuneCommand("/autotune guided from melody")!,
    );
    expect(good.ok).toBe(true);
    expect(
      good.next!.tracks.find((t) => t.id === "vox")!.autotune,
    ).toMatchObject({ preset: "guided", from: "melody" });
    const bad = applyAutotuneCommand(
      score,
      "vox",
      parseAutotuneCommand("/autotune to notes nowhere")!,
    );
    expect(bad.ok).toBe(false);
    expect(bad.next).toBeUndefined();
  });

  test("out-of-range values are refused, not clamped", () => {
    const bad = applyAutotuneCommand(
      score,
      "vox",
      parseAutotuneCommand("/autotune speed 9000")!,
    );
    expect(bad.ok).toBe(false);
  });

  test("nextAutotune: preset switch keeps overrides, reset keeps preset", () => {
    const base = { preset: "pop", speed: 40 } as const;
    expect(
      nextAutotune(base, {
        type: "autotune-set",
        preset: "gentle",
        values: {},
      }),
    ).toEqual({ preset: "gentle", speed: 40 });
    expect(nextAutotune(base, { type: "autotune-reset" })).toEqual({
      preset: "pop",
    });
    expect(
      nextAutotune(
        { preset: "pop", to: "notes", from: "melody" },
        { type: "autotune-set", values: { to: "chord" } },
      ),
    ).toEqual({ preset: "pop", to: "chord" });
  });

  test("/vocal autotune is the same command", () => {
    expect(VOCAL_VERBS.some((verb) => verb.verb === "autotune")).toBe(true);
    expect(parseVocalCommand("/vocal autotune hard")).toBeDefined();
  });
});

describe("/autotune in /help", () => {
  test("listed in the Voice section and typo-matched", async () => {
    const { helpTopicLines, nearestCommand } = await import("./help.ts");
    expect(helpTopicLines("voice")!.some((l) => l.startsWith("autotune"))).toBe(
      true,
    );
    expect(nearestCommand("/autotne")).toBe("/autotune");
  });
});

describe("/autotune units, presets and receipts (review fixes)", () => {
  const set = (text: string) => parseAutotuneCommand(text);
  test("time fields read like /glide: bare ms, ms and s convert", () => {
    expect(set("autotune glide 40")).toEqual({
      type: "autotune-set",
      values: { glide: 0.04 },
    });
    expect(set("autotune glide 80ms")).toEqual({
      type: "autotune-set",
      values: { glide: 0.08 },
    });
    expect(set("autotune speed 0.2s")).toEqual({
      type: "autotune-set",
      values: { speed: 200 },
    });
    expect(set("autotune hold 0.5s")).toEqual({
      type: "autotune-set",
      values: { hold: 500 },
    });
    expect(JSON.stringify(set("autotune glide 0.04"))).toContain(
      "a bare number is ms",
    );
    expect(JSON.stringify(set("autotune speed 20st"))).toContain(
      "takes ms or s",
    );
    expect(JSON.stringify(set("autotune glide 900"))).toContain("0..500 ms");
    expect(JSON.stringify(set("autotune relax 2hz"))).toContain("takes no hz");
  });

  test("two presets say one at a time", () => {
    const parsed = set("autotune hard robot");
    expect(parsed?.type).toBe("autotune-usage");
    expect(JSON.stringify(parsed)).toContain("one preset at a time");
    expect(JSON.stringify(parsed)).not.toContain("did you mean");
  });

  test("guided and locked apply in one step; no notes names a guide", () => {
    const withNotes = createScore({
      bars: 2,
      tempoBpm: 120,
      tracks: [
        { id: "vox", name: "vox", instrument: "saw" },
        { id: "melody", name: "melody", instrument: "saw" },
      ],
      notes: [
        {
          id: "n1",
          trackId: "melody",
          pitch: 62,
          startTick: 0,
          durationTicks: 480,
          velocity: 0.8,
        },
      ],
    });
    for (const preset of ["guided", "locked"]) {
      const result = applyAutotuneCommand(
        withNotes,
        "vox",
        parseAutotuneCommand(`autotune ${preset}`)!,
      );
      expect(result.ok).toBe(true);
      expect(result.message).toContain(`try autotune ${preset} from melody`);
    }
    const off = applyAutotuneCommand(
      withNotes,
      "vox",
      parseAutotuneCommand("autotune guided from melody")!,
    );
    expect(off.ok).toBe(true);
    const next = off.next!;
    const back = applyAutotuneCommand(
      next,
      "vox",
      parseAutotuneCommand("autotune from off")!,
    );
    expect(back.ok).toBe(true);
    expect(back.next!.tracks[0]!.autotune).toEqual({ preset: "guided" });
  });

  test("without a pitch engine the receipt says audio plays untuned", () => {
    // The merged pitch engine is installed by default; none is the fallback.
    expect(
      applyAutotuneCommand(score, "vox", parseAutotuneCommand("autotune hard")!)
        .message,
    ).not.toContain("audio plays untuned");
    setPitchEngine(undefined);
    try {
      const result = applyAutotuneCommand(
        score,
        "vox",
        parseAutotuneCommand("autotune hard")!,
      );
      expect(result.message).toContain("audio plays untuned");
    } finally {
      setPitchEngine(builtinPitchEngine);
    }
  });

  test("removing the from track keeps to and the preset", () => {
    const tuned = applyAutotuneCommand(
      score,
      "vox",
      parseAutotuneCommand("autotune locked from melody")!,
    ).next!;
    const dropped = removeTrack(tuned, "melody");
    expect(dropped.tracks[0]!.autotune).toEqual({ preset: "locked" });
  });
});
