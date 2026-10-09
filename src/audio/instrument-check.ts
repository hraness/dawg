/**
 * Instrument words that fall through to dawg's plain sine voice. Unknown
 * words have always rendered as a sine (old projects keep doing so), and a
 * few pre-0.6 words (cello, organ, strings, bell, keys, lead, sitar) are that
 * same sine. `dawg check` and the `instrument` prompt name them instead of
 * playing a test tone silently.
 */

import { isGuideInstrument } from "../../core/clips.ts";
import { isDrumInstrument } from "../../core/drums.ts";
import { INSTRUMENT_WORDS, LEGACY_WORDS } from "../../core/instruments.ts";
import { KEYS_FAMILIES } from "../../core/keys.ts";
import { isSamplerInstrument, type Track } from "../../core/score.ts";
import { engineFor, registeredEngines } from "./instruments.ts";
import { resolveOscillator } from "./synth/oscillators.ts";
import { AVAILABLE_INSTRUMENTS } from "./wav.ts";

/** Substrings `legacyWave` gives their own tone (square, saw, bass, ...). */
const LEGACY_TONES = ["square", "saw", "triangle", "bass", "piano", "pluck"];

/** The 0.6 voice to point a plain-sine legacy word at. */
const LEGACY_ADVICE: Readonly<Record<string, string>> = Object.freeze({
  cello: "bowed cello for the bowed cello, synth preset strings for a pad",
  strings: "synth preset strings for a string pad",
  organ: "synth preset organ",
  bell: "modal glock or synth preset bell",
  keys: "piano grand or synth preset keys",
  lead: "synth preset lead",
  sitar: "string sitar for the plucked sitar",
});

/** Words worth suggesting for a typo. */
function knownWords(): readonly string[] {
  return [
    ...new Set([
      ...AVAILABLE_INSTRUMENTS,
      ...INSTRUMENT_WORDS.map((row) => row.word),
      ...KEYS_FAMILIES,
      ...registeredEngines(),
      "sampler",
    ]),
  ];
}

/** Whether `instrument` (on `track`) renders as the plain sine fallback. */
export function playsPlainSine(
  instrument: string,
  track?: Track | undefined,
): boolean {
  const name = instrument.trim().toLowerCase();
  if (name === "" || name.includes("sine")) return false;
  if (track && engineFor(track)) return false;
  // Engine ids and keys families name a 0.6 voice even without its field.
  if (registeredEngines().includes(name)) return false;
  if ((KEYS_FAMILIES as readonly string[]).includes(name)) return false;
  if (isDrumInstrument(name) || isSamplerInstrument(name)) return false;
  if (name === "wavetable" || resolveOscillator(name)) return false;
  if (isGuideInstrument(name)) return false;
  return !LEGACY_TONES.some((tone) => name.includes(tone));
}

/**
 * Advice for an instrument word that plays the plain sine, or undefined.
 * `marimba` and `wind` have their own note (legacyResonatorWarnings).
 */
export function plainSineAdvice(
  instrument: string,
  track?: Track | undefined,
): string | undefined {
  const name = instrument.trim().toLowerCase();
  if (name === "marimba" || name === "wind" || name === "modal")
    return undefined;
  if (!playsPlainSine(name, track)) return undefined;
  if (LEGACY_WORDS.includes(name)) {
    const advice = LEGACY_ADVICE[name];
    return `"${name}" is dawg's plain sine (kept for old projects)${advice ? ` · ${advice}` : ""}`;
  }
  const near = nearestWord(name, knownWords());
  // A resolver word stored raw (an older project): the word itself now
  // picks a voice when typed again.
  if (near === name)
    return `"${name}" is stored as a bare word and plays a plain sine · type instrument ${name} again for its voice`;
  return `"${name}" is not a dawg instrument and plays a plain sine${near ? ` · did you mean ${near}?` : ""}`;
}

/**
 * Whether `word` names an instrument exactly: an instrument word, preset,
 * engine, keys family, oscillator, drum, sampler or guide word, or a legacy
 * tone. The write path (`instrument <word>`) refuses anything else, so a typo
 * such as `sawtoth` is never stored. Stored projects are not checked here:
 * the read and render paths keep playing whatever they hold.
 */
export function isExactInstrument(word: string): boolean {
  const name = word.trim().toLowerCase();
  if (name === "") return false;
  if (
    name === "sine" ||
    LEGACY_TONES.includes(name) ||
    LEGACY_WORDS.includes(name) ||
    knownWords().includes(name)
  )
    return true;
  if (registeredEngines().includes(name)) return true;
  if ((KEYS_FAMILIES as readonly string[]).includes(name)) return true;
  if (isDrumInstrument(name) || isSamplerInstrument(name)) return true;
  if (isGuideInstrument(name)) return true;
  return name === "wavetable" || resolveOscillator(name) !== undefined;
}

/** Whether `word` is not an exact instrument name (see isExactInstrument). */
export function isUnknownInstrument(word: string): boolean {
  return !isExactInstrument(word);
}

/**
 * `✗ instrument sawtoth · did you mean sawtooth? · instrument list`: the
 * refusal for an instrument write that names nothing exactly.
 */
export function unknownInstrumentMessage(word: string): string {
  const name = word.trim().toLowerCase();
  const near = nearestWord(name, [...knownWords(), ...LEGACY_TONES, "sine"]);
  const shown = name.length > 32 ? `${name.slice(0, 31)}…` : name;
  return `instrument ${shown}${near && near !== name ? ` · did you mean ${near}?` : ""} · instrument list`;
}

/** `dawg check` warnings for every track that plays the plain sine. */
export function plainSineWarnings(tracks: readonly Track[]): string[] {
  const out: string[] = [];
  for (const track of tracks) {
    const advice = plainSineAdvice(track.instrument, track);
    if (advice) out.push(`track ${track.id}: instrument ${advice}`);
  }
  return out;
}

/** The closest of `words` to `word` within two edits, if any. */
export function nearestWord(
  word: string,
  words: readonly string[],
): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of words) {
    const distance = editDistance(word, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j]!;
      row[j] = Math.min(
        row[j]! + 1,
        row[j - 1]! + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = saved;
    }
  }
  return row[b.length]!;
}
