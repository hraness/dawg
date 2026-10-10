/**
 * Chord mode for play mode: the Orchid's left hand on the number row.
 *
 *   auto    every note key plays the chord that fits the song key (Orchid
 *           Key mode: in C major, D plays Dm). The default on chord-capable
 *           tracks.
 *   manual  note keys play single notes, as before; latch a chord type or an
 *           extension and they play that chord on the pressed root (Orchid
 *           without Key mode).
 *   off     plain play mode; the chord keys below are free again.
 *
 * Terminals send key-down only, so the Orchid's held buttons become latches:
 *
 *   1 2 3 4   dim min maj sus       toggle a chord type (two make a combined
 *   5 6 7 8   6 m7 M7 9             chord); toggle extensions (any number)
 *   0         clear the latches     - / =   voicing dial down / up
 *   9         next perform mode     b       next bass mode (off, chords,
 *                                             unison, single, solo)
 *   n         play the suggested next chord (dawg's progression engine;
 *             the session routes it through the root's note key)
 *   q         auto ⇄ manual
 *
 * Pure: the session asks for a chord per note key and owns sound and time.
 */
import { resolveTuning, snapToTuning } from "../../core/tuning.ts";
import {
  BASS_MODES,
  CHORD_PATTERNS,
  DEFAULT_ARP_RATE,
  DEFAULT_STRUM,
  generateProgression,
  presetChords,
  renderProgression,
  CHORD_TYPES,
  EXTENSIONS,
  MAX_VOICING_STEP,
  PERFORM_MODES,
  DEFAULT_STROKE_SPEED,
  STROKE_PATTERN_NAMES,
  strokeGrid,
  type PerformOptions,
  PROGRESSION_PRESETS,
  PROGRESSION_STYLES,
  SPREADS,
  chordName,
  findChordPattern,
  makeChord,
  noteName,
  parseBassMode,
  routeBass,
  type BassMode,
  findPreset,
  keyModeChord,
  keyName,
  keyUsesFlats,
  manualChord,
  parseKey,
  romanOf,
  suggestNext,
  voiceChord,
  type Chord,
  type ChordType,
  type Extension,
  type Key,
  type PerformMode,
  type ProgressionStyle,
  type Spread,
} from "../../core/chords.ts";
import {
  isSamplerInstrument,
  type NoteInput,
  type Track,
  type TrackScore,
} from "../../core/score.ts";

export const CHORD_MODES = ["auto", "manual", "off"] as const;
export type ChordMode = (typeof CHORD_MODES)[number];

/** Arp rates: `grid` follows play mode's grid; the rest are beats. */
export const ARP_RATES = ["grid", "1/4", "1/8", "1/16", "1/32"] as const;
export type ArpRate = (typeof ARP_RATES)[number];
const RATE_BEATS: Readonly<Record<Exclude<ArpRate, "grid">, number>> = {
  "1/4": 1,
  "1/8": 0.5,
  "1/16": 0.25,
  "1/32": 0.125,
};

/** Hand-editable chord settings (`/chords …`, `/menu chords`). */
export type ChordSettings = {
  mode: ChordMode;
  /** True once the mode was chosen, so a track switch keeps it. */
  explicit: boolean;
  inversion: number;
  spread: Spread;
  /** Orchid bass behaviour (core/chords.ts BASS_MODES). */
  bass: BassMode;
  perform: PerformMode;
  /** CHORD_PATTERNS name for the `pattern` perform mode. */
  pattern: string;
  rate: ArpRate;
  octaves: number;
  sevenths: boolean;
  /** `none` or a PROGRESSION_PRESETS name; drives the "next" suggestion. */
  preset: string;
  style: ProgressionStyle;
  /** Guitar perform mode: a STROKE_PATTERNS name or a D U d u x - . grid. */
  strokes: string;
  /** Guitar perform mode: ms a full six-string down stroke takes. */
  speed: number;
};

export function defaultChordSettings(): ChordSettings {
  return {
    mode: "manual",
    explicit: false,
    inversion: 0,
    spread: "close",
    bass: "off",
    perform: "block",
    pattern: CHORD_PATTERNS[0]!.name,
    rate: "grid",
    octaves: 1,
    sevenths: false,
    preset: "none",
    style: "pop",
    strokes: "down",
    speed: DEFAULT_STROKE_SPEED * 1000,
  };
}

/** Play mode's `[` / `]` strum speed step in ms. */
export const STROKE_SPEED_STEP = 5;

/** Strum speed bounds in ms (0 = every string at once). */
export const STROKE_SPEED_MS = Object.freeze({ min: 0, max: 200 });

/**
 * A strum speed from `/chords speed` text: milliseconds (`22`, `22ms`) or
 * beats (`1/32b`, `0.05b`) at `bpm`. Undefined when not a speed.
 */
export function parseStrokeSpeed(
  text: string | undefined,
  bpm: number,
): number | undefined {
  const raw = (text ?? "").trim().toLowerCase();
  const beats = /^(\d+(?:\.\d+)?)(?:\/(\d+))?\s*(?:b|beats?)$/.exec(raw);
  let ms: number;
  if (beats) {
    const value = Number(beats[1]) / (beats[2] ? Number(beats[2]) : 1);
    ms = (value * 60_000) / bpm;
  } else {
    const plain = /^(\d+(?:\.\d+)?)\s*(?:ms)?$/.exec(raw);
    if (!plain) return undefined;
    ms = Number(plain[1]);
  }
  if (
    !Number.isFinite(ms) ||
    ms < STROKE_SPEED_MS.min ||
    ms > STROKE_SPEED_MS.max
  )
    return undefined;
  return Math.round(ms * 10) / 10;
}

/**
 * Tracks where auto chords are the default: anything pitched that is not a
 * bass, a drum kit or a one-shot sampler.
 */
export function chordCapable(track: Track | undefined): boolean {
  if (!track) return false;
  if (isSamplerInstrument(track.instrument))
    return track.sampler?.mode === "keyed";
  const names = `${track.instrument} ${track.name} ${track.id}`.toLowerCase();
  return !/bass|kit|drum|perc|808|kick|snare|hat/.test(names);
}

/** The song key, or C major when the score has none. */
export function songKey(text: string | null | undefined): {
  key: Key;
  set: boolean;
} {
  const key = parseKey(text ?? undefined);
  return key
    ? { key, set: true }
    : { key: { tonic: 0, mode: "major" }, set: false };
}

const TYPE_KEYS: Readonly<Record<string, ChordType>> = {
  "1": "dim",
  "2": "min",
  "3": "maj",
  "4": "sus",
};
const EXTENSION_KEYS: Readonly<Record<string, Extension>> = {
  "5": "6",
  "6": "m7",
  "7": "M7",
  "8": "9",
};

/** Keys chord mode claims (all unused by the note layout). */
export const CHORD_KEYS: readonly string[] = Object.freeze([
  ..."1234567890",
  "-",
  "=",
  "b",
  "n",
  "q",
]);

export type PadResult =
  /** A setting changed; show `status`. */
  { type: "status"; status: string } | { type: "pass" };

/** A chord as play mode sounds it. */
export type PlayedChord = Readonly<{
  chord: Chord;
  name: string;
  /** Voiced treble pitches, low to high. */
  pitches: readonly number[];
  bass: number | undefined;
}>;

export class ChordPad {
  public readonly types = new Set<ChordType>();
  public readonly extensions = new Set<Extension>();
  public last: PlayedChord | undefined;
  /** Forced chord for the next note (from `n`). */
  private forced: Chord | undefined;

  public constructor(
    public settings: ChordSettings,
    private readonly keyText: () => string | null | undefined,
  ) {}

  public get key(): Key {
    return songKey(this.keyText()).key;
  }

  public get on(): boolean {
    return this.settings.mode !== "off";
  }

  /** Handle a chord key; `pass` for anything else. */
  public press(value: string): PadResult {
    const s = this.settings;
    if (value === "q" && s.mode !== "off") {
      s.mode = s.mode === "auto" ? "manual" : "auto";
      s.explicit = true;
      return { type: "status", status: `chords ${s.mode}` };
    }
    if (!this.on) return { type: "pass" };
    const type = TYPE_KEYS[value];
    if (type) {
      if (this.types.has(type)) this.types.delete(type);
      else this.types.add(type);
      return { type: "status", status: `chord ${this.latchText() || "clear"}` };
    }
    const extension = EXTENSION_KEYS[value];
    if (extension) {
      if (this.extensions.has(extension)) this.extensions.delete(extension);
      else this.extensions.add(extension);
      return { type: "status", status: `chord ${this.latchText() || "clear"}` };
    }
    if (value === "0") {
      this.types.clear();
      this.extensions.clear();
      return { type: "status", status: "chord latches clear" };
    }
    if (value === "-" || value === "=") {
      s.inversion = Math.max(
        -MAX_VOICING_STEP,
        Math.min(MAX_VOICING_STEP, s.inversion + (value === "=" ? 1 : -1)),
      );
      return { type: "status", status: `voicing ${signed(s.inversion)}` };
    }
    if (value === "9") {
      const index = PERFORM_MODES.indexOf(s.perform);
      s.perform = PERFORM_MODES[(index + 1) % PERFORM_MODES.length]!;
      return { type: "status", status: `perform ${s.perform}` };
    }
    if ((value === "[" || value === "]") && s.perform === "guitar") {
      // Strum speed: slower ([) or faster (]) in 5 ms steps.
      const wanted =
        s.speed + (value === "[" ? STROKE_SPEED_STEP : -STROKE_SPEED_STEP);
      s.speed = Math.max(
        STROKE_SPEED_MS.min,
        Math.min(STROKE_SPEED_MS.max, Math.round(wanted)),
      );
      return { type: "status", status: `strum speed ${s.speed}ms` };
    }
    if (value === "b") {
      const index = BASS_MODES.indexOf(s.bass);
      s.bass = BASS_MODES[(index + 1) % BASS_MODES.length]!;
      return { type: "status", status: `bass ${s.bass}` };
    }
    return { type: "pass" };
  }

  /** `min+m7`: the latched buttons. */
  public latchText(): string {
    return [
      ...CHORD_TYPES.filter((type) => this.types.has(type)),
      ...EXTENSIONS.filter((extension) => this.extensions.has(extension)),
    ].join("+");
  }

  /**
   * Strip label for a note key: the chord it plays in auto mode with no
   * latches (Orchid's display names the chord), else undefined.
   */
  public keyLabel(pitch: number): string | undefined {
    if (this.settings.mode !== "auto") return undefined;
    if (this.types.size > 0 || this.extensions.size > 0) return undefined;
    const chord = keyModeChord(this.key, pitch, {
      sevenths: this.settings.sevenths,
    });
    return chordName(chord, keyUsesFlats(this.key));
  }

  /** Make the next note key play `chord` (the `n` key). */
  public force(chord: Chord): void {
    this.forced = chord;
  }

  /** The chord a note key plays, or undefined for a single note. */
  public chordFor(pitch: number): Chord | undefined {
    const forced = this.forced;
    this.forced = undefined;
    if (forced) return forced;
    if (this.settings.mode === "auto")
      return keyModeChord(this.key, pitch, {
        types: this.types,
        extensions: this.extensions,
        sevenths: this.settings.sevenths,
      });
    if (this.settings.mode === "manual")
      return manualChord(pitch, this.types, this.extensions);
    return undefined;
  }

  /**
   * Voice a chord near the pressed key: voice-led from the last chord when
   * there is one, otherwise root position from the pressed octave, rotated
   * by the dial. Becomes the new "last" chord.
   */
  public voice(chord: Chord, pitch: number): PlayedChord {
    const anchor = Math.max(24, Math.min(96, pitch - mod12(pitch)));
    const pitches = voiceChord(chord, {
      inversion: this.settings.inversion,
      spread: this.settings.spread,
      previous: this.last?.pitches,
      anchor,
      low: anchor - 12,
      high: anchor + 19,
    });
    // Bass two octaves under the pressed octave (C2–B2 from C4).
    const route = routeBass(this.settings.bass, chord, pitch, anchor - 24);
    const voiced: PlayedChord = {
      chord,
      name: chordName(chord, keyUsesFlats(this.key)),
      pitches,
      bass: route.bass,
    };
    // Solo mutes the treble but keeps voice leading on the full voicing.
    this.last = voiced;
    return route.treble ? voiced : { ...voiced, pitches: [] };
  }

  /**
   * A single note (manual mode, no latch) routed through the bass mode:
   * undefined when it plays as a plain note (bass off or chords-only),
   * else the treble note (unison) or none (single, solo) plus its bass.
   */
  public single(pitch: number): PlayedChord | undefined {
    if (this.settings.mode === "off") return undefined;
    const anchor = Math.max(24, Math.min(96, pitch - mod12(pitch)));
    const route = routeBass(this.settings.bass, undefined, pitch, anchor - 24);
    if (route.bass === undefined) return undefined;
    return {
      chord: makeChord(mod12(pitch), "maj"),
      name: noteName(mod12(pitch), keyUsesFlats(this.key)),
      pitches: route.treble ? [pitch] : [],
      bass: route.bass,
    };
  }

  /** The chord the progression engine suggests after the last one. */
  public next(): Chord {
    const preset = this.settings.preset;
    return suggestNext(this.key, this.last?.chord, {
      ...(preset !== "none" && findPreset(preset) ? { preset } : {}),
      style: this.settings.style,
      sevenths: this.settings.sevenths,
    });
  }

  /** Arp step in beats for `gridBeats`. */
  public rateBeats(gridBeats: number): number {
    const rate = this.settings.rate;
    return rate === "grid" ? gridBeats : RATE_BEATS[rate];
  }

  /** The header at a glance: mode, key, last chord, next, latches. */
  public glance(keySet: boolean): string {
    const s = this.settings;
    if (s.mode === "off") return "";
    const key = this.key;
    const flats = keyUsesFlats(key);
    const parts = [
      `${s.mode.toUpperCase()} ${keyName(key)}${keySet ? "" : " (assumed)"}`,
    ];
    if (this.last)
      parts.push(`${this.last.name} (${romanOf(key, this.last.chord)})`);
    parts.push(`next ${chordName(this.next(), flats)}`);
    return parts.join(" · ");
  }

  /** The number-row legend, in key order, with latches marked. */
  public legend(): {
    key: string;
    label: string;
    on: boolean;
  }[] {
    const s = this.settings;
    const types = Object.entries(TYPE_KEYS).map(([key, type]) => ({
      key,
      label: type,
      on: this.types.has(type),
    }));
    const extensions = Object.entries(EXTENSION_KEYS).map(
      ([key, extension]) => ({
        key,
        label: extension,
        on: this.extensions.has(extension),
      }),
    );
    const perform =
      s.perform === "pattern"
        ? `pattern ${patternLabel(s.pattern)}`
        : s.perform;
    return [
      ...types,
      ...extensions,
      { key: "0", label: "clear", on: false },
      { key: "-=", label: `voicing ${signed(s.inversion)}`, on: false },
      { key: "9", label: perform, on: false },
      ...(s.perform === "guitar"
        ? [{ key: "[]", label: `speed ${s.speed}ms`, on: false }]
        : []),
      { key: "b", label: `bass ${s.bass}`, on: false },
      { key: "n", label: "next", on: false },
      { key: "q", label: s.mode === "auto" ? "auto" : "manual", on: false },
    ];
  }

  /**
   * The full chord state for the `?` panel, in the header's words:
   * `AUTO C major · Dm (ii) · next G · min+m7 · voicing +1 · arp-up · bass chords`.
   */
  public headerText(keySet: boolean): string {
    const s = this.settings;
    if (s.mode === "off") return "";
    const parts = [this.glance(keySet)];
    const latches = this.latchText();
    if (latches) parts.push(latches);
    if (s.inversion !== 0) parts.push(`voicing ${signed(s.inversion)}`);
    if (s.spread !== "close") parts.push(s.spread);
    if (s.perform === "pattern")
      parts.push(`pattern ${patternLabel(s.pattern)}`);
    else if (s.perform === "guitar")
      parts.push(`guitar ${s.strokes} ${s.speed}ms`);
    else if (s.perform !== "block") parts.push(s.perform);
    if (s.bass !== "off") parts.push(`bass ${s.bass}`);
    return parts.join(" · ");
  }
}

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

/** `3 offbeat`: a pattern's 1-based number and name. */
export function patternLabel(name: string): string {
  const pattern = findChordPattern(name) ?? CHORD_PATTERNS[0]!;
  return `${CHORD_PATTERNS.indexOf(pattern) + 1} ${pattern.name}`;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/**
 * `/chords …`: `auto|manual|off`, `voicing <-12..12>`, `spread <close|open|
 * wide>`, `bass off|chords|unison|single|solo` (`on` = chords), `perform
 * <mode>`, `pattern <1..13|name>`, `strokes <name|D-DU-UDU>` (guitar
 * mode), `speed <ms|1/32b>`, `rate <grid|1/8…>`, `octaves
 * <1..4>`, `sevenths on|off`, `preset <name|none>`, `style <pop|jazz|…>`.
 * Mutates `settings`; returns the receipt or an error.
 */
export function applyChordsCommand(
  settings: ChordSettings,
  argument: string,
  bpm = 120,
): { ok: boolean; message: string } {
  const raw = argument.trim().split(/\s+/).filter(Boolean);
  const words = raw.map((word) => word.toLowerCase());
  const [head, value] = words;
  const done = (message: string) => ({ ok: true, message });
  const bad = (message: string) => ({ ok: false, message });
  if (words.length === 0) return done(chordsSummary(settings));
  if ((CHORD_MODES as readonly string[]).includes(head!) && !value) {
    settings.mode = head as ChordMode;
    settings.explicit = true;
    return done(`chords ${settings.mode}`);
  }
  const onOff = (text: string | undefined) =>
    text === "on" || text === "true"
      ? true
      : text === "off" || text === "false"
        ? false
        : undefined;
  switch (head) {
    case "voicing":
    case "inversion": {
      const n = Number(value);
      if (!Number.isInteger(n) || Math.abs(n) > MAX_VOICING_STEP)
        return bad(`voicing takes -${MAX_VOICING_STEP}..${MAX_VOICING_STEP}`);
      settings.inversion = n;
      return done(`chords voicing ${signed(n)}`);
    }
    case "spread":
      if (!(SPREADS as readonly string[]).includes(value ?? ""))
        return bad(`spread takes ${SPREADS.join("|")}`);
      settings.spread = value as Spread;
      return done(`chords spread ${value}`);
    case "bass": {
      const mode = parseBassMode(value);
      if (!mode) return bad(`bass takes ${BASS_MODES.join("|")}`);
      settings.bass = mode;
      return done(`chords bass ${mode}`);
    }
    case "pattern": {
      const pattern = findChordPattern(value);
      if (!pattern)
        return bad(
          `pattern takes 1..${CHORD_PATTERNS.length} or ${CHORD_PATTERNS.map((p) => p.name).join("|")}`,
        );
      settings.pattern = pattern.name;
      settings.perform = "pattern";
      return done(`chords pattern ${patternLabel(pattern.name)}`);
    }
    case "sevenths": {
      const on = onOff(value);
      if (on === undefined) return bad(`${head} takes on|off`);
      settings[head] = on;
      return done(`chords ${head} ${on ? "on" : "off"}`);
    }
    case "perform":
      if (!(PERFORM_MODES as readonly string[]).includes(value ?? ""))
        return bad(`perform takes ${PERFORM_MODES.join("|")}`);
      settings.perform = value as PerformMode;
      return done(`chords perform ${value}`);
    case "rate":
      if (!(ARP_RATES as readonly string[]).includes(value ?? ""))
        return bad(`rate takes ${ARP_RATES.join("|")}`);
      settings.rate = value as ArpRate;
      return done(`chords rate ${value}`);
    case "strokes": {
      // Case matters: D is a full down stroke, d a light one.
      const grid = raw.slice(1).join("");
      if (!strokeGrid(grid))
        return bad(
          `strokes takes ${STROKE_PATTERN_NAMES.join("|")} or a grid of D U d u x - .`,
        );
      settings.strokes = (STROKE_PATTERN_NAMES as readonly string[]).includes(
        grid.toLowerCase(),
      )
        ? grid.toLowerCase()
        : grid;
      settings.perform = "guitar";
      return done(`chords strokes ${settings.strokes}`);
    }
    case "speed": {
      const ms = parseStrokeSpeed(words.slice(1).join(""), bpm);
      if (ms === undefined)
        return bad("speed takes 0..200 ms (22, 22ms) or beats (1/32b)");
      settings.speed = ms;
      return done(`chords speed ${ms}ms`);
    }
    case "octaves": {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 4)
        return bad("octaves takes 1..4");
      settings.octaves = n;
      return done(`chords octaves ${n}`);
    }
    case "preset":
      if (value !== "none" && !findPreset(value ?? ""))
        return bad(
          `preset takes none|${PROGRESSION_PRESETS.map((p) => p.name).join("|")}`,
        );
      settings.preset = value!;
      return done(`chords preset ${value}`);
    case "style":
      if (!(PROGRESSION_STYLES as readonly string[]).includes(value ?? ""))
        return bad(
          `idiom takes ${PROGRESSION_STYLES.join("|")} · chords idiom jazz`,
        );
      settings.style = value as ProgressionStyle;
      return done(`chords idiom ${value}`);
    default:
      return bad(
        "/chords auto|manual|off · voicing · spread · bass · perform · pattern · strokes · speed · rate · octaves · sevenths · preset · style",
      );
  }
}

export function chordsSummary(settings: ChordSettings): string {
  const s = settings;
  return [
    `chords ${s.mode}`,
    `voicing ${signed(s.inversion)}`,
    s.spread,
    s.perform,
    `pattern ${patternLabel(s.pattern)}`,
    `strokes ${s.strokes}`,
    `speed ${s.speed}ms`,
    `rate ${s.rate}`,
    `octaves ${s.octaves}`,
    `bass ${s.bass}`,
    `sevenths ${s.sevenths ? "on" : "off"}`,
    `preset ${s.preset}`,
    `style ${s.style}`,
  ].join(" · ");
}

/** Chords in the chord settings screen's audition phrase. */
const PHRASE_CHORDS = 4;

/**
 * What the chord settings sound like, for the audition loop: the chosen
 * progression (the preset, or four chords of the style's seeded walk) in the
 * song key, voiced and performed with `settings` (voicing, spread, sevenths,
 * perform mode, pattern, arp rate and octaves, bass mode), one chord per bar
 * or two per bar in a one-bar loop. With chords `off` it plays each chord's
 * root alone, as play mode would. Deterministic: the same settings and key
 * always give the same notes.
 */
export function chordPhrase(
  settings: ChordSettings,
  score: TrackScore,
  track: Track,
  bars: number,
): NoteInput[] {
  const key = parseKey(score.key) ?? { tonic: 0, mode: "major" as const };
  const preset =
    settings.preset === "none" ? undefined : findPreset(settings.preset);
  const progression = preset
    ? presetChords(key, preset)
    : generateProgression({
        key,
        length: PHRASE_CHORDS,
        style: settings.style,
        seed: 1,
        sevenths: settings.sevenths,
      });
  const tpb = score.ticksPerBeat;
  const totalBeats = Math.max(1, bars) * score.beatsPerBar;
  const count = Math.max(2, Math.max(1, bars));
  const span = totalBeats / count;
  const chords = Array.from(
    { length: count },
    (_, index) => progression[index % progression.length]!,
  );
  const mode = settings.perform;
  const rendered = renderProgression({
    key,
    chords,
    beatsPerChord: span,
    inversion: settings.inversion,
    spread: settings.spread,
    bassMode: settings.mode === "off" ? "solo" : settings.bass,
    perform: {
      mode,
      rate:
        settings.rate === "grid" ? DEFAULT_ARP_RATE : RATE_BEATS[settings.rate],
      octaves: settings.octaves,
      strum: mode === "harp" ? DEFAULT_STRUM * 2 : DEFAULT_STRUM,
      seed: 1,
      velocity: 0.8,
      ...(mode === "pattern" ? { pattern: settings.pattern } : {}),
      ...(mode === "guitar" ? guitarPerform(settings, score, track) : {}),
    },
  });
  // With chords off a key plays one note: the root, in the chord's octave.
  const performed =
    settings.mode === "off"
      ? rendered.bass.map((note) => ({ ...note, pitch: note.pitch + 24 }))
      : [...rendered.notes, ...rendered.bass];
  const end = totalBeats * tpb;
  const table = resolveTuning(score.tuning, track.tuning, score.key);
  const notes: NoteInput[] = [];
  for (const note of performed) {
    const startTick = Math.round(note.start * tpb);
    if (startTick >= end) continue;
    notes.push({
      id: `chords-${notes.length + 1}`,
      trackId: track.id,
      startTick,
      durationTicks: Math.max(
        1,
        Math.min(Math.round(note.length * tpb), end - startTick),
      ),
      pitch: snapToTuning(note.pitch, table),
      velocity: note.velocity,
    });
  }
  return notes;
}

/** Perform options for the guitar mode: strokes, speed, tempo and fretting. */
export function guitarPerform(
  settings: Pick<ChordSettings, "strokes" | "speed">,
  score: Pick<TrackScore, "tempoBpm">,
  track: Pick<Track, "guitar"> | undefined,
): Partial<PerformOptions> {
  return {
    strokes: settings.strokes,
    speed: settings.speed / 1000,
    tempo: score.tempoBpm,
    ...(track?.guitar ? { guitar: track.guitar } : {}),
  };
}
