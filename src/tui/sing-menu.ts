/**
 * Ctrl-k menu rows for the sing engine (0.7): the Choir, Solo and Throat
 * groups under Voice › voice presets, the SING_PARAMS rows under
 * Sound › Parameters on a sing track (with a Throat sub-menu) and the
 * Vowels row under Sound › Performance. Every row runs a `sing …` or
 * `note vowel …` command, so it stages for the audition loop's A/B.
 */
import type { EnumParam, NumberParam } from "../../core/params.ts";
import type { Note, Track } from "../../core/score.ts";
import {
  DEFAULT_SING_PRESET,
  resolveSing,
  SING_GROUPS,
  SING_PARAMS,
  SING_PRESETS,
  SING_PRESET_NAMES,
  SING_THROAT_PARAMS,
  SING_VOWELS,
  singNoteName,
  singDroneFollows,
  singTrack,
  type SingPreset,
} from "../../core/sing.ts";
import { num, specStep, type MenuContext, type MenuNode } from "./menu.ts";

function presetRow(name: SingPreset): MenuNode {
  return {
    kind: "action",
    label: `${name.padEnd(9)} ${SING_PRESETS[name].doc}`,
    command: `sing ${name}`,
    help: SING_PRESETS[name].styles,
  };
}

/** Voice › voice presets: choir, solo and throat (sing lane). */
export function singBrowseRows(): MenuNode[] {
  return SING_GROUPS.map((group): MenuNode => ({
    kind: "menu",
    id: `voices:${group.label.toLowerCase()}`,
    label: group.label.toLowerCase(),
    detail: group.presets.slice(0, 4).join(", ") + " …",
    help:
      group.label === "Throat"
        ? "Tuvan throat singing: a held drone, notes steer the overtone"
        : `${group.label.toLowerCase()} on the built-in singing voice`,
    build: () => group.presets.map(presetRow),
  }));
}

/** Parameters shown first; the rest sit under "advanced". */
const SING_SIMPLE = Object.freeze([
  "vowel",
  "voice",
  "voices",
  "bright",
  "breath",
  "vibmod",
  "formant",
  "ring",
] as const);

function numberRow(
  name: string,
  spec: NumberParam,
  value: number,
  fallback: number,
): MenuNode {
  return {
    kind: "number",
    label: name,
    value,
    min: spec.min,
    max: spec.max,
    step: specStep(spec),
    format: (v) => (spec.unit ? `${num(v)} ${spec.unit}` : num(v)),
    command: (v) => `sing ${name} ${num(v)}`,
    reset: `sing ${name} off`,
    help: `${spec.doc} · preset ${num(fallback)} · x resets`,
  };
}

/** Every vowel and two-vowel morph, for the pickers. */
export function vowelOptions(): string[] {
  const out: string[] = [...SING_VOWELS];
  for (const from of SING_VOWELS)
    for (const to of SING_VOWELS) if (from !== to) out.push(`${from}>${to}`);
  return out;
}

/** Sound › Parameters rows on a sing track. */
export function singParameterNodes(track: Track, keyRoot?: number): MenuNode[] {
  if (!singTrack(track)) return [];
  const sing = track.sing!;
  const follows = singDroneFollows(sing, keyRoot);
  const resolved = resolveSing(sing, keyRoot) as unknown as Readonly<
    Record<string, unknown>
  >;
  const fallback = SING_PRESETS[sing.preset ?? DEFAULT_SING_PRESET]
    .settings as unknown as Readonly<Record<string, unknown>>;
  const own = sing as Readonly<Record<string, unknown>>;
  const row = (name: string): MenuNode | undefined => {
    if (name === "vowel")
      return {
        kind: "choice",
        label: "vowel",
        value: String(resolved.vowel),
        options: vowelOptions(),
        command: (option) => `sing vowel ${option}`,
        help: `${SING_PARAMS.vowel!.doc} · preset ${String(fallback.vowel)}`,
      };
    if (name === "drone") {
      const drone = resolved.drone as number | undefined;
      const spec = SING_PARAMS.drone as NumberParam;
      return {
        kind: "number",
        label: "drone",
        value: drone,
        min: spec.min,
        max: spec.max,
        step: (v, direction) =>
          Math.max(spec.min, Math.min(spec.max, Math.round(v) + direction)),
        // The drone you hear: the preset's moved to the song key.
        format: (v) =>
          follows && v === drone ? `${singNoteName(v)} (key)` : singNoteName(v),
        command: (v) => `sing drone ${singNoteName(v)}`,
        off: "off (melody)",
        start: 50,
        reset: "sing drone off",
        help: `${spec.doc} · x back to the preset`,
      };
    }
    if (name === "harmonics") {
      const [lo, hi] = resolved.harmonics as readonly [number, number];
      const options = ["4-8", "4-12", "5-10", "6-12", "6-16", "8-16", "8-24"];
      const value = `${lo}-${hi}`;
      return {
        kind: "choice",
        label: "harmonics",
        value,
        options: options.includes(value) ? options : [value, ...options],
        command: (option) => `sing harmonics ${option}`,
        help: "the overtone range a throat track's notes pick from (khoomei 6-12, sygyt 8-16)",
      };
    }
    const spec = SING_PARAMS[name]!;
    if (spec.kind === "enum")
      return {
        kind: "choice",
        label: name,
        value: own[name] === undefined ? "preset" : String(own[name]),
        options: ["preset", ...(spec as EnumParam).values],
        command: (option) =>
          option === "preset" ? `sing ${name} unset` : `sing ${name} ${option}`,
        help: `${spec.doc} · preset ${String(fallback[name])}`,
      };
    if (spec.kind !== "number") return undefined;
    return numberRow(
      name,
      spec,
      Number(resolved[name]),
      Number(fallback[name]),
    );
  };
  const nodes: MenuNode[] = [
    {
      kind: "choice",
      label: "preset",
      value: sing.preset ?? DEFAULT_SING_PRESET,
      options: SING_PRESET_NAMES,
      command: (option) => `sing preset ${option}`,
      help: "the voice: choir, solo or throat singing",
    },
  ];
  for (const name of SING_SIMPLE) {
    const node = row(name);
    if (node) nodes.push(node);
  }
  const throat = SING_THROAT_PARAMS as readonly string[];
  nodes.push({
    kind: "menu",
    id: "sing:throat",
    label: "throat",
    detail:
      resolved.drone === undefined
        ? "off · drone, overtone, harmonics, sub"
        : `drone ${singNoteName(resolved.drone as number)} · ${throat.slice(1).join(", ")}`,
    help: "throat singing: a drone, notes pick its overtones; sub for kargyraa",
    build: () => throat.flatMap((name) => row(name) ?? []),
  });
  const rest = Object.keys(SING_PARAMS).filter(
    (name) =>
      !(SING_SIMPLE as readonly string[]).includes(name) &&
      !throat.includes(name),
  );
  nodes.push({
    kind: "menu",
    id: "sing:advanced",
    label: "advanced",
    detail: rest.join(", "),
    help: "every sing parameter",
    build: () => rest.flatMap((name) => row(name) ?? []),
  });
  if (Object.keys(sing).some((key) => key !== "preset"))
    nodes.push({
      kind: "action",
      label: "reset to preset",
      command: "sing reset",
      help: "clear overrides, keep the preset",
    });
  return nodes;
}

function sharedVowel(notes: readonly Note[]): string {
  const values = new Set(notes.map((note) => note.vowel ?? "track"));
  if (values.size === 0) return "track";
  return values.size === 1 ? [...values][0]! : "mixed";
}

/**
 * Sound › Performance › Vowels on a sing track: left/right steps the notes'
 * vowel through a e i o u, enter opens the morph picker, and a pattern
 * row cycles vowels over the notes in order.
 */
export function singVowelNodes(context: MenuContext): MenuNode[] {
  const track = context.score.tracks.find(
    (item) => item.id === context.trackId,
  );
  if (!singTrack(track)) return [];
  const notes = context.score.notes.filter(
    (note) => note.trackId === track!.id,
  );
  const current = sharedVowel(notes);
  return [
    {
      kind: "menu",
      id: "sing:vowels",
      label: "vowels",
      detail: `${current} · ${notes.length} notes`,
      help: "the sung vowel of every note on the track (a note's vowel wins over the track's)",
      build: (inner) => {
        const now = inner.score.notes.filter(
          (note) => note.trackId === context.trackId,
        );
        return [
          {
            kind: "choice",
            label: "vowel",
            value: sharedVowel(now),
            options: ["track", ...SING_VOWELS],
            command: (option) =>
              `note vowel ${option === "track" ? "off" : option}`,
            help: "left/right steps a e i o u; track uses the track's vowel",
          },
          {
            kind: "choice",
            label: "morph",
            value: sharedVowel(now),
            options: [
              "track",
              ...vowelOptions().filter((v) => v.includes(">")),
            ],
            command: (option) =>
              `note vowel ${option === "track" ? "off" : option}`,
            help: "each note travels from the first vowel to the second",
          },
          {
            kind: "choice",
            label: "pattern",
            value: "",
            options: ["a e i o u", "a o", "o u", "a e i", "u o a"],
            command: (option) => `sing vowels ${option}`,
            help: "vowels over the notes in time order, cycled",
          },
        ];
      },
    },
  ];
}
