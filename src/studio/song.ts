import { readFile } from "node:fs/promises";
import {
  CHART_KINDS,
  LAYERS,
  chartScale,
  checkChart,
  degreeOf,
  readChords,
  type Chart,
} from "../../core/distill/hyperpop/chart/format.ts";
import { GRAMMARS, KITS } from "../../core/distill/hyperpop/genome/genome.ts";
import {
  ARP,
  BASS,
  LEAD,
  PAD,
  SINGERS,
  STAB,
} from "../../core/distill/hyperpop/genome/sounds.ts";
import { MODES } from "../../core/distill/hyperpop/genome/theory.ts";
import { performChart } from "../../core/distill/hyperpop/chart/perform.ts";
import { updateTrack, type TrackScore } from "../../core/score.ts";
import { resolveInput } from "../media/paths.ts";
import type { MediaHost } from "../media/types.ts";
import { HOUSE_PROFILE } from "../workflows/catalog.ts";
import {
  generateVocalBook,
  vocalBookForChart,
  type GenerateVocalBookOptions,
} from "../vocals/index.ts";

export const CHART_INPUT_LIMITS = Object.freeze({
  bytes: 256 * 1024,
  sections: 64,
  bars: 256,
  lines: 512,
  linesPerSection: 32,
  movesPerSection: 32,
});
export const CHART_VOCAL_TRACK = "vocals";
export const CHART_VOCAL_ID = "original-song";

function invalid(path: string, expected: string): never {
  throw new Error(`invalid chart: ${path} ${expected}`);
}
function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(path, "must be an object");
  return value as Record<string, unknown>;
}
function keys(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  if (Object.keys(raw).some((key) => !allowed.includes(key)))
    invalid(path, "contains unsupported fields");
}
function text(value: unknown, path: string, max = 160): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    invalid(path, "must be bounded plain text");
  return value;
}
function number(
  value: unknown,
  path: string,
  min: number,
  max: number,
  whole = false,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (whole && !Number.isInteger(value))
  )
    invalid(
      path,
      `must be ${whole ? "an integer" : "a finite number"} in ${min}..${max}`,
    );
  return value;
}
function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    invalid(path, `must be an array of at most ${max} entries`);
  return value;
}
function choice(
  value: unknown,
  allowed: readonly string[],
  path: string,
): string {
  if (typeof value !== "string" || !allowed.includes(value))
    invalid(path, "is not a supported value");
  return value;
}
function identifier(value: unknown, path: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(text(value, path, 64)))
    invalid(path, "must be a track identifier");
}

/** Structural validation precedes semantic helpers, performance, inference and writes. */
export function parseSongChart(
  value: unknown,
  options: Readonly<{ house?: boolean }> = {},
): Chart {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    invalid("input", "must be JSON data");
  }
  if (
    typeof serialized! !== "string" ||
    Buffer.byteLength(serialized!) > CHART_INPUT_LIMITS.bytes
  )
    invalid("input", "exceeds 256 KiB");
  const raw = record(JSON.parse(serialized!), "input");
  keys(
    raw,
    ["title", "key", "mode", "bpm", "sounds", "sections", "notes"],
    "input",
  );
  text(raw.title, "title");
  choice(
    raw.key,
    ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"],
    "key",
  );
  choice(raw.mode, Object.keys(MODES), "mode");
  number(raw.bpm, "bpm", 90, 200);
  const sounds = record(raw.sounds, "sounds");
  const palettes = {
    pad: PAD,
    stab: STAB,
    arp: ARP,
    arp2: ARP,
    lead: LEAD,
    counter: { ...LEAD, ...ARP },
    bass: BASS,
    singer: SINGERS,
  };
  keys(sounds, [...Object.keys(palettes), "kit", "design"], "sounds");
  for (const [name, palette] of Object.entries(palettes))
    choice(sounds[name], Object.keys(palette), `sounds.${name}`);
  const kit = record(sounds.kit, "sounds.kit");
  keys(kit, ["kick", "snare", "hats"], "sounds.kit");
  for (const lane of ["kick", "snare", "hats"])
    choice(kit[lane], KITS, `sounds.kit.${lane}`);
  const design = record(sounds.design, "sounds.design");
  const designKeys = ["brightness", "grit", "space", "width", "echo"];
  keys(design, designKeys, "sounds.design");
  for (const name of designKeys)
    number(design[name], `sounds.design.${name}`, 0, 1);
  const sections = array(raw.sections, "sections", CHART_INPUT_LIMITS.sections);
  if (!sections.length) invalid("sections", "needs at least one section");
  let bars = 0,
    totalLines = 0;
  sections.forEach((value, index) => {
    const path = `sections[${index}]`;
    const section = record(value, path);
    keys(
      section,
      [
        "kind",
        "name",
        "bars",
        "chords",
        "drums",
        "drums2",
        "energy",
        "play",
        "sing",
        "hook",
        "counter",
        "chops",
        "stabs",
        "arp",
        "bass",
        "kick",
        "snare",
        "hats",
        "moves",
      ],
      path,
    );
    choice(section.kind, CHART_KINDS, `${path}.kind`);
    text(section.name, `${path}.name`, 80);
    const length = number(section.bars, `${path}.bars`, 1, 8, true);
    bars += length;
    text(section.chords, `${path}.chords`);
    choice(
      section.drums,
      [...GRAMMARS, "half", "taps", "none"],
      `${path}.drums`,
    );
    if (section.drums2 !== undefined)
      choice(
        section.drums2,
        [...GRAMMARS, "half", "taps", "none"],
        `${path}.drums2`,
      );
    if (section.energy !== undefined)
      number(section.energy, `${path}.energy`, 0, 1);
    const play = array(section.play, `${path}.play`, LAYERS.length);
    play.forEach((layer) => choice(layer, LAYERS, `${path}.play`));
    if (new Set(play).size !== play.length)
      invalid(`${path}.play`, "contains duplicate layers");
    for (const lane of ["sing", "hook", "counter", "chops"])
      if (section[lane] !== undefined) {
        const lines = array(
          section[lane],
          `${path}.${lane}`,
          CHART_INPUT_LIMITS.linesPerSection,
        );
        totalLines += lines.length;
        lines.forEach((value, lineIndex) => {
          const at = `${path}.${lane}[${lineIndex}]`,
            line = record(value, at);
          keys(line, ["bar", "rhythm", "notes", "words"], at);
          number(line.bar, `${at}.bar`, 0, length);
          const rhythm = text(line.rhythm, `${at}.rhythm`, 80);
          if (
            !/^[x.\- ]+$/.test(rhythm) ||
            rhythm.replaceAll(" ", "").length > 64
          )
            invalid(
              `${at}.rhythm`,
              "must contain at most 64 sixteenth steps (x - .)",
            );
          text(line.notes, `${at}.notes`, 512);
          if (line.words !== undefined) text(line.words, `${at}.words`, 512);
        });
      }
    for (const lane of ["stabs", "kick", "snare", "hats"])
      if (section[lane] !== undefined)
        array(section[lane], `${path}.${lane}`, 8).forEach((grid) => {
          if (typeof grid !== "string" || !/^[0-9.\-]{16}$/.test(grid))
            invalid(`${path}.${lane}`, "must contain 16-step accent grids");
        });
    if (section.arp !== undefined)
      array(section.arp, `${path}.arp`, 8).forEach((grid) => {
        if (typeof grid !== "string" || !/^[0-4]{8}$/.test(grid))
          invalid(`${path}.arp`, "must contain eight digits 0..4");
      });
    if (section.bass !== undefined)
      choice(
        section.bass,
        ["lock", "hold", "offbeat", "rolling", "walk"],
        `${path}.bass`,
      );
    if (section.moves !== undefined)
      array(
        section.moves,
        `${path}.moves`,
        CHART_INPUT_LIMITS.movesPerSection,
      ).forEach((value, moveIndex) =>
        validateMove(value, `${path}.moves[${moveIndex}]`, length),
      );
  });
  if (bars > CHART_INPUT_LIMITS.bars)
    invalid("sections", "exceeds the 256-bar score limit");
  if (totalLines > CHART_INPUT_LIMITS.lines)
    invalid("lines", "exceeds the 512-line budget");
  if (raw.notes !== undefined)
    array(raw.notes, "notes", 32).forEach((note) => text(note, "notes", 500));
  // Everything above was checked from unknown; JSON copying captures a stable snapshot.
  const chart = raw as unknown as Chart;
  const errors = checkChart(chart);
  if (errors.length)
    throw new Error(`invalid chart: ${errors.slice(0, 6).join("; ")}`);
  if (options.house) assertHouseChart(chart);
  try {
    const scale = chartScale(chart);
    for (const section of chart.sections)
      for (const move of section.moves ?? [])
        if (move.move === "stutter")
          for (const token of move.notes.trim().split(/\s+/))
            degreeOf(scale, token);
    // Pure score compilation catches performer-only semantic failures before admission.
    performChart(chart);
  } catch (error) {
    invalid(
      "performance",
      error instanceof Error ? error.message : "cannot compile this chart",
    );
  }
  return chart;
}

function validateMove(value: unknown, path: string, bars: number): void {
  const move = record(value, path);
  const kind = choice(
    move.move,
    [
      "stutter",
      "dropout",
      "silence",
      "landing",
      "tapeStop",
      "riser",
      "drift",
      "crush",
      "formant",
      "dive",
    ],
    `${path}.move`,
  );
  const allowed: Record<string, readonly string[]> = {
    stutter: ["bar", "beat", "count", "step", "notes", "word"],
    dropout: ["bar", "beat", "beats", "keep"],
    tapeStop: ["beats"],
    drift: ["layer"],
    dive: ["track", "bar", "beat"],
  };
  keys(move, ["move", ...(allowed[kind] ?? [])], path);
  if (["stutter", "dropout", "dive"].includes(kind)) {
    number(move.bar, `${path}.bar`, 0, bars);
    number(move.beat, `${path}.beat`, 0, 4);
  }
  if (kind === "stutter") {
    number(move.count, `${path}.count`, 1, 64, true);
    number(move.step, `${path}.step`, 0.015625, 16);
    text(move.notes, `${path}.notes`, 512);
    text(move.word, `${path}.word`, 64);
  }
  if (kind === "dropout") {
    number(move.beats, `${path}.beats`, 0.015625, 32);
    if (move.keep !== undefined)
      array(move.keep, `${path}.keep`, 32).forEach((track) =>
        identifier(track, `${path}.keep`),
      );
  }
  if (kind === "tapeStop" && move.beats !== undefined)
    number(move.beats, `${path}.beats`, 0.015625, 32);
  if (kind === "drift") choice(move.layer, LAYERS, `${path}.layer`);
  if (kind === "dive") identifier(move.track, `${path}.track`);
}

export function assertHouseChart(chart: Chart): void {
  if (
    chart.mode !== HOUSE_PROFILE.harmony.mode ||
    chart.bpm < HOUSE_PROFILE.bpm.min ||
    chart.bpm > HOUSE_PROFILE.bpm.max
  )
    throw new Error(
      `original-house requires diatonic major at ${HOUSE_PROFILE.bpm.min}–${HOUSE_PROFILE.bpm.max} BPM; use an explicit legacy synth draft to replay another style`,
    );
  const scale = chartScale(chart);
  if (
    chart.sections.some((section) =>
      readChords(scale, section).some(
        (chord) =>
          chord.degree < 0 ||
          [...chord.triad, ...chord.color].some(
            (pitch) => !scale.pcs.includes(pitch),
          ),
      ),
    )
  )
    throw new Error(
      "original-house chords must stay diatonic; borrowed and chromatic chords are outside this profile",
    );
}

export async function readSongChart(
  file: string,
  host: MediaHost,
  options: Readonly<{ house?: boolean }> = {},
): Promise<Chart> {
  const input = await resolveInput(host, file);
  if (input.size > 256 * 1024) throw new Error("chart exceeds 256 KiB");
  const contents = await readFile(input.absolute, "utf8");
  if (Buffer.byteLength(contents) > CHART_INPUT_LIMITS.bytes)
    throw new Error("chart exceeds 256 KiB");
  return parseSongChart(JSON.parse(contents) as unknown, options);
}

export function instrumentalChart(chart: Chart): TrackScore {
  let score = performChart(parseSongChart(chart)).score;
  for (const track of score.tracks)
    if (track.instrument === "vocal" || track.vocoder)
      score = updateTrack(score, track.id, { muted: true });
  return score;
}

export async function singSongChart(
  chart: Chart,
  options: Omit<GenerateVocalBookOptions, "spec">,
) {
  return generateVocalBook({
    ...options,
    spec: vocalBookForChart(parseSongChart(chart, { house: true })),
  });
}
