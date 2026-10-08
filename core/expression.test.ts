import { describe, expect, test } from "bun:test";
import { applyScoreOperations, diffScores } from "./diff.ts";
import {
  ARTICULATION_EFFECTS,
  bendAt,
  centsAt,
  curveVelocity,
  ExpressionValidationError,
  normalizeArticulation,
  normalizeBend,
  normalizeHumanize,
  normalizePedal,
  normalizeTrackGlide,
  normalizeVelocityCurve,
  normalizeVibrato,
  pedalStateAt,
  performanceTimingFor,
  performNotes,
  tunedTiming,
  vibratoAt,
  type PerformedNote,
} from "./expression.ts";
import {
  createScore,
  SCORE_LIMITS,
  scoreFromJSON,
  ScoreValidationError,
  updateNote,
  updateTrack,
  type Note,
  type NoteInput,
  type TrackInput,
} from "./score.ts";

const TIMING = { tempoBpm: 120, ticksPerBeat: 480, endTick: 4 * 4 * 480 };
const SECONDS_PER_TICK = 60 / (120 * 480);

function scoreWith(
  track: Partial<TrackInput>,
  notes: readonly Partial<NoteInput>[],
) {
  return createScore({
    tracks: [
      { id: "t", name: "Lead", instrument: "lead", ...track } as TrackInput,
    ],
    notes: notes.map(
      (note, index) =>
        ({
          id: `n${index}`,
          trackId: "t",
          startTick: index * 480,
          durationTicks: 480,
          pitch: 60,
          velocity: 0.5,
          ...note,
        }) as NoteInput,
    ),
  });
}

function perform(
  track: Partial<TrackInput>,
  notes: readonly Partial<NoteInput>[],
): readonly PerformedNote[] {
  const score = scoreWith(track, notes);
  return performNotes(score.tracks[0], score.notes, TIMING);
}

describe("normalization", () => {
  test("articulations accept names and four-letter prefixes", () => {
    expect(normalizeArticulation("Staccato")).toBe("staccato");
    expect(normalizeArticulation("marc")).toBe("marcato");
    expect(normalizeArticulation("ghos")).toBe("ghost");
    expect(normalizeArticulation(null)).toBeUndefined();
    expect(() => normalizeArticulation("pizz")).toThrow(
      ExpressionValidationError,
    );
  });

  test("bend points sort by position and an empty bend is absent", () => {
    expect(
      normalizeBend([
        { at: 1, cents: 0 },
        { at: 0.5, cents: 200 },
      ]),
    ).toEqual([
      { at: 0.5, cents: 200 },
      { at: 1, cents: 0 },
    ]);
    expect(normalizeBend([])).toBeUndefined();
    expect(() => normalizeBend([{ at: 2, cents: 0 }])).toThrow();
    expect(() => normalizeBend([{ at: 0, cents: 0, x: 1 }])).toThrow(
      /unknown field/,
    );
  });

  test("vibrato fills rate and depth defaults and drops a zero delay", () => {
    expect(normalizeVibrato({})).toEqual({ rate: 5.5, depth: 20 });
    expect(normalizeVibrato({ rate: 6, depth: 50, delay: 0.3 })).toEqual({
      rate: 6,
      depth: 50,
      delay: 0.3,
    });
    expect(() => normalizeVibrato({ rate: 0 })).toThrow();
  });

  test("track glide takes seconds or an object, legato by default", () => {
    expect(normalizeTrackGlide(0.08)).toEqual({ time: 0.08, mode: "legato" });
    expect(normalizeTrackGlide({ mode: "poly" })).toEqual({
      time: 0.06,
      mode: "poly",
    });
    expect(() => normalizeTrackGlide({ mode: "porta" })).toThrow();
  });

  test("velocity curves: linear is never stored, fixed defaults to 0.8", () => {
    expect(normalizeVelocityCurve("linear")).toBeUndefined();
    expect(normalizeVelocityCurve("soft")).toEqual({ curve: "soft" });
    expect(normalizeVelocityCurve({ curve: "fixed" })).toEqual({
      curve: "fixed",
      fixed: 0.8,
    });
    expect(() => normalizeVelocityCurve({ curve: "hard", fixed: 1 })).toThrow();
  });

  test("humanize keeps only set amounts and a zero humanize is absent", () => {
    expect(normalizeHumanize({ timing: 10, seed: 7 })).toEqual({
      timing: 10,
      seed: 7,
    });
    expect(normalizeHumanize({ seed: 3 })).toBeUndefined();
    expect(normalizeHumanize({ velocity: 5 })).toEqual({
      velocity: 5,
      seed: 1,
    });
    expect(() => normalizeHumanize({ timing: 10, seed: 1.5 })).toThrow();
  });

  test("pedal events sort, and the last event at a tick wins", () => {
    expect(
      normalizePedal(
        [
          { tick: 960, state: "up" },
          { tick: 0, state: "down" },
          { tick: 960, state: "half" },
        ],
        10_000,
      ),
    ).toEqual([
      { tick: 0, state: "down" },
      { tick: 960, state: "half" },
    ]);
    expect(() => normalizePedal([{ tick: -1, state: "up" }], 10)).toThrow();
    expect(() => normalizePedal([{ tick: 0, state: "on" }], 10)).toThrow();
  });

  test("the score validates expression fields with the note or track id", () => {
    expect(() => scoreWith({}, [{ articulation: "pizz" as never }])).toThrow(
      ScoreValidationError,
    );
    expect(() => scoreWith({ humanize: { timing: 999, seed: 1 } }, [])).toThrow(
      /track t humanize timing/,
    );
  });
});

describe("score round trip", () => {
  test("expression fields survive toJSON and absent ones never appear", () => {
    const score = scoreWith(
      {
        glide: { time: 0.1, mode: "mono" },
        pedal: [
          { tick: 0, state: "down" },
          { tick: 1920, state: "up" },
        ],
        velocityCurve: "hard",
        humanize: { timing: 8, velocity: 5, length: 10, seed: 42 },
      },
      [
        {
          articulation: "staccato",
          glide: 0.05,
          bend: [{ at: 1, cents: -200 }],
          vibrato: { rate: 6, depth: 30, delay: 0.2 },
        },
        {},
      ],
    );
    const json = JSON.parse(JSON.stringify(score));
    expect(scoreFromJSON(json).toJSON()).toEqual(score.toJSON());
    expect(json.tracks[0].velocityCurve).toEqual({ curve: "hard" });
    expect(Object.keys(json.notes[1]).sort()).toEqual([
      "durationTicks",
      "id",
      "pitch",
      "startTick",
      "trackId",
      "velocity",
    ]);
  });

  test("updateNote and updateTrack clear fields with null", () => {
    const score = scoreWith({ humanize: { timing: 5, seed: 1 } }, [
      { articulation: "accent", vibrato: { rate: 5, depth: 10 } },
    ]);
    const cleared = updateNote(score, "n0", {
      articulation: null,
      vibrato: null,
      glide: 0,
    });
    expect(cleared.notes[0]!.articulation).toBeUndefined();
    expect(cleared.notes[0]!.vibrato).toBeUndefined();
    expect(cleared.notes[0]!.glide).toBe(0);
    expect(
      updateTrack(score, "t", { humanize: null }).tracks[0]!.humanize,
    ).toBeUndefined();
  });

  test("diffScores carries note expression and track performance", () => {
    const a = scoreWith({}, [{ articulation: "accent" }, {}]);
    const b = scoreWith({ velocityCurve: "soft", glide: 0.05 }, [
      {},
      { bend: [{ at: 1, cents: 100 }] },
    ]);
    const ops = diffScores(a, b);
    expect(ops).toContainEqual({
      type: "updateNote",
      noteId: "n0",
      patch: { articulation: null },
    });
    expect(applyScoreOperations(a, ops).toJSON()).toEqual(b.toJSON());
    expect(diffScores(b, b)).toEqual([]);
  });
});

describe("performNotes", () => {
  test("returns the notes themselves when nothing is expressive", () => {
    const score = scoreWith({}, [{}, {}]);
    expect(performNotes(score.tracks[0], score.notes, TIMING)).toBe(
      score.notes,
    );
  });

  test("articulations change length and velocity as documented", () => {
    const [staccato, accent, marcato, ghost, tenuto] = perform({}, [
      { articulation: "staccato" },
      { articulation: "accent", velocity: 0.9 },
      { articulation: "marcato" },
      { articulation: "ghost" },
      { articulation: "tenuto" },
    ]);
    expect(staccato!.durationTicks).toBe(240);
    expect(accent!.velocity).toBe(1);
    expect(marcato!.durationTicks).toBe(320);
    expect(marcato!.velocity).toBeCloseTo(0.8);
    expect(ghost!.velocity).toBeCloseTo(0.2);
    expect(ghost!.durationTicks).toBe(240);
    expect(tenuto!.durationTicks).toBe(480);
    expect(tenuto!.velocity).toBeCloseTo(0.5 + ARTICULATION_EFFECTS.tenuto.add);
  });

  test("legato holds into the next note with a 64th-note overlap", () => {
    const [first] = perform({}, [
      { articulation: "legato", durationTicks: 240 },
      { startTick: 480 },
    ]);
    expect(first!.durationTicks).toBe(480 + 30);
  });

  test("humanize is seeded, bounded and per note", () => {
    const humanize = { timing: 10, velocity: 10, length: 20, seed: 9 };
    const notes = [{}, {}, {}, {}].map((_, index) => ({
      startTick: 480 + index * 480,
    }));
    const one = perform({ humanize }, notes);
    const again = perform({ humanize }, notes);
    expect(again).toEqual(one);
    const other = perform({ humanize: { ...humanize, seed: 10 } }, notes);
    expect(other).not.toEqual(one);
    const tenMs = 0.01 / SECONDS_PER_TICK;
    for (const [index, note] of one.entries()) {
      expect(Math.abs(note.startTick - (480 + index * 480))).toBeLessThan(
        tenMs,
      );
      expect(Math.abs(note.velocity - 0.5)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(note.durationTicks - 480)).toBeLessThanOrEqual(96);
    }
    // Moving one note leaves the others' offsets alone.
    const moved = perform({ humanize }, [
      { startTick: 480 },
      { startTick: 960, pitch: 67 },
      ...notes.slice(2),
    ]);
    expect(moved[0]).toEqual(one[0]!);
    expect(moved.at(-1)).toEqual(one.at(-1)!);
  });

  test("a note's humanize replaces the track's; {} keeps it exact", () => {
    const notes = [0, 1, 2, 3].map((index) => ({
      startTick: 480 + index * 480,
      ...(index === 1 ? { humanize: {} } : {}),
      ...(index === 2 ? { humanize: { timing: 10 } } : {}),
    }));
    const plain = perform({}, notes);
    // Only the note with amounts moves on a track without humanize.
    expect(plain[0]!.startTick).toBe(480);
    expect(plain[1]!.startTick).toBe(960);
    expect(plain[2]!.startTick).not.toBe(1440);
    expect(plain[3]!.startTick).toBe(1920);
    const track = perform({ humanize: { timing: 10, seed: 4 } }, notes);
    expect(track[0]!.startTick).not.toBe(480);
    expect(track[1]!.startTick).toBe(960);
    expect(track[1]!.velocity).toBe(0.5);
  });

  test("a note released under the pedal rings until it lifts", () => {
    const [held, after] = perform(
      {
        pedal: [
          { tick: 0, state: "down" },
          { tick: 1920, state: "up" },
        ],
      },
      [{ durationTicks: 240 }, { startTick: 1920, durationTicks: 240 }],
    );
    expect(held!.durationTicks).toBe(1920);
    expect(after!.durationTicks).toBe(240);
  });

  test("re-pedalling: an up then down only sustains later notes", () => {
    const [first, second] = perform(
      {
        pedal: [
          { tick: 0, state: "down" },
          { tick: 900, state: "up" },
          { tick: 960, state: "down" },
          { tick: 2400, state: "up" },
        ],
      },
      [
        { durationTicks: 240 },
        { startTick: 960, durationTicks: 240, pitch: 64 },
      ],
    );
    expect(first!.durationTicks).toBe(900);
    expect(second!.durationTicks).toBe(2400 - 960);
  });

  test("re-striking a pitch under the pedal stops the ringing one", () => {
    const [first, second] = perform({ pedal: [{ tick: 0, state: "down" }] }, [
      { durationTicks: 240 },
      { startTick: 960, durationTicks: 240 },
    ]);
    expect(first!.durationTicks).toBe(960);
    expect(second!.durationTicks).toBe(TIMING.endTick - 960);
  });

  test("half pedal sustains with a fade", () => {
    const [note] = perform({ pedal: [{ tick: 0, state: "half" }] }, [
      { durationTicks: 480 },
    ]);
    expect(note!.performance?.damp).toEqual({ from: 0.5, tau: 0.5 });
    expect(note!.durationTicks).toBeGreaterThan(480);
  });

  test("velocity curves", () => {
    expect(curveVelocity({ curve: "soft" }, 0.25)).toBeCloseTo(0.5);
    expect(curveVelocity({ curve: "hard" }, 0.5)).toBeCloseTo(0.25);
    expect(curveVelocity({ curve: "fixed", fixed: 0.7 }, 0.1)).toBe(0.7);
    const [note] = perform({ velocityCurve: "hard" }, [{ velocity: 0.5 }]);
    expect(note!.velocity).toBeCloseTo(0.25);
  });

  test("legato glide chains overlapping notes into one gliding voice", () => {
    const notes = perform({ glide: { time: 0.05, mode: "legato" } }, [
      { durationTicks: 520 },
      { startTick: 480, pitch: 67, durationTicks: 480 },
      { startTick: 1440, pitch: 72 },
    ]);
    // The first two overlap: one voice from 0 to 960 gliding up a fifth.
    expect(notes).toHaveLength(2);
    const [chain, detached] = notes;
    expect(chain!.startTick).toBe(0);
    expect(chain!.durationTicks).toBe(960);
    const cents = chain!.performance!.cents!;
    const at = (tick: number) => tick * SECONDS_PER_TICK;
    expect(cents(at(100))).toBe(0);
    // Exponential (RC) approach: past the linear midpoint at half time.
    const half = (1 - Math.exp(-1.5)) / (1 - Math.exp(-3));
    expect(cents(at(480) + 0.025)).toBeCloseTo(700 * half);
    expect(cents(at(700))).toBe(700);
    // A gap means no glide (TB-303 slide only into a tied note).
    expect(detached!.performance).toBeUndefined();
  });

  test("glides move by the track tuning's interval and note cents", () => {
    const score = scoreWith({ glide: { time: 0.05, mode: "legato" } }, [
      { durationTicks: 520 },
      { startTick: 480, pitch: 61, durationTicks: 480, cents: 10 },
    ]);
    const edo = { ...score, tuning: { edo: 19 } } as typeof score;
    const timing = tunedTiming(TIMING, edo, edo.tracks[0]);
    expect(timing.keyCents).toBeDefined();
    const [chain] = performNotes(edo.tracks[0], edo.notes, timing);
    const cents = chain!.performance!.cents!;
    // One 19-EDO step (1200 / 19 cents) plus the note's +10 cents.
    expect(cents(700 * SECONDS_PER_TICK)).toBeCloseTo(1200 / 19 + 10, 6);
    // No tuning: the timing is untouched and the step is 100 cents.
    expect(tunedTiming(TIMING, score, score.tracks[0])).toBe(TIMING);
    const [plain] = performNotes(score.tracks[0], score.notes, TIMING);
    expect(plain!.performance!.cents!(700 * SECONDS_PER_TICK)).toBeCloseTo(
      110,
      6,
    );
  });

  test("a note glide of 0 breaks a legato chain", () => {
    const notes = perform({ glide: 0.05 }, [
      { durationTicks: 520 },
      { startTick: 480, pitch: 67, glide: 0 },
    ]);
    expect(notes).toHaveLength(2);
    expect(notes[0]!.durationTicks).toBe(480);
  });

  test("mono glide always slides and keeps one voice", () => {
    const notes = perform({ glide: { time: 0.1, mode: "mono" } }, [
      { durationTicks: 960 },
      { startTick: 480, pitch: 62 },
      { startTick: 480, pitch: 55 },
    ]);
    expect(notes).toHaveLength(2);
    expect(notes[0]!.durationTicks).toBe(480);
    expect(notes[1]!.pitch).toBe(62);
    expect(notes[1]!.performance!.cents!(0)).toBe(-200);
    expect(notes[1]!.performance!.cents!(0.2)).toBe(0);
    expect(notes[1]!.performance!.replaceSlide).toBe(true);
  });

  test("poly glide slides each chord tone from the same rank", () => {
    const notes = perform({ glide: { time: 0.1, mode: "poly" } }, [
      { pitch: 60 },
      { startTick: 0, pitch: 64 },
      { startTick: 480, pitch: 62 },
      { startTick: 480, pitch: 65 },
    ]);
    const second = notes.filter((note) => note.startTick === 480);
    const low = second.find((note) => note.pitch === 62)!;
    const high = second.find((note) => note.pitch === 65)!;
    expect(low.performance!.cents!(0)).toBe(-200);
    expect(high.performance!.cents!(0)).toBe(-100);
  });

  test("a note glide without a track glide is polyphonic", () => {
    const [, second] = perform({}, [{}, { pitch: 64, glide: 0.1 }]);
    expect(second!.performance!.cents!(0)).toBe(-400);
    expect(second!.performance!.cents!(0.05)).toBeCloseTo(-200);
  });

  test("bend and vibrato shape the pitch curve", () => {
    const [note] = perform({}, [
      {
        bend: [{ at: 1, cents: 200 }],
        vibrato: { rate: 5, depth: 50, delay: 0.1 },
      },
    ]);
    const performance = note!.performance!;
    expect(performance.replacePitchEnvelope).toBe(true);
    expect(performance.replaceVibrato).toBe(true);
    expect(performance.cents!(0)).toBe(0);
    // Half way through a 0.5 s note: +100 cents of bend, vibrato fading in.
    expect(performance.cents!(0.25)).toBeCloseTo(
      100 + vibratoAt({ rate: 5, depth: 50, delay: 0.1 }, 0.25),
    );
  });
});

describe("review fixes", () => {
  const maxStep = (cents: (t: number) => number, from: number, to: number) => {
    let worst = 0;
    let previous = cents(from);
    for (let t = from + 0.001; t <= to; t += 0.001) {
      const value = cents(t);
      worst = Math.max(worst, Math.abs(value - previous));
      previous = value;
    }
    return worst;
  };

  test("a legato glide cut off by the next note stays continuous", () => {
    const [voice] = perform({ glide: { time: 1, mode: "legato" } }, [
      { startTick: 0, durationTicks: 600, pitch: 60 },
      { startTick: 480, durationTicks: 600, pitch: 72 },
      { startTick: 960, durationTicks: 480, pitch: 60 },
    ]);
    const cents = voice!.performance!.cents!;
    // 1200 cents over 1 s on the exponential curve moves at most
    // 1.2 * 3 / (1 - e^-3) ≈ 3.8 cents per millisecond: no jumps.
    expect(maxStep(cents, 0, 1.4)).toBeLessThan(5);
    expect(cents(1.5)).toBeGreaterThan(0);
  });

  test("a mono glide cut off by the next note stays continuous", () => {
    const notes = perform({ glide: { time: 1, mode: "mono" } }, [
      { startTick: 0, pitch: 60 },
      { startTick: 480, pitch: 72 },
      { startTick: 960, pitch: 60 },
    ]);
    const second = notes[1]!;
    const third = notes[2]!;
    // The third note starts from the pitch the gliding second one reached.
    const reached = 1200 + second.performance!.cents!(0.5);
    expect(reached).toBeLessThan(1200);
    expect(third.performance!.cents!(0)).toBeCloseTo(reached);
  });

  test("humanize timing never changes chords, the mono line or glides", () => {
    const chords = [
      { startTick: 0, pitch: 60 },
      { startTick: 0, pitch: 64 },
      { startTick: 0, pitch: 67 },
      { startTick: 480, pitch: 65 },
      { startTick: 480, pitch: 69 },
      { startTick: 480, pitch: 72 },
    ];
    const humanize = { timing: 10, seed: 3 };
    const mono = perform(
      { glide: { time: 0.05, mode: "mono" }, humanize },
      chords,
    );
    expect(mono.map((note) => note.pitch)).toEqual([67, 72]);
    expect(mono[0]!.durationTicks).toBeGreaterThan(400);
    const poly = perform(
      { glide: { time: 0.05, mode: "poly" }, humanize },
      chords,
    );
    for (const note of poly.filter((note) => note.id < "n3"))
      expect(note.performance?.cents).toBeUndefined();
    const second = poly.filter((note) => note.id >= "n3");
    expect(second.map((note) => note.performance!.cents!(0))).toEqual([
      -500, -500, -500,
    ]);
    // A humanized chord on a legato track does not glide into itself.
    const legato = perform(
      { glide: { time: 0.05, mode: "legato" }, humanize },
      chords.slice(0, 3),
    );
    expect(legato).toHaveLength(1);
    expect(legato[0]!.performance?.cents).toBeUndefined();
  });

  test("bends follow the written key, not the pedal", () => {
    const fall = [
      { at: 0.6, cents: 0 },
      { at: 1, cents: -500 },
    ];
    const [note] = perform(
      {
        pedal: [
          { tick: 0, state: "down" },
          { tick: 3840, state: "up" },
        ],
      },
      [{ durationTicks: 480, bend: fall }],
    );
    expect(note!.durationTicks).toBe(3840);
    const cents = note!.performance!.cents!;
    expect(cents(0.5)).toBeCloseTo(-500);
    expect(cents(3)).toBeCloseTo(-500);
  });

  test("accent and marcato mark the performance for the synth filter", () => {
    const [accent, plain] = perform({}, [
      { articulation: "accent" },
      { pitch: 62 },
    ]);
    expect(accent!.performance?.accent).toBe(true);
    expect(plain!.performance).toBeUndefined();
  });

  test("a note glide is a slide flag on a legato track", () => {
    const notes = perform({ glide: { time: 0.06, mode: "legato" } }, [
      { durationTicks: 470 },
      { startTick: 480, pitch: 67, glide: 0.06 },
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.performance!.cents!(480 * SECONDS_PER_TICK)).toBe(0);
  });
});

describe("curves", () => {
  test("bendAt interpolates and holds its ends", () => {
    const points = [
      { at: 0.5, cents: 100 },
      { at: 1, cents: -100 },
    ];
    expect(bendAt(points, 0)).toBe(0);
    expect(bendAt(points, 0.25)).toBe(50);
    expect(bendAt(points, 0.75)).toBe(0);
    expect(bendAt([{ at: 0, cents: -300 }], 0.4)).toBe(-300);
  });

  test("vibrato waits for its delay and fades in", () => {
    const vibrato = { rate: 5, depth: 40, delay: 0.2 };
    expect(vibratoAt(vibrato, 0.1)).toBe(0);
    expect(Math.abs(vibratoAt(vibrato, 0.25))).toBeLessThan(40);
    expect(vibratoAt(vibrato, 0.2 + 0.15 + 0.05)).toBeCloseTo(
      40 * Math.sin(2 * Math.PI * 5 * 0.2),
    );
  });

  test("pedal state at a tick", () => {
    const pedal = [
      { tick: 10, state: "down" },
      { tick: 20, state: "half" },
    ] as const;
    expect(pedalStateAt(pedal, 5)).toBe("up");
    expect(pedalStateAt(pedal, 10)).toBe("down");
    expect(pedalStateAt(pedal, 25)).toBe("half");
    expect(
      centsAt(
        [
          {
            offset: 0,
            length: 1,
            target: 0,
            from: 0,
            glide: 0,
            vibratoFrom: 0,
          },
        ],
        0.5,
      ),
    ).toBe(0);
  });
});

describe("tempo map", () => {
  test("bends, glides and humanize convert seconds through the tempo map", () => {
    // 120 bpm, then 60 bpm from beat 4: a beat there lasts 1 s, not 0.5 s.
    const score = createScore({
      tempoBpm: 120,
      time: { tempo: [{ tick: 4 * 480, bpm: 60 }] },
      tracks: [{ id: "t", name: "Lead", instrument: "lead" }],
      notes: [
        {
          id: "n0",
          trackId: "t",
          startTick: 4 * 480,
          durationTicks: 480,
          pitch: 60,
          velocity: 0.5,
          bend: [
            { at: 0, cents: 0 },
            { at: 1, cents: 200 },
          ],
        },
      ],
    });
    const timing = performanceTimingFor(score);
    expect(timing.secondsAt).toBeDefined();
    const [note] = performNotes(score.tracks[0], score.notes, timing);
    const cents = note!.performance!.cents!;
    // Half way through the 1 s note, not at its end.
    expect(cents(0.5)).toBeCloseTo(100);
    expect(cents(1)).toBeCloseTo(200);
    // Without a tempo map the timing keeps the constant-tempo arithmetic.
    expect(performanceTimingFor(scoreWith({}, [{}])).secondsAt).toBeUndefined();
  });
});

describe("scale", () => {
  test("legato at SCORE_LIMITS.maxNotes finds next onsets in bounded time", () => {
    const count = SCORE_LIMITS.maxNotes;
    const notes = Array.from(
      { length: count },
      (_, index) =>
        ({
          id: `n${index}`,
          trackId: "t",
          startTick: index * 30,
          durationTicks: 10,
          pitch: 60,
          velocity: 0.5,
          articulation: "legato",
        }) as Note,
    );
    const started = performance.now();
    const performed = performNotes(undefined, notes, {
      tempoBpm: 120,
      ticksPerBeat: 480,
      endTick: count * 30 + 480,
    });
    expect(performance.now() - started).toBeLessThan(1000);
    // Each note reaches the next onset plus the legato overlap; the last one
    // has no next onset and only gains the overlap.
    expect(performed[0]!.durationTicks).toBe(30 + 480 / 16);
    expect(performed[count - 1]!.durationTicks).toBe(10 + 480 / 16);
  });
});

describe("TB-303 slide", () => {
  const TPB = 480;
  test("half-step gates on a 16th grid slide into a gliding note", () => {
    const notes = perform({ glide: { time: 0.05, mode: "legato" } }, [
      { startTick: 0, durationTicks: TPB / 8, pitch: 48 },
      { startTick: TPB / 4, durationTicks: TPB / 8, pitch: 55, glide: 0.05 },
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.performance!.cents).toBeDefined();
  });

  test("a slide does not bridge a rest longer than a step", () => {
    const notes = perform({ glide: { time: 0.05, mode: "legato" } }, [
      { startTick: 0, durationTicks: TPB / 8, pitch: 48 },
      { startTick: TPB / 2, durationTicks: TPB / 8, pitch: 55, glide: 0.05 },
    ]);
    expect(notes).toHaveLength(2);
  });

  test("an accented slide target accents the chained voice", () => {
    const notes = perform({ glide: { time: 0.05, mode: "legato" } }, [
      { startTick: 0, durationTicks: TPB / 2, pitch: 48 },
      {
        startTick: TPB / 4,
        durationTicks: TPB / 4,
        pitch: 55,
        articulation: "accent",
      },
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.performance!.accent).toBe(true);
  });
});
