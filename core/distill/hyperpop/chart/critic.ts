/**
 * The craft the three demos share, measured on any score, so a song can be
 * sent back before anyone listens to it. The gates are set from the demos:
 *
 * - distinct bars: how many of the bars with a tune in them bring a tune
 *   the song hasn't played yet
 * - voice-leading: how far the bed moves between chords (the demos: about
 *   one semitone per voice)
 * - clashes: held sung notes a semitone against the bed under them (synth
 *   singers only; a sampled book carries its pitch in the audio)
 * - expression: scoops, slides, dives and vibrato per sung note
 * - an intro of four bars or more, sections of eight bars or fewer, and
 *   every repeated section kind developed
 */
import type { TrackScoreData } from "../../../score.ts";

const SUNG = new Set(["vox", "vocal", "sing"]);
const BEDS = ["pad", "chords"];
const HARMONY = new Set([...BEDS, "keys", "stabs", "saw"]);
/** The tune: whatever sings or plays a line. */
const MELODIC = new Set([
  ...SUNG,
  "lead",
  "hook",
  "vlead",
  "saw",
  "counter",
  "chop",
  "chops",
]);

export type Craft = Readonly<{
  distinctBars: number;
  voiceLeading: number;
  expressive: number;
  sungNotes: number;
  /** Held sung notes a semitone from a bed note sounding with them, per held note. */
  clashes: number;
  expressivePerSung: number;
  introBars: number;
  longestSection: number;
  layersBySection: readonly number[];
}>;

export type Verdict = Readonly<{ craft: Craft; problems: readonly string[] }>;

export function craftOf(data: TrackScoreData): Craft {
  const tpb = data.ticksPerBeat ?? 480;
  const bar = tpb * (data.beatsPerBar ?? 4);
  const score = {
    sections: data.sections ?? [],
    notes: (data.notes ?? []).map((n) => ({
      ...n,
      startTick: n.startTick ?? 0,
      durationTicks: n.durationTicks ?? 0,
    })),
  };
  const signatures = new Map<number, string[]>();
  let expressive = 0;
  let sungNotes = 0;
  for (const n of score.notes) {
    if (n.bend?.length || n.glide || n.vibrato) expressive++;
    if (SUNG.has(n.trackId)) sungNotes++;
    if (!MELODIC.has(n.trackId)) continue;
    const b = Math.floor(n.startTick / bar);
    const list = signatures.get(b) ?? [];
    list.push(`${n.trackId}:${n.startTick - b * bar}:${n.pitch}`);
    signatures.set(b, list);
  }
  const sigs = [...signatures.values()].map((l) => l.sort().join(" "));
  const distinctBars = sigs.length ? new Set(sigs).size / sigs.length : 0;

  // The bed: each chord's voices against the previous chord's, sorted.
  const bed = score.notes.filter((n) => BEDS.includes(n.trackId));
  const chords = new Map<number, number[]>();
  for (const n of bed)
    chords.set(n.startTick, [...(chords.get(n.startTick) ?? []), n.pitch]);
  const ordered = [...chords.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, p]) => [...new Set(p)].sort((a, b) => a - b));
  let moves = 0;
  let voices = 0;
  // Whole chords only: a suspension's resolving note is not a new chord.
  const full = ordered.filter((c) => c.length >= 3);
  for (let i = 1; i < full.length; i++) {
    const a = full[i - 1]!;
    const z = full[i]!;
    if (a.length !== z.length) continue;
    a.forEach((p, k) => (moves += Math.abs(z[k]! - p)));
    voices += a.length;
  }
  // Held words against the bed: a semitone (or a minor 9th) is a clash. A
  // sampled vocal book's pitches name its lines, not the notes it sings.
  const books = new Set(
    (data.tracks ?? [])
      .filter((t) => t.instrument === "sampler")
      .map((t) => t.id),
  );
  const held = score.notes.filter(
    (n) =>
      SUNG.has(n.trackId) &&
      !books.has(n.trackId) &&
      n.durationTicks >= (tpb * 3) / 4,
  );
  const harmony = score.notes.filter((n) => HARMONY.has(n.trackId));
  let clashing = 0;
  for (const n of held) {
    const mid = n.startTick + n.durationTicks / 2;
    if (
      harmony.some((h) => {
        const d = (((n.pitch - h.pitch) % 12) + 12) % 12;
        return (
          (d === 1 || d === 11) &&
          h.startTick <= mid &&
          h.startTick + h.durationTicks > mid
        );
      })
    )
      clashing++;
  }
  const sections = score.sections ?? [];
  const layersBySection = sections.map((s) => {
    const from = s.startBar * bar;
    const to = (s.startBar + s.bars) * bar;
    return new Set(
      score.notes
        .filter((n) => n.startTick >= from && n.startTick < to)
        .map((n) => n.trackId),
    ).size;
  });
  return {
    distinctBars,
    voiceLeading: voices ? moves / voices : 0,
    expressive,
    sungNotes,
    clashes: held.length ? clashing / held.length : 0,
    expressivePerSung: sungNotes ? expressive / sungNotes : 0,
    introBars: sections[0]?.bars ?? 0,
    longestSection: Math.max(0, ...sections.map((s) => s.bars)),
    layersBySection,
  };
}

/** The demos' bar, as sentences naming what falls short. */
export function judge(score: TrackScoreData): Verdict {
  const craft = craftOf(score);
  const problems: string[] = [];
  if (craft.distinctBars < 0.45)
    problems.push(
      `only ${Math.round(craft.distinctBars * 100)}% of bars bring new material (45% or more)`,
    );
  if (craft.voiceLeading > 1.3)
    problems.push(
      `the bed moves ${craft.voiceLeading.toFixed(2)} semitones a voice between chords (1.3 or less)`,
    );
  if (craft.sungNotes && craft.expressivePerSung < 0.6)
    problems.push(
      `${craft.expressive} expressive notes for ${craft.sungNotes} sung ones (0.6 a note or more)`,
    );
  if (craft.clashes > 0.25)
    problems.push(
      `${Math.round(craft.clashes * 100)}% of held words rub a semitone against the bed (25% or less; Glass Garden's sevenths sit at 21%)`,
    );
  if (craft.introBars < 4)
    problems.push(`a ${craft.introBars}-bar intro (4 or more)`);
  if (craft.longestSection > 8)
    problems.push(`a ${craft.longestSection}-bar section (8 or fewer)`);
  return { craft, problems };
}
