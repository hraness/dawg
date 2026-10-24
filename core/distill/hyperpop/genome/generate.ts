/**
 * Brief in, song out, the genome way: the model writes a song card (words,
 * mood, the axes the brief names) and the seed draws every other axis. A
 * new seed is a new song for the same brief. The card loop only retries
 * an unreadable card; there is no template for a critic to hold it to.
 */
import type { SheetModel } from "../generate.ts";
import { parseReply } from "../generate.ts";
import {
  briefPins,
  cardContent,
  cardMessages,
  cardPins,
  cardSchema,
  musicNotes,
  validateCard,
  type SongCard,
} from "./card.ts";
import { compileGenome, songSections, type GenSong } from "./compose.ts";
import { describeGenome, sampleGenome } from "./genome.ts";
import { Rng } from "./rng.ts";

export type GenomeGenerated = GenSong &
  Readonly<{
    card: SongCard;
    seed: number;
    warnings: readonly string[];
    rounds: number;
  }>;

export type GenomeOptions = Readonly<{
  /** The song's seed; a random one when absent. */
  seed?: number;
  /** Card attempts in all (default 3). */
  rounds?: number;
  onRound?: (
    round: Readonly<{
      round: number;
      ok: boolean;
      notes: readonly string[];
      ms: number;
    }>,
  ) => void;
}>;

export const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

/** `seed` mixed with `text`. */
function mix(text: string, seed: number): number {
  let h = 0x811c9dc5;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return ((h ^ seed) >>> 0) % 2 ** 31;
}

/**
 * The seed a card's song is drawn from: the seed mixed with the card's brief
 * (or, for a card written without one, its words), so two briefs on one seed
 * are two songs, and a saved card replays exactly.
 */
export function cardSeed(card: SongCard, seed: number): number {
  return mix(card.brief ?? `${card.title}\n${card.hook}`, seed);
}

/**
 * What the model writes for: the constraints the seed draws for `brief`,
 * before any card exists. A card that pins nothing gets exactly these.
 */
export function briefConstraints(brief: string, seed: number): string[] {
  const g = sampleGenome(mix(brief, seed));
  const kinds = songSections(g).map((x) =>
    x.name.replace(/ \d+$/, "").toLowerCase(),
  );
  // The harmony line is the seed's own chord language, which the model's chords replace.
  return [
    ...describeGenome(g).filter((line) => !line.startsWith("harmony:")),
    `sections: ${kinds.join(", ")}`,
  ];
}

/** A song from a card and a seed, no model involved. */
export function songFromCard(card: SongCard, seed: number): GenSong {
  const s = cardSeed(card, seed);
  return compileGenome(
    sampleGenome(s, cardPins(card, new Rng(s).fork("card"))),
    cardContent(card),
  );
}

export async function generateGenomeSong(
  brief: string,
  model: SheetModel,
  options: GenomeOptions = {},
): Promise<GenomeGenerated> {
  const seed = options.seed ?? randomSeed();
  const rounds = Math.max(1, options.rounds ?? 3);
  const schema = cardSchema();
  const constraints = briefConstraints(brief, seed);
  const scale = sampleGenome(mix(brief, seed)).scale;
  let retry: { reply: string; notes: readonly string[] } | undefined;
  let last: readonly string[] = [];
  for (let round = 1; round <= rounds; round++) {
    const started = Date.now();
    const reply = await model(
      cardMessages(brief, seed, retry, constraints),
      schema,
    );
    let notes: readonly string[];
    try {
      const checked = validateCard(parseReply(reply));
      if (checked.ok) {
        const fixes = musicNotes(checked.card, scale);
        if (fixes.length && round < rounds) {
          options.onRound?.({
            round,
            ok: false,
            notes: fixes,
            ms: Date.now() - started,
          });
          last = fixes;
          retry = { reply: reply.slice(0, 8000), notes: fixes };
          continue;
        }
        options.onRound?.({
          round,
          ok: true,
          notes: [...checked.warnings, ...fixes],
          ms: Date.now() - started,
        });
        const card = { ...briefPins(checked.card, brief), brief };
        return {
          ...songFromCard(card, seed),
          card,
          seed,
          warnings: checked.warnings,
          rounds: round,
        };
      }
      notes = checked.errors;
    } catch (error) {
      notes = [
        `the reply was not a JSON card (${(error as Error).message}); reply with JSON only`,
      ];
    }
    options.onRound?.({ round, ok: false, notes, ms: Date.now() - started });
    last = notes;
    retry = { reply: reply.slice(0, 8000), notes };
  }
  throw new Error(
    `no valid card after ${rounds} rounds: ${last.slice(0, 4).join("; ")}`,
  );
}
