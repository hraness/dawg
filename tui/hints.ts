/**
 * Seeded hints: the empty-highway line and the prompt placeholder.
 *
 * Each list is chosen by what the session can do (an agent or commands
 * only) and what the song holds (empty, pitched, drums), and one entry is
 * picked by hashing the session id, so a session keeps the same words
 * while it runs and the next session reads a different, equally short one.
 * Every example is original and every command in it runs as typed.
 */

export type HintState = Readonly<{
  /** The session id (or any stable string): the seed. */
  seed: string;
  /** An agent provider is ready, so prose requests work. */
  agent: boolean;
  /** The song has notes, clips or layers. */
  filled: boolean;
  /** The focused track is a drum kit. */
  drums?: boolean;
  /** The focused track is a vocal track. */
  vocal?: boolean;
  /** The transport is running. */
  playing?: boolean;
  /** The agent is busy and Enter queues for after it. */
  queue?: boolean;
}>;

/** FNV-1a: a small, stable string hash. */
export function seedHash(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The entry of `list` the seed picks; `salt` decorrelates two lists. */
export function pick<T>(list: readonly T[], seed: string, salt = ""): T {
  return list[seedHash(`${salt}:${seed}`) % list.length]!;
}

/** Prose requests an agent understands, for the placeholder. */
const ASK_EMPTY = [
  "describe a song — “a slow lofi loop in F with soft drums”",
  "describe a song — “a four-bar house groove at 124 BPM”",
  "describe a song — “a sad waltz for piano and cello”",
  "describe a song — “a bright synth arpeggio in D major”",
  "describe a song — “a dusty boom bap beat with a walking bass”",
] as const;

const ASK_FILLED = [
  "describe a change — “add a walking bass in A minor”",
  "describe a change — “make the drums swing a little”",
  "describe a change — “double the melody an octave up”",
  "describe a change — “add reverb to the keys”",
  "describe a change — “slow it to 90 BPM and add a fill”",
] as const;

const ASK_DRUMS = [
  "describe a change — “a ghost-note snare on the offbeats”",
  "describe a change — “open hats on every and”",
  "describe a change — “a crash on bar one, then a fill”",
] as const;

/**
 * Commands that run without an agent, for the placeholder. `{style}` is the
 * same seeded style the wide empty line suggests, so the two lines never
 * offer competing first steps.
 */
const TYPE_EMPTY = [
  "try: style {style} · space play · /help",
  "try: style {style} 8 · then space to hear it",
  "try: add C4 at 0 · add E4 at 1 · space play",
  "try: style {style} · ctrl-z undo",
] as const;

const TYPE_FILLED = [
  "try: tempo 96 · reverb 0.3 · space play",
  "try: style again · ctrl-z undo",
  "try: add G4 at 2 · bars 8 · space play",
  "try: volume 0.6 · pan -0.2 · /help",
] as const;

const TYPE_DRUMS = [
  "try: hit kick at 0 · hit snare at 1 · space play",
  "try: euclid hat 7 16 · tempo 100",
] as const;

/**
 * The keys on the empty line (design §8.5): transport, play mode and the
 * menu while paused; while playing, how to stop and, with an agent, that a
 * request still works.
 */
const KEYS_PAUSED = "space play · ctrl-p play mode · ctrl-k menu";
const KEYS_PLAYING_AGENT = "space stop · type a request";
const KEYS_PLAYING = "space stop · ctrl-p play mode";

/** How to start a drum track or a vocal track, before the keys. */
const LEAD_DRUMS = "hit kick at 0";
const LEAD_VOCAL = 'lyrics "la la" · sing ooh · ctrl-k › Voice';

/** Styles a wide empty line suggests, one per session (all have cards). */
export const SUGGESTED_STYLES = [
  "deep-house",
  "lofi-hip-hop",
  "bossa-nova",
  "nu-disco",
  "synthwave",
  "golden-age",
] as const;

/** From this width the empty line also suggests a seeded style. */
export const STYLE_HINT_WIDTH = 100;

/** The prompt placeholder for this session and state. */
export function placeholderHint(state: HintState): string {
  if (state.agent && state.queue) return "queue a request for after this one…";
  const list = state.agent
    ? state.drums && state.filled
      ? ASK_DRUMS
      : state.filled
        ? ASK_FILLED
        : ASK_EMPTY
    : state.drums
      ? TYPE_DRUMS
      : state.filled
        ? TYPE_FILLED
        : TYPE_EMPTY;
  return pick(list, state.seed, "placeholder").replace(
    "{style}",
    sessionStyle(state.seed),
  );
}

/** The one style this session suggests, on the empty line and the prompt. */
export function sessionStyle(seed: string): string {
  return pick(SUGGESTED_STYLES, seed, "style");
}

/**
 * The empty-highway line, `<name> · empty · <lead> · <keys>`, shortened to
 * `width`: the lead goes first, then the keys shrink to their first
 * clause, then the name alone. A drum track leads with `hit kick at 0`, a
 * vocal track with lyrics and sing, and from 100 columns a pitched track
 * suggests a seeded style.
 */
export function emptyHint(
  state: HintState,
  name: string,
  width: number,
): string {
  const keys = state.playing
    ? state.agent
      ? KEYS_PLAYING_AGENT
      : KEYS_PLAYING
    : KEYS_PAUSED;
  const lead = state.drums
    ? LEAD_DRUMS
    : state.vocal
      ? LEAD_VOCAL
      : width >= STYLE_HINT_WIDTH && !state.playing
        ? `try style ${sessionStyle(state.seed)}`
        : undefined;
  const head = `${name} · empty`;
  const candidates = [
    ...(lead ? [`${head} · ${lead} · ${keys}`] : []),
    `${head} · ${keys}`,
    `${head} · ${keys.split(" · ")[0]}`,
  ];
  for (const candidate of candidates)
    if (candidate.length <= width) return candidate;
  return head.slice(0, Math.max(0, width));
}

/** Every hint string, for the shipped-text and command checks. */
export const ALL_HINTS: readonly string[] = [
  ...ASK_EMPTY,
  ...ASK_FILLED,
  ...ASK_DRUMS,
  ...TYPE_EMPTY.flatMap((hint) =>
    SUGGESTED_STYLES.map((id) => hint.replace("{style}", id)),
  ),
  ...TYPE_FILLED,
  ...TYPE_DRUMS,
  KEYS_PAUSED,
  KEYS_PLAYING_AGENT,
  KEYS_PLAYING,
  LEAD_DRUMS,
  LEAD_VOCAL,
  ...SUGGESTED_STYLES.map((id) => `try style ${id}`),
];
