/**
 * The small, JSON-safe score model shared by the Track daemon and clients.
 *
 * Score time is expressed in integer ticks. A loop uses `ticksPerBeat` ticks
 * per beat; keeping this unit explicit means a transport can change tempo
 * without rewriting the score.
 */

export const SCORE_VERSION = 1 as const;
export const DEFAULT_TICKS_PER_BEAT = 480 as const;

export const SCORE_LIMITS = Object.freeze({
  maxTracks: 64,
  maxNotes: 4096,
  maxIdLength: 64,
  maxNameLength: 96,
  maxInstrumentLength: 64,
  maxAutomationPoints: 256,
  maxVolume: 1,
  maxTempoBpm: 300,
  minTempoBpm: 20,
  maxBars: 256,
  maxBeatsPerBar: 16,
  maxTicksPerBeat: 4096,
  maxTick: 1_000_000,
  minFilterCutoff: 20,
  maxFilterCutoff: 20_000,
  maxFilterResonance: 1,
  minDelayBeats: 0.0625,
  maxDelayBeats: 4,
  maxDelayFeedback: 0.9,
  maxDelayMix: 1,
} as const);

export class ScoreValidationError extends Error {
  readonly code:
    | "invalid-score"
    | "invalid-note"
    | "invalid-track"
    | "duplicate-note"
    | "duplicate-track"
    | "score-limit";

  constructor(
    message: string,
    code: ScoreValidationError["code"] = "invalid-score",
  ) {
    super(message);
    this.name = "ScoreValidationError";
    this.code = code;
  }
}

export type Track = Readonly<{
  id: string;
  name: string;
  instrument: string;
  muted: boolean;
  volume: number;
  pan: number;
  /** Volume control points in score ticks, sorted by tick. */
  volumeAutomation: readonly AutomationPoint[];
  /** Pan control points in score ticks, sorted by tick. */
  panAutomation: readonly AutomationPoint[];
  /**
   * Optional fields below are omitted when at their default so documents
   * written before they existed encode byte-for-byte the same.
   */
  /** When any track is soloed, only soloed (unmuted) tracks are audible. */
  solo?: boolean;
  /** Low-pass filter applied to the track before its delay send. */
  filter?: TrackFilter;
  /** Tempo-synced feedback delay send, mixed after the filter. */
  delay?: TrackDelay;
  /** Filter cutoff (Hz) control points in score ticks, sorted by tick. */
  filterAutomation?: readonly AutomationPoint[];
}>;

export type TrackFilter = Readonly<{
  /** Cutoff frequency in Hz, 20..20000. */
  cutoff: number;
  /** Resonance 0..1, mapped to a bounded biquad Q. */
  resonance: number;
}>;

export type TrackDelay = Readonly<{
  /** Delay time in beats, 0.0625..4, so echoes follow the tempo. */
  beats: number;
  /** Fraction of each echo fed back, 0..0.9. */
  feedback: number;
  /** Wet level added to the dry signal, 0..1. */
  mix: number;
}>;

export type AutomationParameter = "volume" | "pan" | "filter";

/** Track fields that score operations may patch; `null` clears an effect. */
export type TrackPatch = Readonly<
  Partial<
    Pick<
      Track,
      | "name"
      | "instrument"
      | "muted"
      | "volume"
      | "pan"
      | "volumeAutomation"
      | "panAutomation"
      | "solo"
      | "filterAutomation"
    >
  > & {
    filter?: TrackFilter | null;
    delay?: TrackDelay | null;
  }
>;

export type AutomationPoint = Readonly<{
  tick: number;
  value: number;
}>;

/** A note's start and duration are integer ticks, never floating-point beats. */
export type Note = Readonly<{
  id: string;
  trackId: string;
  startTick: number;
  durationTicks: number;
  pitch: number;
  velocity: number;
}>;

export type TrackInput = Readonly<
  Omit<Partial<Track>, "filter" | "delay"> &
    Pick<Track, "id"> & {
      filter?: TrackFilter | null;
      delay?: TrackDelay | null;
    }
>;

/**
 * Input accepts `start`/`duration` as a convenience for callers that use the
 * short names. Encoded and stored notes always use the explicit tick names.
 */
export type NoteInput = Readonly<{
  id: string;
  trackId: string;
  startTick?: number;
  durationTicks?: number;
  start?: number;
  duration?: number;
  pitch: number;
  velocity: number;
}>;

export type TrackScoreData = Readonly<{
  tempoBpm?: number;
  beatsPerBar?: number;
  bars?: number;
  ticksPerBeat?: number;
  key?: string | null;
  tracks?: readonly TrackInput[];
  notes?: readonly NoteInput[];
}>;

/** Canonical immutable score. Use `addNote`/`removeNote` to create a revision. */
export class TrackScore {
  readonly version = SCORE_VERSION;
  readonly tempoBpm: number;
  readonly beatsPerBar: number;
  readonly bars: number;
  readonly ticksPerBeat: number;
  readonly key: string | null;
  readonly tracks: readonly Track[];
  readonly notes: readonly Note[];

  constructor(data: TrackScoreData = {}) {
    const tempoBpm = data.tempoBpm ?? 120;
    const beatsPerBar = data.beatsPerBar ?? 4;
    const bars = data.bars ?? 4;
    const ticksPerBeat = data.ticksPerBeat ?? DEFAULT_TICKS_PER_BEAT;
    const key = data.key ?? null;
    if (
      !Number.isFinite(tempoBpm) ||
      tempoBpm < SCORE_LIMITS.minTempoBpm ||
      tempoBpm > SCORE_LIMITS.maxTempoBpm
    ) {
      throw new ScoreValidationError(
        `tempoBpm must be between ${SCORE_LIMITS.minTempoBpm} and ${SCORE_LIMITS.maxTempoBpm}`,
        "invalid-score",
      );
    }
    if (
      !Number.isInteger(beatsPerBar) ||
      beatsPerBar < 1 ||
      beatsPerBar > SCORE_LIMITS.maxBeatsPerBar
    ) {
      throw new ScoreValidationError(
        `beatsPerBar must be an integer between 1 and ${SCORE_LIMITS.maxBeatsPerBar}`,
        "invalid-score",
      );
    }
    if (!Number.isInteger(bars) || bars < 1 || bars > SCORE_LIMITS.maxBars) {
      throw new ScoreValidationError(
        `bars must be an integer between 1 and ${SCORE_LIMITS.maxBars}`,
        "invalid-score",
      );
    }
    if (
      !Number.isInteger(ticksPerBeat) ||
      ticksPerBeat < 1 ||
      ticksPerBeat > SCORE_LIMITS.maxTicksPerBeat
    ) {
      throw new ScoreValidationError(
        `ticksPerBeat must be an integer between 1 and ${SCORE_LIMITS.maxTicksPerBeat}`,
        "invalid-score",
      );
    }
    if (
      key !== null &&
      (typeof key !== "string" || key.length > SCORE_LIMITS.maxNameLength)
    ) {
      throw new ScoreValidationError(
        "key must be null or a short string",
        "invalid-score",
      );
    }
    const tracks = normalizeTracks(data.tracks ?? []);
    const notes = normalizeNotes(data.notes ?? []);
    this.tempoBpm = tempoBpm;
    this.beatsPerBar = beatsPerBar;
    this.bars = bars;
    this.ticksPerBeat = ticksPerBeat;
    this.key = key;
    this.tracks = freezeArray(tracks);
    this.notes = freezeArray(notes);
    Object.freeze(this);
  }

  addNote(note: NoteInput): TrackScore {
    return addNote(this, note);
  }

  removeNote(noteId: string): TrackScore {
    return removeNote(this, noteId);
  }

  withTracks(tracks: readonly TrackInput[]): TrackScore {
    return new TrackScore({
      tempoBpm: this.tempoBpm,
      beatsPerBar: this.beatsPerBar,
      bars: this.bars,
      ticksPerBeat: this.ticksPerBeat,
      key: this.key,
      tracks,
      notes: this.notes,
    });
  }

  withTempo(tempoBpm: number): TrackScore {
    return new TrackScore({
      tempoBpm,
      beatsPerBar: this.beatsPerBar,
      bars: this.bars,
      ticksPerBeat: this.ticksPerBeat,
      key: this.key,
      tracks: this.tracks,
      notes: this.notes,
    });
  }

  /** Resize the loop without discarding notes or automation outside its bounds. */
  withBars(bars: number): TrackScore {
    return new TrackScore({ ...this.toJSON(), bars });
  }

  toJSON(): TrackScoreData & { version: typeof SCORE_VERSION } {
    return {
      version: SCORE_VERSION,
      tempoBpm: this.tempoBpm,
      beatsPerBar: this.beatsPerBar,
      bars: this.bars,
      ticksPerBeat: this.ticksPerBeat,
      key: this.key,
      tracks: this.tracks,
      notes: this.notes,
    };
  }
}

export function createScore(data: TrackScoreData = {}): TrackScore {
  return new TrackScore(data);
}

export function emptyScore(): TrackScore {
  return new TrackScore();
}

export function addTrack(score: TrackScore, input: TrackInput): TrackScore {
  if (!(score instanceof TrackScore))
    throw new ScoreValidationError("addTrack requires a TrackScore");
  return score.withTracks([...score.tracks, input]);
}

export function addNote(score: TrackScore, input: NoteInput): TrackScore {
  if (!(score instanceof TrackScore))
    throw new ScoreValidationError("addNote requires a TrackScore");
  const note = normalizeNote(input);
  if (score.notes.some((candidate) => candidate.id === note.id)) {
    throw new ScoreValidationError(
      `note id already exists: ${note.id}`,
      "duplicate-note",
    );
  }
  if (score.notes.length >= SCORE_LIMITS.maxNotes) {
    throw new ScoreValidationError(
      `score cannot contain more than ${SCORE_LIMITS.maxNotes} notes`,
      "score-limit",
    );
  }
  return new TrackScore({
    tempoBpm: score.tempoBpm,
    beatsPerBar: score.beatsPerBar,
    bars: score.bars,
    ticksPerBeat: score.ticksPerBeat,
    key: score.key,
    tracks: score.tracks,
    notes: [...score.notes, note],
  });
}

export function removeNote(score: TrackScore, noteId: string): TrackScore {
  if (!(score instanceof TrackScore))
    throw new ScoreValidationError("removeNote requires a TrackScore");
  if (
    typeof noteId !== "string" ||
    noteId.length === 0 ||
    noteId.length > SCORE_LIMITS.maxIdLength
  ) {
    throw new ScoreValidationError(
      "noteId must be a non-empty short string",
      "invalid-note",
    );
  }
  if (!score.notes.some((note) => note.id === noteId)) return score;
  return new TrackScore({
    tempoBpm: score.tempoBpm,
    beatsPerBar: score.beatsPerBar,
    bars: score.bars,
    ticksPerBeat: score.ticksPerBeat,
    key: score.key,
    tracks: score.tracks,
    notes: score.notes.filter((note) => note.id !== noteId),
  });
}

export function updateNote(
  score: TrackScore,
  noteId: string,
  patch: Readonly<
    Partial<Pick<Note, "startTick" | "durationTicks" | "pitch" | "velocity">>
  >,
): TrackScore {
  const current = score.notes.find((note) => note.id === noteId);
  if (!current) return score;
  return new TrackScore({
    tempoBpm: score.tempoBpm,
    beatsPerBar: score.beatsPerBar,
    bars: score.bars,
    ticksPerBeat: score.ticksPerBeat,
    key: score.key,
    tracks: score.tracks,
    notes: score.notes.map((note) =>
      note.id === noteId ? { ...note, ...patch } : note,
    ),
  });
}

export function clearTrack(score: TrackScore, trackId: string): TrackScore {
  if (!score.notes.some((note) => note.trackId === trackId)) return score;
  return new TrackScore({
    tempoBpm: score.tempoBpm,
    beatsPerBar: score.beatsPerBar,
    bars: score.bars,
    ticksPerBeat: score.ticksPerBeat,
    key: score.key,
    tracks: score.tracks,
    notes: score.notes.filter((note) => note.trackId !== trackId),
  });
}

export function updateTrack(
  score: TrackScore,
  trackId: string,
  patch: TrackPatch,
): TrackScore {
  if (!score.tracks.some((track) => track.id === trackId)) return score;
  return score.withTracks(
    score.tracks.map((track) =>
      track.id === trackId ? { ...track, ...patch } : track,
    ),
  );
}

export function setVolumeAutomation(
  score: TrackScore,
  trackId: string,
  points: readonly AutomationPoint[],
): TrackScore {
  return updateTrack(score, trackId, { volumeAutomation: points });
}

export function setPanAutomation(
  score: TrackScore,
  trackId: string,
  points: readonly AutomationPoint[],
): TrackScore {
  return updateTrack(score, trackId, { panAutomation: points });
}

export function setFilterAutomation(
  score: TrackScore,
  trackId: string,
  points: readonly AutomationPoint[],
): TrackScore {
  return updateTrack(score, trackId, { filterAutomation: points });
}

/** Mute always silences a track; any solo silences every unsoloed track. */
export function isTrackAudible(score: TrackScore, trackId: string): boolean {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (track?.muted) return false;
  const soloing = score.tracks.some((candidate) => candidate.solo === true);
  return !soloing || track?.solo === true;
}

export type ScoreOperation =
  | Readonly<{
      type: "addTrack";
      track: TrackInput;
    }>
  | Readonly<{
      type: "addNote";
      note: NoteInput;
    }>
  | Readonly<{
      type: "removeNote";
      noteId: string;
    }>
  | Readonly<{
      type: "updateNote";
      noteId: string;
      patch: Readonly<
        Partial<
          Pick<Note, "startTick" | "durationTicks" | "pitch" | "velocity">
        >
      >;
    }>
  | Readonly<{
      type: "setTempo";
      tempoBpm: number;
    }>
  | Readonly<{
      type: "setBars";
      bars: number;
    }>
  | Readonly<{
      type: "updateTrack";
      trackId: string;
      patch: TrackPatch;
    }>
  | Readonly<{
      type: "setAutomation";
      trackId: string;
      parameter: AutomationParameter;
      points: readonly AutomationPoint[];
    }>
  | Readonly<{
      type: "clearTrack";
      trackId: string;
    }>;

export function applyScoreOperation(
  score: TrackScore,
  operation: ScoreOperation,
): TrackScore {
  if (operation.type === "addTrack") return addTrack(score, operation.track);
  if (operation.type === "addNote") return addNote(score, operation.note);
  if (operation.type === "removeNote")
    return removeNote(score, operation.noteId);
  if (operation.type === "updateNote")
    return updateNote(score, operation.noteId, operation.patch);
  if (operation.type === "setTempo") return score.withTempo(operation.tempoBpm);
  if (operation.type === "setBars") return score.withBars(operation.bars);
  if (operation.type === "updateTrack")
    return updateTrack(score, operation.trackId, operation.patch);
  if (operation.type === "setAutomation")
    return operation.parameter === "volume"
      ? setVolumeAutomation(score, operation.trackId, operation.points)
      : operation.parameter === "pan"
        ? setPanAutomation(score, operation.trackId, operation.points)
        : setFilterAutomation(score, operation.trackId, operation.points);
  if (operation.type === "clearTrack")
    return clearTrack(score, operation.trackId);
  return assertNever(operation);
}

export function scoreFromJSON(value: unknown): TrackScore {
  if (!isRecord(value))
    throw new ScoreValidationError("score must be an object");
  const version = value.version;
  if (version !== undefined && version !== SCORE_VERSION) {
    const displayedVersion =
      typeof version === "string" ||
      typeof version === "number" ||
      typeof version === "boolean" ||
      typeof version === "bigint"
        ? String(version)
        : "[object]";
    throw new ScoreValidationError(
      `unsupported score version: ${displayedVersion}`,
    );
  }
  const data: {
    tempoBpm?: number;
    beatsPerBar?: number;
    bars?: number;
    ticksPerBeat?: number;
    key?: string | null;
    tracks: readonly TrackInput[];
    notes: readonly NoteInput[];
  } = {
    tracks: optionalArray(value.tracks).map(parseTrack),
    notes: optionalArray(value.notes).map(parseNote),
  };
  const tempoBpm = optionalNumber(value.tempoBpm);
  const beatsPerBar = optionalNumber(value.beatsPerBar);
  const bars = optionalNumber(value.bars);
  const ticksPerBeat = optionalNumber(value.ticksPerBeat);
  const key = optionalNullableString(value.key);
  if (tempoBpm !== undefined) data.tempoBpm = tempoBpm;
  if (beatsPerBar !== undefined) data.beatsPerBar = beatsPerBar;
  if (bars !== undefined) data.bars = bars;
  if (ticksPerBeat !== undefined) data.ticksPerBeat = ticksPerBeat;
  if (key !== undefined) data.key = key;
  return new TrackScore(data);
}

function normalizeTracks(inputs: readonly unknown[]): Track[] {
  if (!Array.isArray(inputs) || inputs.length > SCORE_LIMITS.maxTracks) {
    throw new ScoreValidationError(
      `score cannot contain more than ${SCORE_LIMITS.maxTracks} tracks`,
      "score-limit",
    );
  }
  const seen = new Set<string>();
  return inputs.map((input) => {
    const track = normalizeTrack(input);
    if (seen.has(track.id))
      throw new ScoreValidationError(
        `track id already exists: ${track.id}`,
        "duplicate-track",
      );
    seen.add(track.id);
    return track;
  });
}

function normalizeTrack(input: unknown): Track {
  if (!isRecord(input))
    throw new ScoreValidationError("track must be an object", "invalid-track");
  const id = boundedString(
    input.id,
    "track id",
    SCORE_LIMITS.maxIdLength,
    "invalid-track",
  );
  const name = boundedString(
    input.name ?? id,
    "track name",
    SCORE_LIMITS.maxNameLength,
    "invalid-track",
  );
  const instrument = boundedString(
    input.instrument ?? "sine",
    "instrument",
    SCORE_LIMITS.maxInstrumentLength,
    "invalid-track",
  );
  const muted = input.muted ?? false;
  if (typeof muted !== "boolean")
    throw new ScoreValidationError(
      "track muted must be boolean",
      "invalid-track",
    );
  const volume = input.volume ?? 1;
  const pan = input.pan ?? 0;
  if (
    typeof volume !== "number" ||
    !Number.isFinite(volume) ||
    volume < 0 ||
    volume > 1
  )
    throw new ScoreValidationError(
      "track volume must be between 0 and 1",
      "invalid-track",
    );
  if (typeof pan !== "number" || !Number.isFinite(pan) || pan < -1 || pan > 1)
    throw new ScoreValidationError(
      "track pan must be between -1 and 1",
      "invalid-track",
    );
  const volumeAutomation = normalizeAutomation(
    input.volumeAutomation,
    "volumeAutomation",
    0,
    SCORE_LIMITS.maxVolume,
  );
  const panAutomation = normalizeAutomation(
    input.panAutomation,
    "panAutomation",
    -1,
    1,
  );
  const solo = input.solo ?? false;
  if (typeof solo !== "boolean")
    throw new ScoreValidationError(
      "track solo must be boolean",
      "invalid-track",
    );
  const filter = normalizeFilter(input.filter);
  const delay = normalizeDelay(input.delay);
  const filterAutomation = normalizeAutomation(
    input.filterAutomation,
    "filterAutomation",
    SCORE_LIMITS.minFilterCutoff,
    SCORE_LIMITS.maxFilterCutoff,
  );
  return Object.freeze({
    id,
    name,
    instrument,
    muted,
    volume,
    pan,
    volumeAutomation,
    panAutomation,
    ...(solo ? { solo } : {}),
    ...(filter ? { filter } : {}),
    ...(delay ? { delay } : {}),
    ...(filterAutomation.length > 0 ? { filterAutomation } : {}),
  });
}

export function normalizeFilter(input: unknown): TrackFilter | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input))
    throw new ScoreValidationError(
      "track filter must be an object or null",
      "invalid-track",
    );
  const cutoff = boundedNumber(
    input.cutoff,
    "track filter cutoff",
    SCORE_LIMITS.minFilterCutoff,
    SCORE_LIMITS.maxFilterCutoff,
  );
  const resonance = boundedNumber(
    input.resonance ?? 0,
    "track filter resonance",
    0,
    SCORE_LIMITS.maxFilterResonance,
  );
  return Object.freeze({ cutoff, resonance });
}

export function normalizeDelay(input: unknown): TrackDelay | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input))
    throw new ScoreValidationError(
      "track delay must be an object or null",
      "invalid-track",
    );
  const beats = boundedNumber(
    input.beats,
    "track delay beats",
    SCORE_LIMITS.minDelayBeats,
    SCORE_LIMITS.maxDelayBeats,
  );
  const feedback = boundedNumber(
    input.feedback ?? 0.3,
    "track delay feedback",
    0,
    SCORE_LIMITS.maxDelayFeedback,
  );
  const mix = boundedNumber(
    input.mix ?? 0.35,
    "track delay mix",
    0,
    SCORE_LIMITS.maxDelayMix,
  );
  return Object.freeze({ beats, feedback, mix });
}

function boundedNumber(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new ScoreValidationError(
      `${label} must be between ${min} and ${max}`,
      "invalid-track",
    );
  return value;
}

function normalizeAutomation(
  input: unknown,
  label: string,
  minValue: number,
  maxValue: number,
): readonly AutomationPoint[] {
  if (input === undefined) return Object.freeze([]);
  if (!Array.isArray(input) || input.length > SCORE_LIMITS.maxAutomationPoints)
    throw new ScoreValidationError(
      `${label} must contain at most ${SCORE_LIMITS.maxAutomationPoints} points`,
      "score-limit",
    );
  const points = input.map((candidate) => {
    if (!isRecord(candidate))
      throw new ScoreValidationError(
        `${label} point must be an object`,
        "invalid-track",
      );
    const tick = candidate.tick;
    const value = candidate.value;
    if (
      typeof tick !== "number" ||
      !Number.isInteger(tick) ||
      tick < 0 ||
      tick > SCORE_LIMITS.maxTick
    )
      throw new ScoreValidationError(
        `${label} point tick must be an integer between 0 and ${SCORE_LIMITS.maxTick}`,
        "invalid-track",
      );
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < minValue ||
      value > maxValue
    )
      throw new ScoreValidationError(
        `${label} point value must be between ${minValue} and ${maxValue}`,
        "invalid-track",
      );
    return Object.freeze({ tick, value });
  });
  points.sort((a, b) => a.tick - b.tick);
  for (let index = 1; index < points.length; index += 1) {
    if (points[index]!.tick === points[index - 1]!.tick)
      throw new ScoreValidationError(
        `${label} points cannot share a tick`,
        "invalid-track",
      );
  }
  return freezeArray(points);
}

function normalizeNotes(inputs: readonly unknown[]): Note[] {
  if (!Array.isArray(inputs) || inputs.length > SCORE_LIMITS.maxNotes) {
    throw new ScoreValidationError(
      `score cannot contain more than ${SCORE_LIMITS.maxNotes} notes`,
      "score-limit",
    );
  }
  const seen = new Set<string>();
  const notes = inputs.map((input) => {
    const note = normalizeNote(input);
    if (seen.has(note.id))
      throw new ScoreValidationError(
        `note id already exists: ${note.id}`,
        "duplicate-note",
      );
    seen.add(note.id);
    return note;
  });
  return notes.sort(compareNotes);
}

function normalizeNote(input: unknown): Note {
  if (!isRecord(input))
    throw new ScoreValidationError("note must be an object", "invalid-note");
  const id = boundedString(
    input.id,
    "note id",
    SCORE_LIMITS.maxIdLength,
    "invalid-note",
  );
  const trackId = boundedString(
    input.trackId,
    "note trackId",
    SCORE_LIMITS.maxIdLength,
    "invalid-note",
  );
  const startTick = input.startTick ?? input.start;
  const durationTicks = input.durationTicks ?? input.duration;
  if (
    typeof startTick !== "number" ||
    !Number.isInteger(startTick) ||
    startTick < 0 ||
    startTick > SCORE_LIMITS.maxTick
  ) {
    throw new ScoreValidationError(
      `note ${id} startTick must be an integer between 0 and ${SCORE_LIMITS.maxTick}`,
      "invalid-note",
    );
  }
  if (
    typeof durationTicks !== "number" ||
    !Number.isInteger(durationTicks) ||
    durationTicks < 1 ||
    durationTicks > SCORE_LIMITS.maxTick
  ) {
    throw new ScoreValidationError(
      `note ${id} durationTicks must be an integer between 1 and ${SCORE_LIMITS.maxTick}`,
      "invalid-note",
    );
  }
  const pitch = input.pitch;
  if (
    typeof pitch !== "number" ||
    !Number.isInteger(pitch) ||
    pitch < 0 ||
    pitch > 127
  ) {
    throw new ScoreValidationError(
      `note ${id} pitch must be a MIDI integer between 0 and 127`,
      "invalid-note",
    );
  }
  if (
    typeof input.velocity !== "number" ||
    !Number.isFinite(input.velocity) ||
    input.velocity < 0 ||
    input.velocity > 1
  ) {
    throw new ScoreValidationError(
      `note ${id} velocity must be between 0 and 1`,
      "invalid-note",
    );
  }
  return Object.freeze({
    id,
    trackId,
    startTick,
    durationTicks,
    pitch,
    velocity: input.velocity,
  });
}

function parseTrack(value: unknown): TrackInput {
  if (!isRecord(value))
    throw new ScoreValidationError("track must be an object", "invalid-track");
  return value as unknown as TrackInput;
}

function parseNote(value: unknown): NoteInput {
  if (!isRecord(value))
    throw new ScoreValidationError("note must be an object", "invalid-note");
  return value as unknown as NoteInput;
}

function compareNotes(a: Note, b: Note): number {
  return (
    a.startTick - b.startTick ||
    a.trackId.localeCompare(b.trackId) ||
    a.pitch - b.pitch ||
    a.id.localeCompare(b.id)
  );
}

function boundedString(
  value: unknown,
  label: string,
  max: number,
  code: ScoreValidationError["code"],
): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new ScoreValidationError(
      `${label} must be a non-empty string of at most ${max} characters`,
      code,
    );
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return value === undefined
    ? undefined
    : typeof value === "number"
      ? value
      : Number.NaN;
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === undefined || value === null || typeof value === "string")
    return value;
  return "\u0000invalid";
}

function optionalArray(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new ScoreValidationError("array field is malformed");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function freezeArray<T>(items: readonly T[]): readonly T[] {
  return Object.freeze([...items]);
}

function assertNever(value: never): never {
  throw new ScoreValidationError(
    `unsupported score operation: ${String(value)}`,
  );
}
