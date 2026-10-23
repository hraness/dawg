/**
 * The critic: deterministic musical checks on a validated sheet, distilled
 * from what made the demos work and from the owner's notes on what did not.
 * It scores 0..100 and says what to change in words a model can act on, so
 * a generate loop can send the notes back for another round.
 */
import type { Part } from "../../demos/hyperpop.ts";
import {
  chordClasses,
  degreePitch,
  numeralDegree,
  parseKey,
  type SongSheet,
} from "./sheet.ts";

export type Critique = Readonly<{
  score: number;
  /** What to fix, worst first. */
  notes: readonly string[];
}>;

const partBars = (part: Part) => (part.startsWith("ch") ? 2 : 1);

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
  let strong = 0;
  let onChord = 0;
  let rubbed = 0;
  const rubs: string[] = [];
  const pitches: Record<string, number[]> = { verse: [], chorus: [] };
  const sung = new Set<Part>();
  for (const s of sections)
    (s.lines ?? []).forEach((part, bar) => {
      if (!part) return;
      const line = sheet.lines[part];
      if (!line) return;
      sung.add(part);
      for (const [beat, degree] of line) {
        const pitch = degreePitch(key, degree);
        if (s.kind === "verse" || s.kind === "chorus")
          pitches[s.kind]!.push(pitch);
        if (beat % 1 !== 0) continue;
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
      }
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
      Math.max(3, Math.round(rubShare * 25)),
      `${Math.round(rubShare * 100)}% of on-beat notes clash a semitone with the chord; on every beat sing a chord tone of that bar's chord (bar k of a section plays progression[k mod length])${rubs.length ? `: ${rubs.join("; ")}` : ""}`,
    );
  else if (share < 0.75)
    flag(
      Math.round((0.75 - share) * 40),
      `only ${Math.round(share * 100)}% of on-beat notes are chord tones; land more beats on the root, third or fifth`,
    );
  for (const [part, line] of Object.entries(sheet.lines)) {
    if (!sung.has(part as Part)) {
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
    if (span < 2)
      flag(3, `lines.${part}: the line barely moves; give it a shape`);
  }

  // Verse lines answer each other: one shape for every line is a loop, not
  // a melody (and cannot follow the chords as they change).
  const verseParts = [...sung].filter((part) => part.startsWith("v"));
  const shapes = new Set(
    verseParts.map((part) =>
      (sheet.lines[part] ?? []).map(([, d]) => d).join(","),
    ),
  );
  if (verseParts.length >= 4 && shapes.size <= verseParts.length / 2)
    flag(
      6,
      `${verseParts.length} verse lines share ${shapes.size} melody shape${shapes.size === 1 ? "" : "s"}; give every line its own notes, answering the one before and fitting its bar's chord`,
    );

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
    const parts = (s.lines ?? []).filter(Boolean);
    if (parts.length >= 2 && new Set(parts).size === parts.length)
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
  return { score, notes: found.map((f) => f.note) };
}
