/**
 * The critic: deterministic musical checks on a validated sheet, distilled
 * from what made the demos work and from the owner's notes on what did not.
 * It scores 0..100 and says what to change in words a model can act on, so
 * a generate loop can send the notes back for another round.
 */
import {
  chordClasses,
  degreePitch,
  numeralDegree,
  parseKey,
  type SheetLine,
  type SheetPart,
  type SongSheet,
} from "./sheet.ts";

export type Critique = Readonly<{
  score: number;
  /** The share of on-beat notes that clash a semitone with their chord. */
  rubs: number;
  /** What to fix, worst first. */
  notes: readonly string[];
}>;

export function critique(sheet: SongSheet): Critique {
  const key = parseKey(sheet.key)!;
  const found: { cost: number; note: string }[] = [];
  const flag = (cost: number, note: string) => found.push({ cost, note });
  const sections = sheet.sections;
  const total = sections.reduce((n, s) => n + s.bars, 0);
  const of = (kind: string) => sections.filter((s) => s.kind === kind);

  // Form: a club-length song whose best moments are the drops.
  if (total < 64)
    flag(
      10,
      `the song is ${total} bars; make it 72 to 112 by adding a drop or a verse`,
    );
  if (total > 140) flag(8, `the song is ${total} bars; cut it to 72 to 112`);
  if (sheet.palette === "candy") candyForm();
  else clubForm();
  function candyForm() {
    if (sections[0]?.kind !== "intro") flag(4, "start with an intro");
    if (sections.at(-1)?.kind !== "outro") flag(4, "end with an outro");
    if (of("chorus").length < 3)
      flag(
        12,
        "write three choruses: after the first pre, after the second pre, and after the bridge",
      );
    if (of("pre").length < 2)
      flag(
        8,
        "put a pre-chorus (kind pre) before each of the first two choruses",
      );
    if (of("break").length < 1)
      flag(
        5,
        "add a break after the first chorus; the glitch break stutters its peak word",
      );
    if (of("bridge").length < 1)
      flag(8, "add a bridge before the last chorus, quieter and lower");
    const choruses = of("chorus");
    if (choruses.length >= 2 && choruses.at(-1) !== sections.at(-2))
      flag(4, "end on the last chorus and then the outro");
    if (!sheet.hooks?.hook)
      flag(4, "write hooks.hook: the one-bar synth motif the intro plays");
    if (!sheet.hooks?.chip)
      flag(
        3,
        "write hooks.chip: short answers the pluck plays between chorus lines",
      );
  }
  function clubForm() {
    if (of("post").length < 2)
      flag(
        15,
        "write at least two drops (kind post) after choruses; the drops carry hyperpop",
      );
    if (of("chorus").length < 2) flag(10, "write at least two choruses");
    if (sections[0]?.kind !== "intro") flag(4, "start with an intro");
    if (sections.at(-1)?.kind !== "outro")
      flag(4, "end with an outro of 4 bars or more");
    if (
      !sections.some(
        (s) =>
          (s.kind === "break" || s.kind === "build") &&
          s.drums.every((d) => d === "none"),
      )
    )
      flag(
        5,
        'add a drumless break (drums ["none"]) before the last chorus, so it lands',
      );
    for (const s of of("post")) {
      if (s.lines?.some(Boolean))
        flag(
          8,
          `${s.name}: drops have no sung lines; let the chops (riff) and lead speak`,
        );
      if (!s.riff)
        flag(
          8,
          `${s.name}: give the drop a riff (drop, drop2, bloom or scatter)`,
        );
      if (!s.stabs) flag(4, `${s.name}: give the drop stabs (drive or bloom)`);
      if (s.drums.includes("none")) flag(6, `${s.name}: a drop needs drums`);
    }
    for (const s of of("verse"))
      if (!s.riff && !s.arp && !s.bells)
        flag(
          5,
          `${s.name}: keep a repeated texture under the verse (a riff such as answer, an arp or bells)`,
        );
    for (const s of [...of("chorus"), ...of("post")])
      if (s.drums.includes("none")) flag(6, `${s.name}: give it drums`);
  }

  // Harmony: chord tones on the strong beats, melodies that move by step.
  const progression = (name: string) => sheet.progressions[name] ?? [];
  const numeralAt = (name: string, bar: number) => {
    const list = progression(name);
    return list[bar % list.length] ?? "I";
  };
  const chordAt = (name: string, bar: number) =>
    new Set(chordClasses(key, numeralDegree(numeralAt(name, bar)) ?? 1));
  // A rub is a semitone against a chord tone: the compiler moves it, but the
  // line the model meant is lost, so it costs. Sixths and ninths are colour.
  const rubsOn = (pcs: Set<number>, pc: number) =>
    !pcs.has(pc) && (pcs.has((pc + 1) % 12) || pcs.has((pc + 11) % 12));
  // A short note that steps straight on to its neighbour leans on the beat
  // (an appoggiatura or passing note) and is heard as melody, not a clash.
  const leans = (line: SheetLine, k: number) => {
    const [beat, degree, beats] = line[k]!;
    const next = line[k + 1];
    return (
      beats <= 0.5 &&
      next !== undefined &&
      next[0] - beat <= 0.5 &&
      Math.abs(next[1] - degree) === 1
    );
  };
  let strong = 0;
  let onChord = 0;
  let rubbed = 0;
  const rubs: string[] = [];
  const pitches: Record<string, number[]> = { verse: [], chorus: [] };
  const sung = new Set<SheetPart>();
  for (const s of sections)
    (s.lines ?? []).forEach((part, bar) => {
      if (!part) return;
      const line = sheet.lines[part];
      if (!line) return;
      sung.add(part);
      line.forEach(([beat, degree, beats], k) => {
        const pitch = degreePitch(key, degree);
        if (s.kind === "verse" || s.kind === "chorus")
          pitches[s.kind]!.push(pitch);
        if (beat % 1 !== 0 || leans(line, k)) return;
        strong++;
        const at = bar + Math.floor(beat / 4);
        const pcs = chordAt(s.chords, at);
        if (pcs.has(pitch % 12)) onChord++;
        else if (rubsOn(pcs, pitch % 12)) {
          rubbed++;
          if (rubs.length < 3) {
            const numeral = numeralAt(s.chords, at);
            const d = numeralDegree(numeral) ?? 1;
            rubs.push(
              `${part} beat ${beat} in ${s.name} sings degree ${degree} over ${numeral} (use ${d}, ${d + 2} or ${d + 4})`,
            );
          }
        }
      });
    });
  for (const s of sections) {
    const bars = (s.lead ?? []).flatMap((name) => sheet.hooks?.[name] ?? []);
    for (let at = 0; bars.length > 0 && at < s.bars; at++)
      for (const [beat, degree] of bars[at % bars.length]!) {
        if (beat % 1 !== 0) continue;
        strong++;
        const pcs = chordAt(s.chords, at);
        const pc = degreePitch(key, degree) % 12;
        if (pcs.has(pc)) onChord++;
        else if (rubsOn(pcs, pc)) rubbed++;
      }
  }
  const share = strong > 0 ? onChord / strong : 1;
  const rubShare = strong > 0 ? rubbed / strong : 0;
  if (rubShare > 0.03)
    flag(
      Math.max(4, Math.round(rubShare * 60)),
      `${Math.round(rubShare * 100)}% of on-beat notes clash a semitone with the chord; on every beat sing a chord tone of that bar's chord (bar k of a section plays progression[k mod length])${rubs.length ? `: ${rubs.join("; ")}` : ""}`,
    );
  else if (share < 0.75)
    flag(
      Math.round((0.75 - share) * 40),
      `only ${Math.round(share * 100)}% of on-beat notes are chord tones; land more beats on the root, third or fifth`,
    );
  for (const [part, line] of Object.entries(sheet.lines)) {
    if (!sung.has(part as SheetPart)) {
      flag(
        2,
        `lines.${part} is never sung; use it in a section's lines or drop it`,
      );
      continue;
    }
    const degrees = line.map(([, d]) => d);
    const leaps = degrees.filter(
      (d, k) => k > 0 && Math.abs(d - degrees[k - 1]!) > 5,
    );
    if (leaps.length > 0)
      flag(
        3,
        `lines.${part}: leaps of more than a sixth; move mostly by step and thirds`,
      );
    const span = Math.max(...degrees) - Math.min(...degrees);
    // The candy bridge and tag hold long words on purpose.
    const held = line.some(([, , beats]) => beats >= 2);
    if (span < 2 && !held)
      flag(3, `lines.${part}: the line barely moves; give it a shape`);
  }

  // Verse lines answer each other: one shape for every line is a loop, not
  // a melody (and cannot follow the chords as they change).
  // A second verse may sing the first verse's tune to new words, so the
  // shapes are counted inside each verse.
  const shapeOf = (part: SheetPart) =>
    (sheet.lines[part] ?? []).map(([, d]) => d).join(",");
  for (const s of of("verse")) {
    const verseParts = (s.lines ?? []).filter(
      (part): part is SheetPart => !!part && !!sheet.lines[part],
    );
    const shapes = new Set(verseParts.map(shapeOf));
    if (verseParts.length >= 4 && shapes.size <= verseParts.length / 2)
      flag(
        6,
        `${s.name}: its ${verseParts.length} lines share ${shapes.size} melody shape${shapes.size === 1 ? "" : "s"}; give every line its own notes, answering the one before and fitting its bar's chord`,
      );
  }

  // Rhythm: when every line shares one onset pattern and one note length,
  // the singer sounds like a sequencer. Sung lines push and hold.
  const rhythms = [...sung].map((part) =>
    (sheet.lines[part] ?? []).map(([beat]) => beat).join(","),
  );
  const distinct = new Set(rhythms).size;
  if (rhythms.length >= 6 && distinct <= rhythms.length / 2)
    flag(
      6,
      `${rhythms.length} sung parts use only ${distinct} rhythm${distinct === 1 ? "" : "s"}; give each line its own rhythm, with pickups, off-beat pushes and rests`,
    );
  const lengths = [...sung].flatMap((part) =>
    (sheet.lines[part] ?? []).map(([, , beats]) => beats),
  );
  const counts = new Map<number, number>();
  for (const l of lengths) counts.set(l, (counts.get(l) ?? 0) + 1);
  const common = Math.max(0, ...counts.values());
  if (lengths.length >= 24 && common / lengths.length > 0.7)
    flag(
      5,
      `${Math.round((100 * common) / lengths.length)}% of sung notes have the same length; mix quick syllables with notes held a beat or more at the ends of lines`,
    );
  if (lengths.length >= 24 && !lengths.some((l) => l >= 1.5))
    flag(4, "hold the last word of some lines for 1.5 beats or more");

  // Melody: the chorus lifts above the verse and comes back.
  const mean = (list: number[]) =>
    list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
  if (pitches.verse!.length && pitches.chorus!.length) {
    if (mean(pitches.chorus!) < mean(pitches.verse!) + 2)
      flag(
        8,
        "lift the chorus: its notes should sit a third or more above the verse",
      );
    const range = Math.max(...pitches.chorus!) - Math.min(...pitches.chorus!);
    if (range < 5) flag(4, "widen the chorus melody to span a fourth or more");
  }
  for (const s of of("chorus")) {
    const parts = (s.lines ?? []).filter((p): p is SheetPart => !!p);
    // A part that opens like another (the same first five notes) repeats it.
    const opening = (part: SheetPart) =>
      (sheet.lines[part] ?? [])
        .slice(0, 5)
        .map(([, d]) => d)
        .join(",");
    if (parts.length >= 2 && new Set(parts.map(opening)).size === parts.length)
      flag(
        5,
        `${s.name}: repeat a chorus part (like ch1 ch2 ch1 ch3) so the hook sticks`,
      );
  }
  if (
    sections.some((s) => s.kind === "post" && s.lead) === false &&
    !sheet.hooks
  )
    flag(3, "write a lead hook (hooks) and play it in a later drop");

  found.sort((a, b) => b.cost - a.cost);
  const score = Math.max(0, 100 - found.reduce((n, f) => n + f.cost, 0));
  return { score, rubs: rubShare, notes: found.map((f) => f.note) };
}
