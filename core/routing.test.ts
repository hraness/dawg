import { describe, expect, test } from "bun:test";
import {
  notesDigestInputs,
  registerTrackRefs,
  resolveTrackRef,
  routingOrder,
  type TrackRef,
} from "./routing.ts";
import {
  addNote,
  applyScoreOperation,
  createScore,
  removeTrack,
  scoreFromJSON,
  ScoreValidationError,
  updateNote,
  updateTrack,
  type AudioClip,
  type Take,
  type Track,
} from "./score.ts";

const SHA = "a".repeat(64);

const take: Take = {
  name: "take-1",
  src: "tracks/vox/takes/take-1.wav",
  sha256: SHA,
  startTick: 0,
  offset: 0.25,
  latency: 0.012,
  latencyAssumed: true,
  ppm: 12.5,
  fit: 0.9,
  warn: "clipped once",
  nudge: -4,
  inTick: 0,
  outTick: 960,
};

const clip: AudioClip = {
  id: "c1",
  src: "tracks/vox/samples/verse.wav",
  sha256: SHA,
  startTick: 480,
  offset: 1.5,
  dur: 4,
  gain: 0.8,
  fadeInTime: 0.01,
  fadeTime: 0.2,
  rev: true,
  take: "take-1",
  mute: true,
  text: "hello world",
  say: {
    engine: "say",
    voice: "Samantha",
    rate: 180,
    license: "own-attested",
    cuts: [0, 0.4],
    vowels: [0.05, 0.4],
    unvoiced: [1],
    oct: -1,
    soft: 0.5,
    sung: { src: "tracks/vox/voice/abcd1234-sung.wav", sha256: SHA, key: "k1" },
  },
};

function vocalScore(clips: readonly unknown[], takes?: readonly unknown[]) {
  return createScore({
    tracks: [
      {
        id: "vox",
        instrument: "sine",
        clips: clips as AudioClip[],
        ...(takes ? { takes: takes as Take[] } : {}),
      },
    ],
  });
}

function rejects(build: () => unknown, key: string) {
  let error: unknown;
  try {
    build();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ScoreValidationError);
  expect((error as Error).message).toContain(key);
}

describe("0.7 clip, take and lyric shapes", () => {
  test("a full clip and take round trip through JSON deep-equal", () => {
    const score = vocalScore([clip], [take]);
    const json = score.toJSON();
    expect(score.tracks[0]!.clips).toEqual([clip]);
    expect(score.tracks[0]!.takes).toEqual([take]);
    const again = scoreFromJSON(JSON.parse(JSON.stringify(json)));
    expect(again.toJSON()).toEqual(json);
    expect(JSON.stringify(again.toJSON())).toBe(JSON.stringify(json));
  });

  test("absent, null and empty fields leave the track bytes unchanged", () => {
    const plain = createScore({ tracks: [{ id: "vox", instrument: "sine" }] });
    const empty = createScore({
      tracks: [{ id: "vox", instrument: "sine", clips: [], takes: [] }],
    });
    expect(JSON.stringify(empty.toJSON())).toBe(JSON.stringify(plain.toJSON()));
    expect("clips" in plain.tracks[0]!).toBe(false);
  });

  test("each validation error names its key", () => {
    const at = (patch: Record<string, unknown>) => () =>
      vocalScore([{ ...clip, take: undefined, ...patch }]);
    rejects(at({ src: "../escape.wav" }), "clip c1 src");
    rejects(at({ src: "/abs.wav" }), "clip c1 src");
    rejects(at({ sha256: "A".repeat(64) }), "clip c1 sha256");
    rejects(at({ sha256: "abc" }), "clip c1 sha256");
    rejects(at({ offset: 500, dur: 30 }), "offset + dur");
    rejects(at({ dur: 0 }), "clip c1 dur");
    rejects(at({ gain: 5 }), "clip c1 gain");
    rejects(at({ fadeTime: 3 }), "clip c1 fadeTime");
    rejects(
      at({ dur: 0.5, fadeInTime: 0.3, fadeTime: 0.3 }),
      "fadeInTime + fadeTime",
    );
    rejects(at({ take: "nope" }), "clip c1 take nope");
    rejects(at({ startTick: -1 }), "clip c1 startTick");
    rejects(at({ text: "x".repeat(2001) }), "clip c1 text");
    rejects(() => vocalScore([clip, clip], [take]), "clip id c1 is duplicated");
    const say = (patch: Record<string, unknown>) =>
      at({ say: { ...clip.say, sung: undefined, ...patch } });
    rejects(say({ cuts: [0], vowels: [0, 1] }), "same length");
    rejects(say({ cuts: [0.4, 0.4], vowels: [0.5, 0.6] }), "say.cuts");
    rejects(say({ cuts: [0, 0.6], vowels: [0.1, 0.5] }), "say.cuts[1]");
    rejects(say({ engine: "cloud" }), "say.engine");
    rejects(say({ voice: "v".repeat(65) }), "say.voice");
    rejects(say({ rate: 20 }), "say.rate");
    rejects(say({ oct: 4 }), "say.oct");
    rejects(say({ unvoiced: [2] }), "say.unvoiced");
    rejects(say({ sung: { src: "a.wav", sha256: "x", key: "k" } }), "sha256");
    const badTake = (patch: Record<string, unknown>) => () =>
      vocalScore([], [{ ...take, ...patch }]);
    rejects(badTake({ inTick: 960, outTick: 960 }), "take take-1 inTick");
    rejects(badTake({ sha256: "0" }), "take take-1 sha256");
    rejects(badTake({ nudge: 300 }), "take take-1 nudge");
    rejects(badTake({ ppm: 2000 }), "take take-1 ppm");
    rejects(badTake({ src: "../x.wav" }), "take take-1 src");
    rejects(() => vocalScore([], [take, take]), "take name take-1");
  });

  test("track limits", () => {
    const many = Array.from({ length: 257 }, (_, index) => ({
      ...clip,
      take: undefined,
      id: `c${index}`,
    }));
    rejects(() => vocalScore(many), "at most 256 clips");
  });

  test("lyrics set, validate and clear through updateNote", () => {
    const score = addNote(
      createScore({ tracks: [{ id: "vox", instrument: "sine" }] }),
      {
        id: "n1",
        trackId: "vox",
        startTick: 0,
        durationTicks: 480,
        pitch: 60,
        velocity: 0.8,
      },
    );
    const sung = updateNote(score, "n1", { lyric: "la" });
    expect(sung.notes[0]!.lyric).toBe("la");
    expect(scoreFromJSON(sung.toJSON()).notes[0]!.lyric).toBe("la");
    const cleared = updateNote(sung, "n1", { lyric: null });
    expect("lyric" in cleared.notes[0]!).toBe(false);
    expect(JSON.stringify(cleared.toJSON())).toBe(
      JSON.stringify(score.toJSON()),
    );
    rejects(() => updateNote(score, "n1", { lyric: "la la" }), "lyric");
    rejects(() => updateNote(score, "n1", { lyric: "x".repeat(33) }), "lyric");
  });

  test("setClips replaces and clears; updateTrack patches takes", () => {
    const base = createScore({ tracks: [{ id: "vox", instrument: "sine" }] });
    const plain = { ...clip, take: undefined };
    delete (plain as { take?: string }).take;
    const placed = applyScoreOperation(base, {
      type: "setClips",
      trackId: "vox",
      clips: [plain],
    });
    expect(placed.tracks[0]!.clips).toEqual([plain]);
    const cleared = applyScoreOperation(placed, {
      type: "setClips",
      trackId: "vox",
      clips: null,
    });
    expect(JSON.stringify(cleared.toJSON())).toBe(
      JSON.stringify(base.toJSON()),
    );
    const withTakes = updateTrack(base, "vox", { takes: [take] });
    expect(withTakes.tracks[0]!.takes).toEqual([take]);
    expect(
      updateTrack(withTakes, "vox", { takes: null }).tracks[0]!.takes,
    ).toBe(undefined);
  });
});

// Test-only reference field: a track named "follow:<kind>:<id>" references
// <id>. Real lanes register vocoder.src, autotune.from and harmony.guide.
function nameRefs(track: Track): readonly TrackRef[] {
  const match = /^follow:(audio|notes):(.+)$/.exec(track.name);
  return match
    ? [{ trackId: match[2]!, kind: match[1] as TrackRef["kind"] }]
    : [];
}
registerTrackRefs("test:name", {
  refs: nameRefs,
  drop: (track, removedId) =>
    nameRefs(track).some((ref) => ref.trackId === removedId)
      ? { ...track, name: track.id }
      : track,
});

describe("core/routing", () => {
  const routed = (names: Record<string, string>) =>
    createScore({
      tracks: Object.entries(names).map(([id, name]) => ({
        id,
        name,
        instrument: "sine",
      })),
    });

  test("resolveTrackRef finds by id, then by name slug", () => {
    const score = routed({ t1: "Lead Vox", t2: "Pad" });
    expect(resolveTrackRef(score, "t2")?.id).toBe("t2");
    expect(resolveTrackRef(score, "lead-vox")?.id).toBe("t1");
    expect(resolveTrackRef(score, "Lead Vox")?.id).toBe("t1");
    expect(resolveTrackRef(score, "nope")).toBeUndefined();
  });

  test("routingOrder renders audio sources first and ignores notes edges", () => {
    const score = routed({
      carrier: "follow:audio:mod",
      mod: "voice",
      tuned: "follow:notes:carrier",
    });
    expect(routingOrder(score)).toEqual(["mod", "carrier", "tuned"]);
  });

  test("a patch with side: vox renders after vox", () => {
    const gate = {
      kind: "patch",
      role: "effect",
      name: "gate",
      side: "vox",
      nodes: [{ id: "env", type: "follow", params: {} }],
      cables: [
        { id: "c1", from: "in.side", to: "env.in" },
        { id: "c2", from: "in.audio", to: "out.audio" },
      ],
      macros: [],
    };
    const score = createScore({
      tempoBpm: 120,
      bars: 1,
      tracks: [
        { id: "pad", name: "pad", instrument: "pad", fxPatch: [gate] },
        { id: "vox", name: "vox", instrument: "saw" },
      ],
    } as never);
    expect(routingOrder(score)).toEqual(["vox", "pad"]);
    const instrument = createScore({
      tempoBpm: 120,
      bars: 1,
      tracks: [
        {
          id: "pad",
          name: "pad",
          instrument: "patch",
          patch: {
            ...gate,
            role: "instrument",
            cables: [{ id: "c1", from: "in.side", to: "out.audio" }],
          },
        },
        { id: "vox", name: "vox", instrument: "saw" },
      ],
    } as never);
    expect(routingOrder(instrument)).toEqual(["vox", "pad"]);
  });

  test("an audio cycle is a ScoreValidationError naming the cycle", () => {
    const score = routed({ a: "follow:audio:b", b: "follow:audio:a" });
    let error: unknown;
    try {
      routingOrder(score);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ScoreValidationError);
    expect((error as ScoreValidationError).code).toBe("routing-cycle");
    expect((error as Error).message).toContain("a -> b -> a");
    // A notes loop is not a render dependency.
    expect(
      routingOrder(routed({ a: "follow:notes:b", b: "follow:notes:a" })),
    ).toEqual(["a", "b"]);
  });

  test("removeTrack drops a dangling reference", () => {
    const score = routed({ a: "follow:audio:b", b: "voice", c: "keep" });
    const removed = removeTrack(score, "b");
    expect(removed.tracks.map((track) => track.name)).toEqual(["a", "keep"]);
    expect(routingOrder(removed)).toEqual(["a", "c"]);
  });

  test("notesDigestInputs lists the followed tracks' notes", () => {
    let score = routed({ tuned: "follow:notes:guide", guide: "guide" });
    score = addNote(score, {
      id: "g1",
      trackId: "guide",
      startTick: 0,
      durationTicks: 240,
      pitch: 64,
      velocity: 0.7,
    });
    const inputs = notesDigestInputs(score, "tuned");
    expect(inputs.map((input) => input.trackId)).toEqual(["guide"]);
    expect(inputs[0]!.notes.map((note) => note.id)).toEqual(["g1"]);
    expect(notesDigestInputs(score, "guide")).toEqual([]);
  });
});
