/**
 * Generated hyperpop: a seeded genome over independent axes (groove,
 * harmony language, sounds, voice, form, moves, counterpoint) composed by
 * a modular arranger. A model writes the words, the taste and the music
 * (chords, motifs, arranging habits) for the constraints the seed draws.
 */
export {
  briefPins,
  cardContent,
  cardMessages,
  cardPins,
  cardSchema,
  CARD_GUIDE,
  EXAMPLE_CARDS,
  syllables,
  validateCard,
  type SongCard,
} from "./card.ts";
export {
  compileGenome,
  songSections,
  type Content,
  type GenSong,
  type Section,
} from "./compose.ts";
export {
  briefConstraints,
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
export {
  motifOf,
  musicSchema,
  numeral,
  readMusic,
  validateMusic,
  type Music,
  type MotifText,
} from "./music.ts";
