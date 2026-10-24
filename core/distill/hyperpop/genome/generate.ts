/**
 * Brief in, song out, the genome way: the model writes a song card (words,
 * mood, the axes the brief names) and the seed draws every other axis. A
 * new seed is a new song for the same brief. The card loop only retries
 * an unreadable card; there is no template for a critic to hold it to.
 */
import type { SheetModel } from "../generate.ts";
import { parseReply } from "../generate.ts";
import {
  cardContent,
  cardMessages,
  cardPins,
  cardSchema,
  validateCard,
  type SongCard,
} from "./card.ts";
import { compileGenome, type GenSong } from "./compose.ts";
import { sampleGenome } from "./genome.ts";
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

/** A song from a card and a seed, no model involved. */
export function songFromCard(card: SongCard, seed: number): GenSong {
  return compileGenome(
    sampleGenome(seed, cardPins(card, new Rng(seed).fork("card"))),
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
  let retry: { reply: string; notes: readonly string[] } | undefined;
  let last: readonly string[] = [];
  for (let round = 1; round <= rounds; round++) {
    const started = Date.now();
    const reply = await model(cardMessages(brief, seed, retry), schema);
    let notes: readonly string[];
    try {
      const checked = validateCard(parseReply(reply));
      if (checked.ok) {
        options.onRound?.({
          round,
          ok: true,
          notes: checked.warnings,
          ms: Date.now() - started,
        });
        return {
          ...songFromCard(checked.card, seed),
          card: checked.card,
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
