/**
 * Numeric pattern checks on a generated style (quality-08). Each check
 * measures the score the generator produced against the card that drove
 * it: meter and tempo, onsets on the swung grid (within the groove's
 * microtiming and humanise tolerance), the measured swing ratio, scale
 * and tuning membership, acceptance by the card's harmony grammar,
 * melody range and interval statistics, and that every instrument and
 * kit resolves. Family lanes rely on `validateGenerated` through
 * `cards.test.ts`; `/style info --check` and the agent show the same
 * report.
 */

import { createScore } from "../score.ts";

import {
  generateStyle,
  harmonyGrammar,
  modeOfScale as modeOfScaleName,
  onsetTolerance,
  stripSeventh,
  swungStepTick,
  type GeneratedStyle,
  type PlannedChord,
  type StylePlan,
} from "./generate.ts";
import { resolveInstrumentWord } from "../instruments.ts";
import { SYNTH_KIT_NAMES } from "../kits.ts";
import { stretchGrid } from "./index.ts";
import {
  KIT_ROLES,
  PERC_ROLES,
  PITCHED_ROLES,
  type RoleName,
  type StyleId,
  type StyleOptions,
} from "./schema.ts";

export type StyleCheck = Readonly<{
  name: string;
  ok: boolean;
  /** The measured value, when the check measures one. */
  value?: number;
  detail: string;
}>;

export type StyleReport = Readonly<{
  id: StyleId;
  seed: number;
  bars: number;
  ok: boolean;
  checks: readonly StyleCheck[];
}>;

/** Fraction of pitched notes that may sit outside scale and chord. */
export const VALIDATE_LIMITS = Object.freeze({
  /** Lead and counter notes in the scale or the sounding chord. */
  melodyMembership: 0.9,
  /** Absolute tolerance on the measured swing ratio. */
  swingTolerance: 0.2,
  /** Odd-step kit notes needed before swing is measured. */
  swingSamples: 6,
  /** Largest melodic leap inside a phrase (an octave). */
  maxLeap: 12.5,
});

const KIT = new Set<string>(KIT_ROLES);
const PERC = new Set<string>(PERC_ROLES);
const PITCHED = new Set<string>(PITCHED_ROLES);
type CheckedNote = Readonly<{
  id: string;
  trackId: string;
  startTick: number;
  durationTicks: number;
  pitch: number;
  velocity: number;
  cents?: number;
}>;

const NOTES = new WeakMap<object, readonly CheckedNote[]>();

/** The generated notes with their tick fields required (the generator always writes ticks). */
function notesOf(data: GeneratedStyle["data"]): readonly CheckedNote[] {
  const cached = NOTES.get(data);
  if (cached) return cached;
  const notes = (data.notes ?? []).map((note) => ({
    id: note.id,
    trackId: note.trackId,
    startTick: note.startTick ?? NaN,
    durationTicks: note.durationTicks ?? NaN,
    pitch: note.pitch,
    velocity: note.velocity,
    ...(note.cents !== undefined ? { cents: note.cents } : {}),
  }));
  NOTES.set(data, notes);
  return notes;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

function check(
  name: string,
  ok: boolean,
  detail: string,
  value?: number,
): StyleCheck {
  return Object.freeze({
    name,
    ok,
    detail,
    ...(value !== undefined ? { value: Math.round(value * 1000) / 1000 } : {}),
  });
}

/** Generate `id` and validate the result. */
export function validateStyle(
  id: StyleId,
  options: StyleOptions = {},
): StyleReport {
  return validateGenerated(generateStyle(id, options));
}

/** Every pattern check on one generated style. */
export function validateGenerated(generated: GeneratedStyle): StyleReport {
  const { plan, data } = generated;
  const checks: StyleCheck[] = [
    checkStructure(generated),
    checkMeter(plan, data),
    checkTempo(plan, data.tempoBpm ?? NaN),
    ...checkOnsets(generated),
    checkTuning(generated),
    ...checkPitch(generated),
    checkGrammar(plan),
    ...checkMelody(generated),
    checkInstruments(generated),
  ];
  return Object.freeze({
    id: plan.style.id,
    seed: plan.seed,
    bars: plan.bars,
    ok: checks.every((entry) => entry.ok),
    checks: Object.freeze(checks),
  });
}

// ---------------------------------------------------------------------------

function checkStructure({ plan, data }: GeneratedStyle): StyleCheck {
  const loop = plan.bars * plan.barTicks;
  const bad = notesOf(data).filter(
    (note) =>
      !Number.isInteger(note.startTick) ||
      note.startTick < 0 ||
      note.startTick >= loop ||
      !(note.durationTicks >= 1) ||
      note.startTick + note.durationTicks > loop ||
      !(note.velocity > 0 && note.velocity <= 1) ||
      note.pitch < 0 ||
      note.pitch > 127,
  );
  const tracks = new Set((data.tracks ?? []).map((track) => track.id));
  const orphan = notesOf(data).filter((note) => !tracks.has(note.trackId));
  let parsed = true;
  try {
    createScore(data);
  } catch {
    parsed = false;
  }
  const ok =
    notesOf(data).length > 0 &&
    bad.length === 0 &&
    orphan.length === 0 &&
    parsed &&
    data.bars === plan.bars;
  return check(
    "structure",
    ok,
    `${notesOf(data).length} notes, ${bad.length} out of bounds, ${orphan.length} orphaned, score ${parsed ? "loads" : "rejected"}`,
    notesOf(data).length,
  );
}

function checkMeter(plan: StylePlan, data: GeneratedStyle["data"]): StyleCheck {
  const allowed = plan.style.meter.signatures.map(([sig]) => sig);
  const meter = data.time?.meter?.[0];
  const unit = meter ? meter.beatUnit : 4;
  const beats = meter ? meter.beatsPerBar : data.beatsPerBar;
  const ok =
    allowed.includes(plan.signature) &&
    beats === plan.beatsPerBar &&
    unit === plan.beatUnit &&
    data.beatsPerBar === plan.beatsPerBar;
  return check(
    "meter",
    ok,
    `${beats}/${unit}; card allows ${allowed.join(", ")}`,
  );
}

function checkTempo(plan: StylePlan, bpm: number): StyleCheck {
  const [low, high] = plan.style.tempo.bpm;
  const ok =
    Number.isFinite(bpm) &&
    bpm >= Math.floor(low) &&
    bpm <= Math.ceil(high) &&
    bpm >= 20 &&
    bpm <= 300;
  return check("tempo", ok, `${bpm} bpm in ${low}-${high}`, bpm);
}

/** Steps of the last beat of each fill bar. */
function fillSteps(plan: StylePlan): Set<number> {
  const out = new Set<number>();
  const fills = plan.style.rhythm.fills;
  if (!fills) return out;
  const beat = Math.max(1, Math.round(plan.stepsPerBar / plan.beatsPerBar));
  for (let bar = fills.every - 1; bar < plan.bars; bar += fills.every)
    for (
      let s = (bar + 1) * plan.stepsPerBar - beat;
      s < (bar + 1) * plan.stepsPerBar;
      s += 1
    )
      out.add(s);
  return out;
}

function checkOnsets({ plan, data }: GeneratedStyle): StyleCheck[] {
  const style = plan.style;
  const fills = fillSteps(plan);
  const cycle = style.meter.cycle;
  const pulse = (480 * 4) / plan.beatUnit;
  let total = 0;
  let off = 0;
  let offGrid = 0;
  let worst = 0;
  const swingShifts: number[] = [];
  for (const note of notesOf(data)) {
    const role = plan.noteRoles.get(note.id) as RoleName | undefined;
    if (!role || !(KIT.has(role) || PERC.has(role))) continue;
    total += 1;
    if (role === "perc" && cycle) {
      const i = Math.round(note.startTick / pulse);
      const error = Math.abs(note.startTick - i * pulse);
      worst = Math.max(worst, error);
      if (error > onsetTolerance(plan, role)) off += 1;
      if (cycle.strokes[mod(i, cycle.beats)] === ".") offGrid += 1;
      continue;
    }
    // Nearest grid step under the swung grid.
    const raw = Math.round(note.startTick / plan.stepTicks);
    let step = raw;
    let error = Infinity;
    for (const s of [raw - 1, raw, raw + 1]) {
      if (s < 0) continue;
      const e = Math.abs(note.startTick - swungStepTick(plan, s));
      if (e < error) {
        error = e;
        step = s;
      }
    }
    worst = Math.max(worst, error);
    if (error > onsetTolerance(plan, role)) off += 1;
    const grid = style.rhythm.onsets[role];
    const inGrid =
      grid && grid.length
        ? stretchGrid(grid, plan.stepsPerBar)[mod(step, plan.stepsPerBar)]! > 0
        : false;
    const isFill = fills.has(step) && (role === "snare" || role === "tom");
    if (!inGrid && !isFill) offGrid += 1;
    if (
      step % 2 === 1 &&
      plan.subdivision % 2 === 0 &&
      !style.groove.microtiming?.length &&
      !style.groove.roleOffset?.[role]
    )
      swingShifts.push(note.startTick - step * plan.stepTicks);
  }
  const out = [
    check(
      "onset-grid",
      off === 0 && offGrid === 0,
      `${total} kit/perc onsets: ${off} off the swung grid (worst ${Math.round(worst)} ticks), ${offGrid} on steps the card's grid never plays`,
      total ? (total - off - offGrid) / total : 1,
    ),
  ];
  // Swing: the median shift of odd steps gives the long:short ratio.
  if (
    swingShifts.length >= VALIDATE_LIMITS.swingSamples &&
    plan.subdivision % 2 === 0
  ) {
    const sorted = swingShifts.sort((a, b) => a - b);
    const shift = sorted[Math.floor(sorted.length / 2)]! / plan.stepTicks;
    const ratio = (1 + shift) / Math.max(1e-6, 1 - shift);
    const [low, high] = style.groove.swingRatio;
    const tolerance = VALIDATE_LIMITS.swingTolerance;
    out.push(
      check(
        "swing",
        ratio >= low - tolerance &&
          ratio <= high + tolerance &&
          Math.abs(ratio - plan.swing) <= tolerance,
        `measured ${ratio.toFixed(2)}:1 over ${swingShifts.length} off-steps; card ${low}-${high}, drawn ${plan.swing.toFixed(2)}`,
        ratio,
      ),
    );
  }
  return out;
}

function checkTuning({ plan, data }: GeneratedStyle): StyleCheck {
  const wanted = plan.style.pitch.tuning;
  if (!wanted) {
    const ok = !data.tuning;
    return check("tuning", ok, ok ? "12-TET" : "unexpected tuning");
  }
  const ok =
    !!data.tuning &&
    data.tuning.name === plan.tuning?.name &&
    data.tuning.root === plan.rootKey &&
    notesOf(data).every((note) => !note.cents);
  return check(
    "tuning",
    ok,
    `${data.tuning?.name ?? "none"} rooted on ${data.tuning?.root ?? "-"}; card wants ${wanted}`,
  );
}

function chordAtTick(plan: StylePlan, tick: number): PlannedChord | undefined {
  const bar = tick / plan.barTicks;
  for (let i = plan.chords.length - 1; i >= 0; i -= 1)
    if (bar + 1e-9 >= plan.chords[i]!.bar) return plan.chords[i];
  return plan.chords[0];
}

/** Sounding semitone class above the tonic for a key (tuning-aware). */
function pitchClassOf(plan: StylePlan, key: number, cents: number): number {
  const scale = plan.scale;
  if (scale.period !== 12) {
    const offset = key - plan.rootKey;
    const index = mod(offset, scale.period);
    const tone = scale.tones.find((t) => t.key === index);
    return tone ? mod(tone.semis, scale.periodSemis) : NaN;
  }
  if (plan.tuning) {
    // A 12-key tuning table: the key's degree carries the table's cents.
    const step = mod(key - plan.rootKey, 12);
    const tone = scale.tones.find((t) => t.key === step);
    return tone ? mod(tone.semis, 12) : step;
  }
  return mod(key - plan.rootKey + cents / 100, 12);
}

function checkPitch(generated: GeneratedStyle): StyleCheck[] {
  const { plan, data } = generated;
  const scale = plan.scale;
  const inScale = (pc: number) =>
    scale.tones.some(
      (t) =>
        Math.abs(mod(t.semis, scale.periodSemis) - pc) < 0.02 ||
        Math.abs(mod(t.semis, scale.periodSemis) - pc - scale.periodSemis) <
          0.02 ||
        Math.abs(mod(t.semis, scale.periodSemis) - pc + scale.periodSemis) <
          0.02,
    );
  // Power chords are root and perfect fifth whatever the triad's fifth.
  const power = plan.style.harmony.voicing.types.some(([t]) => t === "power");
  const walking = plan.style.bass.behaviour.some(([b]) => b === "walking");
  let melodyTotal = 0;
  let melodyIn = 0;
  let strictTotal = 0;
  let strictOut = 0;
  const strays: string[] = [];
  for (const note of notesOf(data)) {
    const role = plan.noteRoles.get(note.id) as RoleName | undefined;
    if (!role || !PITCHED.has(role)) continue;
    const pc = pitchClassOf(plan, note.pitch, note.cents ?? 0);
    // The chord sounding at the note, or the one it anticipates by up to
    // half a step (humanised and pushed notes land just before the change).
    const inChord =
      scale.period === 12 &&
      [note.startTick, note.startTick + plan.stepTicks / 2].some((tick) => {
        const chord = chordAtTick(plan, tick);
        return (
          !!chord &&
          !chord.degrees &&
          [...chord.pcs, ...(power ? [chord.rootPc + 7] : [])].some(
            (p) => Math.abs(mod(p - plan.tonic, 12) - pc) < 0.02,
          )
        );
      });
    const ok = Number.isFinite(pc) && (inScale(pc) || inChord);
    if (role === "lead" || role === "counter") {
      melodyTotal += 1;
      if (ok) melodyIn += 1;
      continue;
    }
    if (role === "bass" && walking) {
      // Walking bass: chromatic approach tones are idiomatic.
      if (!ok && !Number.isInteger(Math.round(pc * 1000) / 1000)) {
        strictTotal += 1;
        strictOut += 1;
      }
      continue;
    }
    strictTotal += 1;
    if (!ok) {
      strictOut += 1;
      if (strays.length < 4)
        strays.push(`${role}@${note.startTick}:${pc.toFixed(2)}`);
    }
  }
  const membership = melodyTotal ? melodyIn / melodyTotal : 1;
  return [
    check(
      "scale",
      strictOut === 0,
      `${strictTotal} harmony/bass notes, ${strictOut} outside ${scale.name} and the sounding chord${strays.length ? ` (${strays.join(" ")})` : ""}`,
      strictTotal ? 1 - strictOut / strictTotal : 1,
    ),
    check(
      "melody-scale",
      membership >= VALIDATE_LIMITS.melodyMembership,
      `${melodyIn}/${melodyTotal} melody notes in scale or chord`,
      membership,
    ),
  ];
}

function checkGrammar(plan: StylePlan): StyleCheck {
  if (plan.harmonyModel !== "functional" || plan.scale.period !== 12)
    return check("grammar", true, `${plan.harmonyModel} harmony: no grammar`);
  const grammar = harmonyGrammar(plan.style, modeOfScaleName(plan.scaleName));
  const numerals = plan.chords.map((chord) => stripSeventh(chord.numeral));
  const unknown = numerals.filter((n) => !grammar.numerals.has(n));
  const badEdges: string[] = [];
  for (let i = 0; i + 1 < numerals.length; i += 1) {
    const edge = `${numerals[i]}>${numerals[i + 1]}`;
    if (!grammar.edges.has(edge)) badEdges.push(edge);
  }
  const ok = unknown.length === 0 && badEdges.length === 0;
  return check(
    "grammar",
    ok,
    ok
      ? `${numerals.length} chords accepted (${plan.harmonySource})`
      : `rejected: ${[...new Set([...unknown, ...badEdges])].slice(0, 5).join(" ")} (${plan.harmonySource})`,
    numerals.length
      ? 1 - (unknown.length + badEdges.length) / numerals.length
      : 1,
  );
}

function checkMelody({ plan, data }: GeneratedStyle): StyleCheck[] {
  const melody = plan.style.melody;
  const lead = notesOf(data)
    .filter((note) => plan.noteRoles.get(note.id) === "lead")
    .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  if (lead.length < 2) return [];
  const sounding = (note: (typeof lead)[number]) =>
    note.pitch + (note.cents ?? 0) / 100;
  const [low, high] = melody.range;
  const outside = lead.filter(
    (note) =>
      note.pitch < Math.round(low) - 1 || note.pitch > Math.round(high) + 1,
  );
  const intervals: number[] = [];
  // Intervals inside a phrase; the jump between phrases is a new start.
  const phraseOf = (tick: number) => {
    const bar = tick / plan.barTicks;
    let index = 0;
    plan.phrases.forEach((phrase, i) => {
      if (bar + 1e-9 >= phrase.startBar) index = i;
    });
    return index;
  };
  for (let i = 1; i < lead.length; i += 1)
    if (phraseOf(lead[i]!.startTick) === phraseOf(lead[i - 1]!.startTick))
      intervals.push(sounding(lead[i]!) - sounding(lead[i - 1]!));
  if (intervals.length === 0) intervals.push(0);
  const abs = intervals.map(Math.abs);
  const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
  const maxLeap = Math.max(...abs);
  // Expected mean |interval| from the card's weights (-12..12).
  const weights = melody.intervals;
  let wsum = 0;
  let expect = 0;
  weights.forEach((w, i) => {
    wsum += w;
    expect += w * Math.abs(i - 12);
  });
  expect = wsum > 0 ? expect / wsum : 2;
  const stepScale =
    plan.scale.period === 12
      ? 1
      : plan.scale.periodSemis / plan.scale.tones.length;
  return [
    check(
      "melody-range",
      outside.length === 0,
      `${lead.length} lead notes in ${low}-${high}: ${outside.length} outside`,
      outside.length,
    ),
    check(
      "melody-intervals",
      maxLeap <= VALIDATE_LIMITS.maxLeap &&
        mean <= Math.max(expect * 2.2, 3 * stepScale) + 1,
      `mean |interval| ${mean.toFixed(2)} (card ~${expect.toFixed(2)}), largest ${maxLeap.toFixed(1)}`,
      mean,
    ),
  ];
}

function checkInstruments({ plan, data }: GeneratedStyle): StyleCheck {
  const bad: string[] = [];
  for (const track of plan.tracks) {
    if (track.instrument === "drums") {
      const kit = track.voice.kit;
      if (kit && !SYNTH_KIT_NAMES.includes(kit)) bad.push(`kit ${kit}`);
      continue;
    }
    if (!resolveInstrumentWord(track.instrument)) bad.push(track.instrument);
  }
  if ((data.tracks ?? []).length !== plan.tracks.length)
    bad.push("track count");
  return check(
    "instruments",
    bad.length === 0,
    bad.length
      ? `unresolved: ${bad.join(", ")}`
      : `${plan.tracks.map((t) => t.voice.kit ?? t.instrument).join(", ")}`,
  );
}
