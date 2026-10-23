/**
 * The song sheet as a JSON schema, for grammar-constrained decoding
 * (llama.cpp `response_format`): a small model can only emit field names,
 * pattern names and layers that exist. Counts and ranges the grammar cannot
 * hold are left to `validateSheet`, which answers with fix-it messages.
 */
import { PARTS } from "../../demos/hyperpop.ts";
import { LIBRARY, PATTERN_SLOTS } from "./library.ts";
import { DRUMS, KINDS, LAYERS, PALETTES } from "./sheet.ts";

const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"].flatMap((n) => [
  n,
  n.toLowerCase(),
]);

export function sheetSchema(): Record<string, unknown> {
  // [beat, degree, beats, syllable]
  const line = {
    type: "array",
    items: {
      type: "array",
      prefixItems: [
        { type: "number" },
        { type: "integer" },
        { type: "number" },
        { type: "string" },
      ],
      minItems: 4,
      maxItems: 4,
    },
    minItems: 2,
    maxItems: 16,
  };
  const note = {
    type: "array",
    items: { type: "number" },
    minItems: 3,
    maxItems: 3,
  };
  const patterns = Object.fromEntries(
    PATTERN_SLOTS.map((slot) => [slot, { enum: Object.keys(LIBRARY[slot]) }]),
  );
  const section = {
    type: "object",
    properties: {
      kind: { enum: KINDS },
      name: { type: "string" },
      bars: { type: "integer" },
      chords: { type: "string" },
      drums: { type: "array", items: { enum: DRUMS }, minItems: 1 },
      energy: { type: "number" },
      play: { type: "array", items: { enum: LAYERS } },
      lines: { type: "array", items: { enum: [...PARTS, null] } },
      ...patterns,
      lead: { type: "array", items: { type: "string" } },
      voiceLead: { type: "boolean" },
      bursts: { type: "boolean" },
      enter: {
        type: "object",
        properties: Object.fromEntries(
          LAYERS.map((l) => [l, { type: "integer" }]),
        ),
        additionalProperties: false,
      },
    },
    required: ["kind", "name", "bars", "chords", "drums", "play"],
    additionalProperties: false,
  };
  return {
    type: "object",
    properties: {
      title: { type: "string" },
      bpm: { type: "integer" },
      key: { type: "string" },
      palette: { enum: PALETTES },
      progressions: {
        type: "object",
        additionalProperties: {
          type: "array",
          items: { enum: NUMERALS },
          minItems: 1,
          maxItems: 8,
        },
      },
      lines: {
        type: "object",
        properties: Object.fromEntries(PARTS.map((p) => [p, line])),
        additionalProperties: false,
      },
      hooks: {
        type: "object",
        additionalProperties: {
          type: "array",
          items: { type: "array", items: note },
        },
      },
      sections: { type: "array", items: section, minItems: 4 },
    },
    required: [
      "title",
      "bpm",
      "key",
      "palette",
      "progressions",
      "lines",
      "sections",
    ],
    additionalProperties: false,
  };
}
