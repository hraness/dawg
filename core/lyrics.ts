/**
 * The lyric grammar and syllable assignment (0.7) shared by `/lyrics`,
 * `set_lyrics` and the SDK's `lyrics()`. No imports: the SDK carries a copy
 * between marker lines (`bun core/sdk/sync-lyrics.ts`).
 */

// ---- lyrics (copied into core/sdk/v1.ts)

/** Longest lyric on one note (SCORE_LIMITS.maxLyricLength). */
export const LYRIC_LIMIT = 32;

/** One lyric token: a syllable, a held note (`_`) or a skipped note (`~`). */
export type LyricToken = Readonly<{
  syl: string;
  /** Index of the word the token belongs to. */
  word: number;
  /** First syllable of its word. */
  first: boolean;
  kind: "syl" | "hold" | "rest";
  /** (0.9) The word goes on: the stored lyric ends in `-`. */
  cont?: boolean;
  /** (0.9) Phones typed in brackets, `[hh eh l]`, replacing letter-to-sound. */
  ph?: readonly string[];
  /** (0.9) A `,` came before this token: a breath before its note. */
  breath?: boolean;
}>;

/** Splits on spaces outside `[...]`. */
function lyricWords(text: string): string[] {
  const out: string[] = [];
  let word = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === "[") depth += 1;
    else if (ch === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/u.test(ch)) {
      if (word) out.push(word);
      word = "";
    } else word += ch;
  }
  if (word) out.push(word);
  return out;
}

/** `text[ph ones]` into its text and phones (lower case, stress dropped). */
function lyricSyl(raw: string): { text: string; ph?: string[] } {
  const at = raw.indexOf("[");
  if (at < 0) return { text: raw.replace(/\]/g, "") };
  const ph = raw
    .slice(at + 1)
    .replace(/\].*$/u, "")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((p) => p.toLowerCase().replace(/[0-2]$/u, ""));
  const text = raw.slice(0, at).replace(/[[\]]/g, "");
  return ph.length
    ? { text: text || ph.join(""), ph }
    : { text: text || raw.replace(/[[\]\s]/g, "") };
}

/**
 * The lyric grammar: words split by spaces, syllables by `-`, `_` holds the
 * previous syllable over the next note (melisma), `~` skips a note.
 * "sun-lit morn-ing _ glow" gives sun- lit morn- ing _ glow (0.9: every
 * syllable but a word's last keeps a trailing `-`; a word typed with a
 * trailing `-` continues into the next one, so stored text reads back).
 * 0.9 also reads `[hh eh l]` phones after a syllable, `,` for a breath
 * before the next syllable, and `/` as a line break (printing only).
 */
export function parseLyric(text: string): LyricToken[] {
  const out: LyricToken[] = [];
  let word = -1;
  let breath = false;
  let open = false;
  const push = (token: LyricToken) => {
    out.push(breath ? { ...token, breath: true } : token);
    breath = false;
  };
  for (const raw of lyricWords(text.trim())) {
    if (raw === ",") {
      breath = true;
      continue;
    }
    if (raw === "/") continue;
    const hold = raw.match(/^_(?:\[([^\]]*)\])?$/u);
    if (hold) {
      const ph = lyricSyl(`_[${hold[1] ?? ""}]`).ph;
      push({
        syl: "_",
        word,
        first: false,
        kind: "hold",
        ...(ph ? { ph } : {}),
      });
      continue;
    }
    if (raw === "~") {
      push({ syl: "~", word, first: false, kind: "rest" });
      continue;
    }
    // A leading `,` glued to the word is a breath too (`,hel-lo`).
    let body = raw;
    if (body.startsWith(",")) {
      breath = true;
      body = body.replace(/^,+/u, "");
    }
    const trailingComma = body.endsWith(",") && !body.endsWith("[,");
    if (trailingComma) body = body.replace(/,+$/u, "");
    const parts: string[] = [];
    let part = "";
    let depth = 0;
    for (const ch of body) {
      if (ch === "[") depth += 1;
      else if (ch === "]") depth = Math.max(0, depth - 1);
      if (ch === "-" && depth === 0) {
        parts.push(part);
        part = "";
      } else part += ch;
    }
    parts.push(part);
    const continues = parts.length > 1 && parts.at(-1) === "";
    const syls = parts.filter(Boolean);
    if (syls.length === 0) continue;
    if (!open) word += 1;
    syls.forEach((rawSyl, index) => {
      const { text: syl, ph } = lyricSyl(rawSyl);
      const last = index === syls.length - 1;
      push({
        syl,
        word,
        first: !open && index === 0,
        kind: "syl",
        ...(!last || continues ? { cont: true } : {}),
        ...(ph ? { ph } : {}),
      });
    });
    open = continues;
    if (trailingComma) breath = true;
  }
  return out;
}

const VOWEL = /[aeiouàáâäèéêëìíîïòóôöùúûü]/u;
/** Consonant pairs that sound as one consonant and are never split. */
const SYL_DIGRAPHS = new Set(["th", "sh", "ch", "ph", "wh", "ng", "ck", "gh"]);
/** Digraphs that end a syllable (no English word starts with them). */
const SYL_CODA_ONLY = new Set(["ng", "ck", "gh", "x"]);
/** Consonant clusters a syllable may start with (maximal onset). */
const SYL_ONSETS = new Set(
  (
    "bl br cl cr dr fl fr gl gr pl pr sc sk sl sm sn sp st sw tr tw dw " +
    "thr shr chr phr phl spl spr str scr squ skr"
  ).split(" "),
);
/** Common words ending in a silent `e` that start compounds (some-thing). */
const SYL_SILENT_E_HEADS = (
  "some home life time love fire side care where there here more one " +
  "make lone like name game base wide grace face place space stone bone"
).split(" ");
/** Suffixes kept whole after a silent `e` (love-ly, care-ful). */
const SYL_SUFFIXES = ["ly", "ful", "less", "ness", "ment"];
/** Unstressed endings that close a short vowel before them (nev-er). */
const SYL_CLOSING_ENDINGS = new Set([
  "er",
  "en",
  "el",
  "et",
  "ed",
  "es",
  "est",
  "ing",
]);

/**
 * Syllables of a word typed without hyphens: a guess for English, which a
 * hyphen always overrides (`nev-er`). Each run of vowels (and `y` after a
 * consonant) is one syllable; a final silent `e` does not count, but a
 * consonant plus `le` is its own syllable (lit-tle, ta-ble). Consonant
 * pairs that sound as one (th sh ch ph wh ng ck gh) never split. Between
 * vowels a cluster gives the next syllable the longest onset English
 * allows (mon-ster, chil-dren); one consonant goes with the next vowel
 * (ba-by, to-night) unless the previous vowel is short before an
 * unstressed ending (nev-er, sing-ing). "something" gives some thing,
 * "forever" for ev er.
 */
export function autoSyllabify(word: string): string[] {
  const w = word.toLowerCase();
  // Compounds and suffixes after a silent e: some-thing, love-ly.
  if (w.length >= 6) {
    for (const head of SYL_SILENT_E_HEADS)
      if (w.startsWith(head) && VOWEL.test(w.slice(head.length)))
        return [
          word.slice(0, head.length),
          ...autoSyllabify(word.slice(head.length)),
        ];
    for (const suffix of SYL_SUFFIXES) {
      const stem = w.slice(0, -suffix.length);
      if (
        w.endsWith(suffix) &&
        stem.length >= 3 &&
        stem.endsWith("e") &&
        !VOWEL.test(stem[stem.length - 2]!)
      )
        return [
          ...autoSyllabify(word.slice(0, stem.length)),
          word.slice(stem.length),
        ];
    }
  }
  // Letters into units: a vowel, a consonant, a digraph, or `qu`.
  type Unit = { at: number; text: string; vowel: boolean };
  const units: Unit[] = [];
  for (let i = 0; i < w.length;) {
    const pair = w.slice(i, i + 2);
    if (pair === "qu" || SYL_DIGRAPHS.has(pair)) {
      units.push({ at: i, text: pair, vowel: false });
      i += 2;
      continue;
    }
    const ch = w[i]!;
    const prev = units.at(-1);
    const vowel =
      VOWEL.test(ch) || (ch === "y" && prev !== undefined && !prev.vowel);
    units.push({ at: i, text: ch, vowel });
    i += 1;
  }
  // Vowel groups as [first unit, last unit].
  const groups: [number, number][] = [];
  for (let u = 0; u < units.length;) {
    if (units[u]!.vowel) {
      let v = u;
      while (v + 1 < units.length && units[v + 1]!.vowel) v += 1;
      groups.push([u, v]);
      u = v + 1;
    } else u += 1;
  }
  const lastUnit = units.length - 1;
  const finalLe =
    w.endsWith("le") &&
    units.length >= 3 &&
    units[lastUnit - 1]!.text === "l" &&
    !units[lastUnit - 2]!.vowel;
  const last = groups.at(-1);
  if (
    groups.length > 1 &&
    last &&
    last[0] === lastUnit &&
    last[1] === lastUnit &&
    units[lastUnit]!.text === "e" &&
    !units[lastUnit - 1]!.vowel &&
    !finalLe
  )
    groups.pop();
  if (groups.length <= 1) return [word];
  const cuts: number[] = [];
  for (let g = 1; g < groups.length; g += 1) {
    const prev = groups[g - 1]!;
    const next = groups[g]!;
    const cluster = units.slice(prev[1] + 1, next[0]);
    const n = cluster.length;
    const isLast = g === groups.length - 1;
    let onset: number; // units of the cluster that start the next syllable
    if (isLast && finalLe && n >= 2)
      onset = cluster[n - 2]!.text === "ck" ? 1 : 2;
    else if (n === 1) {
      const unit = cluster[0]!.text;
      const prevText = units
        .slice(prev[0], prev[1] + 1)
        .map((u) => u.text)
        .join("");
      const ending = w.slice(units[next[0]]!.at);
      const short = prevText.length === 1 && "eiou".includes(prevText);
      const closes =
        SYL_CODA_ONLY.has(unit) ||
        (short && isLast && SYL_CLOSING_ENDINGS.has(ending)) ||
        (unit === "r" && short && units[next[0]]!.text === "e");
      onset = closes ? 0 : 1;
    } else {
      onset = 1;
      for (let k = n - 1; k >= 2; k -= 1)
        if (
          SYL_ONSETS.has(
            cluster
              .slice(n - k)
              .map((u) => u.text)
              .join(""),
          )
        ) {
          onset = k;
          break;
        }
      if (SYL_CODA_ONLY.has(cluster[n - 1]!.text)) onset = 0;
    }
    const first = units[next[0] - onset]!;
    cuts.push(onset === 0 ? units[next[0]]!.at : first.at);
  }
  const out: string[] = [];
  let at = 0;
  for (const cut of cuts) {
    out.push(word.slice(at, cut));
    at = cut;
  }
  out.push(word.slice(at));
  return out.filter(Boolean);
}

/** What `assignLyrics` put on each note, and what did not fit. */
export type LyricAssignment = Readonly<{
  /** Note id to its lyric (`_` holds); notes `~` skipped are absent. */
  lyrics: ReadonlyMap<string, string>;
  /** (0.9) Note id to the phones typed in brackets for it. */
  ph: ReadonlyMap<string, readonly string[]>;
  /** (0.9) Notes a `,` put a breath before. */
  breaths: ReadonlySet<string>;
  /** Syllables left over after the last note. */
  dropped: readonly string[];
  /** Words split automatically. */
  split: readonly string[];
}>;

/**
 * Lyrics onto `notes` in time order. Hyphens split syllables as typed;
 * when the text has fewer syllables than there are notes, words typed
 * whole are split by `autoSyllabify`, and any notes still left hold the
 * last syllable (melisma) instead of failing. Syllables past the last note
 * are reported in `dropped`. Notes sharing an onset take one token, on
 * the top note, with `_` on the others. Each lyric is cut to the 32-character
 * limit; a syllable whose word goes on keeps a trailing `-`.
 */
export function assignLyrics(
  text: string,
  notes: readonly Readonly<{ id: string; startTick: number; pitch: number }>[],
): LyricAssignment {
  const sorted = [...notes].sort(
    (a, b) => a.startTick - b.startTick || b.pitch - a.pitch,
  );
  // Notes sharing an onset (a chord or a doubled note) take one token: the
  // top note carries it and the rest hold.
  const ordered: (typeof sorted)[number][] = [];
  const under = new Map<string, string[]>();
  for (const note of sorted) {
    const top = ordered.at(-1);
    if (top && top.startTick === note.startTick)
      under.get(top.id)!.push(note.id);
    else {
      ordered.push(note);
      under.set(note.id, []);
    }
  }
  let tokens = parseLyric(text);
  const split: string[] = [];
  if (tokens.length < ordered.length) {
    // Split every word typed whole; keep the split only if it still fits.
    const out: LyricToken[] = [];
    const words: string[] = [];
    for (const token of tokens) {
      const whole =
        token.kind === "syl" &&
        token.first &&
        !token.cont &&
        !token.ph &&
        !tokens.some((t) => t.word === token.word && !t.first);
      if (!whole) {
        out.push(token);
        continue;
      }
      const parts = autoSyllabify(token.syl);
      if (parts.length > 1) words.push(token.syl);
      parts.forEach((syl, index) =>
        out.push({
          syl,
          word: token.word,
          first: index === 0,
          kind: "syl",
          ...(index < parts.length - 1 ? { cont: true } : {}),
          ...(index === 0 && token.breath ? { breath: true } : {}),
        }),
      );
    }
    if (out.length <= ordered.length) {
      tokens = out;
      split.push(...words);
    }
  }
  const lyrics = new Map<string, string>();
  const ph = new Map<string, readonly string[]>();
  const breaths = new Set<string>();
  const limit = LYRIC_LIMIT;
  ordered.forEach((note, index) => {
    const token = tokens[index];
    if (!token) {
      if (tokens.length > 0)
        for (const id of [note.id, ...under.get(note.id)!]) lyrics.set(id, "_");
      return;
    }
    if (token.breath) breaths.add(note.id);
    if (token.kind === "rest") return;
    if (token.ph) ph.set(note.id, token.ph);
    lyrics.set(
      note.id,
      token.kind === "hold"
        ? "_"
        : token.cont
          ? `${token.syl.slice(0, limit - 1)}-`
          : token.syl.slice(0, limit),
    );
    for (const id of under.get(note.id)!) lyrics.set(id, "_");
  });
  const dropped = tokens
    .slice(ordered.length)
    .filter((token) => token.kind === "syl")
    .map((token) => token.syl);
  return { lyrics, ph, breaths, dropped, split };
}

/**
 * The lyric line of notes in time order, in the grammar `parseLyric` reads
 * back: `hel[hh eh l]-lo _ , world`. A note without a lyric is `~` (trailing
 * ones are left out); `ph` and `breath` come from each note's `vox`.
 */
export function lyricLine(
  notes: readonly Readonly<{
    lyric?: string;
    vox?: Readonly<{ ph?: readonly string[]; breath?: number }>;
  }>[],
): string {
  let end = notes.length;
  while (end > 0 && notes[end - 1]!.lyric === undefined) end -= 1;
  let out = "";
  let joined = false;
  for (const note of notes.slice(0, end)) {
    const lyric = note.lyric ?? "~";
    const ph = note.vox?.ph;
    const dash = lyric.length > 1 && lyric.endsWith("-");
    const body = dash ? lyric.slice(0, -1) : lyric;
    const cell = `${body}${ph && ph.length && lyric !== "~" ? `[${ph.join(" ")}]` : ""}${dash ? "-" : ""}`;
    const breath = note.vox?.breath ? ", " : "";
    if (out === "") out = `${breath}${cell}`;
    else if (joined && !breath && lyric !== "_" && lyric !== "~") out += cell;
    else out += ` ${breath}${cell}`;
    joined = dash;
  }
  return out;
}
