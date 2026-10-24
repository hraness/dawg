/**
 * Generated hyperpop: a seeded genome over independent axes (groove,
 * harmony language, sounds, voice, form, moves, counterpoint) composed by
 * a modular arranger, with a model writing only the words and the taste.
 */
export {
  briefPins,
  cardContent,
  cardMessages,
  cardPins,
  cardSchema,
  CARD_GUIDE,
  syllables,
  validateCard,
  type SongCard,
} from "./card.ts";
export {
  compileGenome,
  type Content,
  type GenSong,
  type Section,
} from "./compose.ts";
export {
  cardSeed,
  generateGenomeSong,
  randomSeed,
  songFromCard,
  type GenomeGenerated,
  type GenomeOptions,
} from "./generate.ts";
export {
  describeGenome,
  DEVICES,
  FORMS,
  GRAMMARS,
  sampleGenome,
  VOICES,
  type Genome,
  type GenomePins,
} from "./genome.ts";
export {
  distance,
  fingerprint,
  spread,
  type Fingerprint,
  type Spread,
} from "./diversity.ts";
