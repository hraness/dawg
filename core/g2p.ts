/**
 * English letter-to-sound for the machine-vox formant voice (lane V1):
 * context rules in the style of the NRL rules (Elovitz, Johnson, McHugh
 * and Shore 1976, a US Navy report in the public domain), a reduced set
 * written for this repository, plus a small hand-written dictionary of
 * common lyric words the rules get wrong. No CMUdict. Pure and
 * import-light: only the phone table.
 *
 * `phrasePhones` is the lyric contract: one entry per sung note in time
 * order (`{ lyric, ph }`), where a lyric ending in `-` continues its word
 * on the next note (`hel-` + `lo` = "hello"), `_` holds the previous vowel
 * (melisma) and a note without a lyric sings the track vowel. `ph`, when
 * present, overrides the rules for that note (the V0 `Note.vox.ph`).
 */
import { isVoxPhone, isVoxVowel, normalizePhone } from "./vox-phones.ts";

/** Bumped when the rules, the dictionary or the split change. */
export const G2P_VERSION = 1;

/**
 * Rules per first letter, most specific first: `left[match]right=phones`.
 * Context symbols: `#` one or more vowels, `:` zero or more consonants,
 * `^` one consonant, `.` one voiced consonant, `+` a front vowel (e i y),
 * `%` a suffix (er e es ed ing ely), `&` a sibilant, `@` a consonant that
 * makes a following u say "oo" (t s r d l z n j), a space a word edge.
 */
const RULE_TEXT: Readonly<Record<string, string>> = Object.freeze({
  a: `
 [a] =ax
 [are] =aa r
 [ar]o=ax r
[ar]#=eh r
 ^[as]#=ey s
[a]wa=ax
[aw]=ao
 :[any]=eh n iy
[a]^+#=ey
#:[ally]=ax l iy
 [al]#=ax l
[again]=ax g eh n
#:[ag]e=ih jh
[a]^+:#=ae
 :[a]^+ =ey
[a]^%=ey
 [arr]=ax r
[arr]=ae r
 :[ar] =aa r
[ar] =er
[ar]=aa r
[air]=eh r
[ai]=ey
[ay]=ey
[au]=ao
#:[al] =ax l
#:[als] =ax l z
[alk]=ao k
[al]^=ao l
 :[able]=ey b ax l
[able]=ax b ax l
[ang]+=ey n jh
[a]=ae`,
  b: `
 [be]^#=b ih
[being]=b iy ih ng
 [both] =b ow th
 [bus]#=b ih z
[buil]=b ih l
[bb]=b
[b]=b`,
  c: `
 [ch]^=k
^e[ch]=k
[ch]=ch
 s[ci]#=s ay
[ci]a=sh
[ci]o=sh
[ci]en=sh
[c]+=s
[ck]=k
[com]%=k ah m
[cc]+=k s
[c]=k`,
  d: `
#:[ded] =d ih d
.e[d] =d
#^:e[d] =t
 [de]^#=d ih
 [do] =d uw
 [does]=d ah z
 [doing]=d uw ih ng
 [dow]=d aw
[du]a=jh uw
[dd]=d
[d]=d`,
  e: `
#:[e] =
 :^[e] =
 :[e] =iy
#[ed] =d
#:[e]d =
[ev]er=eh v
[e]^%=iy
[eri]#=iy r iy
[eri]=eh r ih
#:[er]#=er
[er]#=eh r
[er]=er
 [even]=iy v eh n
#:[e]w=
@[ew]=uw
[ew]=y uw
[e]o=iy
#:&[es] =ih z
#:[e]s =
#:[ely] =l iy
#:[ement]=m eh n t
[eful]=f uh l
[ee]=iy
[earn]=er n
 [ear]^=er
[ead]=eh d
#:[ea] =iy ax
[ea]su=eh
[ea]=iy
[eigh]=ey
[ei]=iy
 [eye]=ay
[ey]=iy
[eu]=y uw
[e]=eh`,
  f: `
[ful]=f uh l
[ff]=f
[f]=f`,
  g: `
[giv]=g ih v
 [g]i^=g
[ge]t=g eh
su[gges]=g jh eh s
[gg]=g
 b#[g]=g
[g]+=jh
[great]=g r ey t
#[gh]=
[g]=g`,
  h: `
 [hav]=hh ae v
 [here]=hh iy r
 [hour]=aw er
[how]=hh aw
[h]#=hh
[h]=`,
  i: `
 [in]=ih n
 [i] =ay
[in]d=ay n
[ier]=iy er
#:r[ied] =iy d
[ied] =ay d
[ien]=iy eh n
[ie]t=ay eh
 :[i]%=ay
[i]%=iy
[ie]=iy
[i]^+:#=ih
[ir]#=ay r
[iz]%=ay z
[is]%=ay z
[i]d%=ay
+^[i]^+=ih
[i]t%=ay
#^:[i]^+=ih
[i]^+=ay
[ir]=er
[igh]=ay
[ild]=ay l d
[ign] =ay n
[ign]^=ay n
[ign]%=ay n
[ique]=iy k
[i]=ih`,
  j: `
[j]=jh`,
  k: `
 [k]n=
[k]=k`,
  l: `
[lo]c#=l ow
l[l]=
#^:[l]%=ax l
[lead]=l iy d
[l]=l`,
  m: `
[mov]=m uw v
[mm]=m
[mb] =m
[m]=m`,
  n: `
e[ng]+=n jh
[ng]%=ng
[ng]r=ng g
[ng]#=ng g
[ngl]%=ng g ax l
[ng]=ng
[nk]=ng k
 [now] =n aw
[nn]=n
[n]=n`,
  o: `
[of] =ax v
[orough]=er ow
#:[or] =er
#:[ors] =er z
[or]=ao r
 [one]=w ah n
[ow]=ow
 [over]=ow v er
[ov]=ah v
[o]^%=ow
[o]^en=ow
[o]^i#=ow
[ol]d=ow l
[ought]=ao t
[ough]=ah f
 [ou]=aw
h[ou]s#=aw
[ous]=ax s
[our]=aw r
[ould]=uh d
^[ou]^l=ah
[oup]=uw p
[ou]=aw
[oy]=oy
[oing]=ow ih ng
[oi]=oy
[oor]=ao r
[ook]=uh k
[ood]=uh d
[oo]=uw
[o]e=ow
[o] =ow
[oa]=ow
 [only]=ow n l iy
 [once]=w ah n s
[on't]=ow n t
c[o]n=aa
[o]ng=ao
 :^[o]n=ah
i[on]=ax n
#:[on] =ax n
#^[on]=ax n
[o]st =ow
[of]^=ao f
[other]=ah dh er
[oss] =ao s
#^:[om]=ah m
[o]=aa`,
  p: `
[ph]=f
[peop]=p iy p
[pow]=p aw
[put] =p uh t
[pp]=p
[p]=p`,
  q: `
[quar]=k w ao r
[qu]=k w
[q]=k`,
  r: `
 [re]^#=r iy
[rr]=r
[r]=r`,
  s: `
[sh]=sh
#[sion]=zh ax n
[some]=s ah m
#[sur]#=zh er
[sur]#=sh er
#[su]#=zh uw
#[ssu]#=sh uw
#[sed] =z d
#[s]#=z
[said]=s eh d
^[sion]=sh ax n
[s]s=
.[s] =z
#:.e[s] =z
#^:##[s] =z
#^:#[s] =s
u[s] =s
 :#[s] =z
 [sch]=s k
[s]c+=
#[sm]=z m
[s]=s`,
  t: `
 [the] =dh ax
[to] =t uw
[that] =dh ae t
 [this] =dh ih s
 [they]=dh ey
 [there]=dh eh r
[ther]=dh er
[their]=dh eh r
 [than] =dh ae n
 [them] =dh eh m
[these] =dh iy z
 [then]=dh eh n
[through]=th r uw
[those]=dh ow z
[though] =dh ow
 [thus]=dh ah s
[th]=th
#:[ted] =t ih d
s[ti]#n=ch
[ti]o=sh
[ti]a=sh
[tien]=sh ax n
[tur]#=ch er
[tu]a=ch uw
 [two]=t uw
[tt]=t
[t]=t`,
  u: `
 [un]i=y uw n
 [un]=ah n
 [upon]=ax p ao n
@[ur]#=uh r
[ur]#=y uh r
[ur]=er
[u]^ =ah
[u]^^=ah
[uy]=ay
 g[u]#=
g[u]%=
g[u]#=w
#n[u]=y uw
@[u]=uw
[u]=y uw`,
  v: `
[view]=v y uw
[v]=v`,
  w: `
 [were]=w er
[wa]s=w aa
[wa]t=w aa
[where]=w eh r
[what]=w ah t
[whol]=hh ow l
[who]=hh uw
[wh]=w
[war]=w ao r
[wor]^=w er
[wr]=r
[w]=w`,
  x: `
[x]=k s`,
  y: `
[young]=y ah ng
 [you]=y uw
 [yes]=y eh s
 [y]=y
#^:[y] =iy
#^:[y]i=iy
 :[y] =ay
 :[y]#=ay
 :[y]^+:#=ih
 :[y]^#=ay
[y]=ih`,
  z: `
[zz]=z
[z]=z`,
});

type Rule = Readonly<{
  left: string;
  match: string;
  right: string;
  phones: readonly string[];
}>;

function parseRules(): Readonly<Record<string, readonly Rule[]>> {
  const out: Record<string, Rule[]> = {};
  for (const [letter, text] of Object.entries(RULE_TEXT)) {
    const rules: Rule[] = [];
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      const m = /^(.*)\[(.+)\](.*)=(.*)$/.exec(line);
      if (!m) throw new Error(`g2p: bad rule "${line}"`);
      const phones = m[4]!.trim().split(/\s+/).filter(Boolean);
      for (const p of phones)
        if (!isVoxPhone(p)) throw new Error(`g2p: unknown phone "${p}"`);
      rules.push({ left: m[1]!, match: m[2]!, right: m[3]!, phones });
    }
    out[letter] = rules;
  }
  return out;
}

const RULES = parseRules();

const VOWELS = new Set("aeiou");
const isVowel = (c: string | undefined): boolean =>
  c !== undefined && VOWELS.has(c);
const isConsonant = (c: string | undefined): boolean =>
  c !== undefined && /[a-z]/.test(c) && !VOWELS.has(c);
const VOICED = new Set("bdvgjlmnrwz");
const FRONT = new Set("eiy");
const SIBILANT = new Set("scgzxj");
const U_LONG = new Set("tsrdlzjn");
const SUFFIXES = ["ing", "ely", "er", "es", "ed", "e"];

/** Matches a right context from `at` forward; returns success. */
function matchRight(pattern: string, word: string, at: number): boolean {
  if (pattern === "") return true;
  const c = pattern[0]!;
  const rest = pattern.slice(1);
  const ch = word[at];
  switch (c) {
    case " ":
      return ch === " " && matchRight(rest, word, at + 1);
    case "#": {
      if (!isVowel(ch)) return false;
      let i = at;
      while (isVowel(word[i])) i += 1;
      // greedy then back off
      for (let j = i; j > at; j -= 1) if (matchRight(rest, word, j)) return true;
      return false;
    }
    case ":": {
      let i = at;
      while (isConsonant(word[i])) i += 1;
      for (let j = i; j >= at; j -= 1) if (matchRight(rest, word, j)) return true;
      return false;
    }
    case "^":
      return isConsonant(ch) && matchRight(rest, word, at + 1);
    case ".":
      return ch !== undefined && VOICED.has(ch) && matchRight(rest, word, at + 1);
    case "+":
      return ch !== undefined && FRONT.has(ch) && matchRight(rest, word, at + 1);
    case "&":
      if (word.startsWith("ch", at) || word.startsWith("sh", at))
        return matchRight(rest, word, at + 2);
      return (
        ch !== undefined && SIBILANT.has(ch) && matchRight(rest, word, at + 1)
      );
    case "%":
      return SUFFIXES.some(
        (s) => word.startsWith(s, at) && matchRight(rest, word, at + s.length),
      );
    default:
      return ch === c && matchRight(rest, word, at + 1);
  }
}

/** Matches a left context ending just before `at`, right to left. */
function matchLeft(pattern: string, word: string, at: number): boolean {
  if (pattern === "") return true;
  const c = pattern[pattern.length - 1]!;
  const rest = pattern.slice(0, -1);
  const i = at - 1;
  const ch = word[i];
  switch (c) {
    case " ":
      return ch === " " && matchLeft(rest, word, i);
    case "#": {
      if (!isVowel(ch)) return false;
      let k = i;
      while (isVowel(word[k])) k -= 1;
      for (let j = k + 1; j <= i; j += 1) if (matchLeft(rest, word, j)) return true;
      return false;
    }
    case ":": {
      let k = i;
      while (isConsonant(word[k])) k -= 1;
      for (let j = k + 1; j <= at; j += 1) if (matchLeft(rest, word, j)) return true;
      return false;
    }
    case "^":
      return isConsonant(ch) && matchLeft(rest, word, i);
    case ".":
      return ch !== undefined && VOICED.has(ch) && matchLeft(rest, word, i);
    case "+":
      return ch !== undefined && FRONT.has(ch) && matchLeft(rest, word, i);
    case "&":
      return ch !== undefined && SIBILANT.has(ch) && matchLeft(rest, word, i);
    case "@":
      if (word.slice(i - 1, i + 1) === "th" || word.slice(i - 1, i + 1) === "ch")
        return matchLeft(rest, word, i - 1);
      return ch !== undefined && U_LONG.has(ch) && matchLeft(rest, word, i);
    default:
      return ch === c && matchLeft(rest, word, i);
  }
}

/** The rules' phones for one lower-case word of letters (and `'`). */
export function rulePhones(word: string): string[] {
  const text = ` ${word} `;
  const out: string[] = [];
  let at = 1;
  while (at < text.length - 1) {
    const ch = text[at]!;
    const rules = RULES[ch];
    if (!rules) {
      at += 1;
      continue;
    }
    let matched = false;
    for (const rule of rules) {
      if (
        text.startsWith(rule.match, at) &&
        matchLeft(rule.left, text, at) &&
        matchRight(rule.right, text, at + rule.match.length)
      ) {
        out.push(...rule.phones);
        at += rule.match.length;
        matched = true;
        break;
      }
    }
    if (!matched) at += 1;
  }
  return out;
}

const W = (phones: string): readonly string[] =>
  Object.freeze(phones.split(" "));

/**
 * Common lyric words the rules miss, written for this repository from
 * ordinary General American pronunciations (no dictionary was copied).
 */
const DICT_TEXT = `
a:ax|i:ay|the:dh ax|you:y uw|me:m iy|my:m ay|love:l ah v|heart:hh aa r t
baby:b ey b iy|oh:ow|yeah:y eh|night:n ay t|light:l ay t|know:n ow|go:g ow
one:w ah n|two:t uw|three:th r iy|four:f ao r|five:f ay v|six:s ih k s
seven:s eh v ax n|eight:ey t|nine:n ay n|ten:t eh n|zero:z ih r ow
are:aa r|your:y ao r|we:w iy|be:b iy|she:sh iy|he:hh iy|was:w ah z
what:w ah t|do:d uw|to:t uw|who:hh uw|come:k ah m|some:s ah m|done:d ah n
of:ah v|from:f r ah m|have:hh ae v|give:g ih v|live:l ih v|said:s eh d
says:s eh z|there:dh eh r|where:w eh r|were:w er|been:b ih n
again:ax g eh n|only:ow n l iy|world:w er l d|word:w er d|work:w er k
eye:ay|eyes:ay z|friend:f r eh n d|people:p iy p ax l|through:th r uw
though:dh ow|thought:th ao t|dance:d ae n s|sing:s ih ng|song:s ao ng
day:d ey|way:w ey|say:s ey|stay:s t ey|away:ax w ey|sky:s k ay|fly:f l ay
cry:k r ay|why:w ay|by:b ay|tonight:t ax n ay t|forever:f er eh v er
ever:eh v er|never:n eh v er|every:eh v r iy|hello:hh ax l ow
goodbye:g uh d b ay|good:g uh d|could:k uh d|would:w uh d|should:sh uh d
want:w aa n t|water:w ao t er|mother:m ah dh er|brother:b r ah dh er
other:ah dh er|nothing:n ah th ih ng|something:s ah m th ih ng
machine:m ax sh iy n|robot:r ow b aa t|computer:k ax m p y uw t er
voice:v oy s|music:m y uw z ih k|dream:d r iy m|feel:f iy l|time:t ay m
fire:f ay er|heaven:hh eh v ax n|alone:ax l ow n|home:hh ow m
woman:w uh m ax n|women:w ih m ax n|together:t ax g eh dh er|any:eh n iy
many:m eh n iy|does:d ah z|gone:g ao n|move:m uw v|touch:t ah ch
young:y ah ng|door:d ao r|floor:f l ao r|more:m ao r|sure:sh uh r
heard:hh er d|learn:l er n|break:b r ey k|great:g r ey t|listen:l ih s ax n
often:ao f ax n|ocean:ow sh ax n|tomorrow:t ax m aa r ow|hey:hh ey
la:l aa|da:d aa|na:n aa|ooh:uw|ah:aa|mmm:m|hmm:hh m|human:hh y uw m ax n
after:ae f t er|because:b ih k ah z|into:ih n t uw|down:d aw n|out:aw t
now:n aw|how:hh aw|our:aw er|hour:aw er|power:p aw er|flower:f l aw er
star:s t aa r|apart:ax p aa r t|sun:s ah n|run:r ah n|up:ah p|us:ah s
just:jh ah s t|much:m ah ch|such:s ah ch|is:ih z|it:ih t|in:ih n|on:aa n
and:ae n d|for:f ao r|with:w ih dh|this:dh ih s|that:dh ae t|all:ao l
can:k ae n|will:w ih l|not:n aa t|no:n ow|so:s ow|like:l ay k|get:g eh t
make:m ey k|take:t ey k|see:s iy|look:l uh k|back:b ae k|still:s t ih l
here:hh iy r|hear:hh iy r|tell:t eh l|well:w eh l|over:ow v er|close:k l ow z
open:ow p ax n|kiss:k ih s|hold:hh ow l d|wait:w ey t|believe:b ih l iy v
beautiful:b y uw t ih f ax l|girl:g er l|boy:b oy|man:m ae n|life:l ay f
die:d ay|lie:l ay|tears:t ih r z|rain:r ey n|summer:s ah m er|winter:w ih n t er
shine:sh ay n|speak:s p iy k|spell:s p eh l|talk:t ao k|walk:w ao k
data:d ey t ax|signal:s ih g n ax l|electric:ih l eh k t r ih k
system:s ih s t ax m|digital:d ih jh ih t ax l|future:f y uw ch er
`;

/** The exception dictionary: word to phones. */
export const VOX_DICT: Readonly<Record<string, readonly string[]>> =
  Object.freeze(
    Object.fromEntries(
      DICT_TEXT.trim()
        .split(/[|\n]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const [word, phones] = entry.split(":");
          return [word!, W(phones!.trim())];
        }),
    ),
  );

/** Words the dictionary holds (the doctor row prints this). */
export const VOX_DICT_SIZE = Object.keys(VOX_DICT).length;

/**
 * Phones for one word: the dictionary, then the rules. Case and
 * punctuation are ignored; a word with no letters has no phones.
 */
export function wordPhones(word: string): string[] {
  const clean = word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z']/g, "")
    .replace(/^'+|'+$/g, "");
  if (clean === "") return [];
  const known = VOX_DICT[clean] ?? VOX_DICT[clean.replace(/'/g, "")];
  if (known) return [...known];
  // possessive and contracted endings on a known word
  const s = /^(.+)'(s|re|ll|ve|d|m|t)$/.exec(clean);
  if (s && VOX_DICT[s[1]!]) {
    const tail: Record<string, string[]> = {
      s: ["z"],
      re: ["r"],
      ll: ["l"],
      ve: ["v"],
      d: ["d"],
      m: ["m"],
      t: ["t"],
    };
    return [...VOX_DICT[s[1]!]!, ...tail[s[2]!]!];
  }
  return rulePhones(clean.replace(/'/g, ""));
}

/** One sung note's input: its lyric, and phones that override the rules. */
export type VoxNoteInput = Readonly<{ lyric?: string; ph?: readonly string[] }>;

/**
 * What one note says: consonants at its start (`onset`), the vowel it holds
 * (`nucleus`, undefined to sing the note's own or the track's vowel) and
 * phones at its end (`coda`). `hold` marks a melisma note (`_`): it keeps
 * the previous vowel with no new onset.
 */
export type VoxSyllable = Readonly<{
  onset: readonly string[];
  nucleus?: string;
  coda: readonly string[];
  hold: boolean;
}>;

const EMPTY: VoxSyllable = Object.freeze({
  onset: Object.freeze([]),
  coda: Object.freeze([]),
  hold: false,
});

/** Two-consonant onsets English allows (maximal onset between vowels). */
const ONSETS = new Set(
  (
    "p r|p l|b r|b l|t r|t w|d r|d w|k r|k l|k w|g r|g l|g w|f r|f l|" +
    "th r|sh r|s p|s t|s k|s m|s n|s l|s w|s f|p y|b y|k y|m y|f y|v y|h y"
  ).split("|"),
);

/** Consonants between two vowels: how many start the next syllable. */
function onsetCount(cluster: readonly string[]): number {
  const n = cluster.length;
  if (n === 0) return 0;
  if (n === 1) return cluster[0] === "ng" ? 0 : 1;
  if (n >= 3 && cluster[n - 3] === "s" && ONSETS.has(cluster.slice(n - 2).join(" ")))
    return 3;
  if (ONSETS.has(cluster.slice(n - 2).join(" "))) return 2;
  return 1;
}

/**
 * Splits a word's phones over `count` syllable notes: one vowel nucleus
 * per note, consonants between vowels by maximal onset. Extra vowels go to
 * the last note's coda; notes beyond the vowels hold.
 */
export function splitSyllables(
  phones: readonly string[],
  count: number,
): VoxSyllable[] {
  const vowels: number[] = [];
  phones.forEach((p, i) => {
    if (isVoxVowel(p)) vowels.push(i);
  });
  const out: VoxSyllable[] = [];
  if (vowels.length === 0) {
    // a syllabic consonant ("hmm", "shh"): all of it on the first note
    out.push(
      Object.freeze({
        onset: Object.freeze([...phones]),
        coda: Object.freeze([]),
        hold: false,
      }),
    );
    while (out.length < count) out.push(Object.freeze({ ...EMPTY, hold: true }));
    return out;
  }
  const used = Math.min(count, vowels.length);
  // boundaries: syllable k spans [starts[k], starts[k+1])
  const starts = [0];
  for (let k = 1; k < used; k += 1) {
    const prev = vowels[k - 1]!;
    const next = vowels[k]!;
    const cluster = phones.slice(prev + 1, next);
    starts.push(next - onsetCount(cluster));
  }
  starts.push(phones.length);
  for (let k = 0; k < used; k += 1) {
    const part = phones.slice(starts[k], starts[k + 1]);
    const v = vowels[k]! - starts[k]!;
    out.push(
      Object.freeze({
        onset: Object.freeze(part.slice(0, v)),
        nucleus: part[v]!,
        coda: Object.freeze(part.slice(v + 1)),
        hold: false,
      }),
    );
  }
  while (out.length < count) out.push(Object.freeze({ ...EMPTY, hold: true }));
  return out;
}

/** `["HH","AH0","l"]` to table phones; unknown names are dropped. */
function cleanPhones(ph: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of ph) {
    const name = normalizePhone(p);
    if (name) out.push(name);
  }
  return out;
}

/** The sung vowel spellings `vowelOf` passes through (`a`, `a>o`, `oo`). */
const SUNG = /^(a|e|i|o|u|ah|eh|ee|oh|oo)(>(a|e|i|o|u|ah|eh|ee|oh|oo))?$/;

/**
 * The phones each note of a phrase says, in note order. Words continue
 * across notes whose lyric ends in `-`; a word's phones are split back
 * over its notes (`splitSyllables`). `_` holds; a missing lyric sings the
 * track vowel (an empty syllable). A note's `ph` replaces the rules for
 * that note alone: a note with `ph` ends any word in progress.
 */
export function phrasePhones(
  notes: readonly VoxNoteInput[],
): VoxSyllable[] {
  const out: VoxSyllable[] = new Array(notes.length);
  let word: number[] = [];
  let text = "";
  const flush = () => {
    if (word.length === 0) return;
    const sylls = splitSyllables(wordPhones(text), word.length);
    word.forEach((index, k) => {
      out[index] = sylls[k]!;
    });
    word = [];
    text = "";
  };
  notes.forEach((note, index) => {
    const lyric = note.lyric?.trim() ?? "";
    if (note.ph && note.ph.length > 0) {
      flush();
      const phones = cleanPhones(note.ph);
      out[index] =
        phones.length > 0 ? splitSyllables(phones, 1)[0]! : EMPTY;
      return;
    }
    if (lyric === "_") {
      // a hold inside a word does not end it
      out[index] = Object.freeze({ ...EMPTY, hold: true });
      return;
    }
    if (lyric === "" || lyric === "~") {
      flush();
      out[index] = EMPTY;
      return;
    }
    const continues = lyric.endsWith("-");
    const body = continues ? lyric.slice(0, -1) : lyric;
    if (
      word.length === 0 &&
      !continues &&
      body !== "I" &&
      SUNG.test(body.toLowerCase())
    ) {
      // a bare sung vowel (`a`, `oo`, `a>o`): the note's vowel, no consonants
      out[index] = EMPTY;
      return;
    }
    word.push(index);
    text += body;
    if (!continues) flush();
  });
  flush();
  return out;
}
