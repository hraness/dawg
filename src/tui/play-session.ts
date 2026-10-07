/**
 * Play mode's controller: wires the pure keyboard mapper (play-mode.ts) to
 * live audition, the click bus and recording. Everything it touches goes
 * through a small host interface, so tests drive it with a fake engine and
 * an injected clock, and the TUI loop in main.ts only forwards keys and
 * frames.
 *
 * Recording appends notes to the focused track through ScoreOperations
 * (`addNote`, plus `removeNote` when replacing), committed once per bar as
 * the playhead leaves it: one undo entry per recorded bar, synced to other
 * windows and the project files like any other edit.
 *
 * Chord mode (play-chords.ts) turns a note key into a voiced chord: every
 * voice sounds through the same live path, strums and arpeggios are paced by
 * `tick()`, and a recorded chord is laid out with core/chords.ts `perform`
 * so the score holds exactly what an agent's `write_chords` would write.
 */
import {
  applyScoreOperation,
  type ScoreOperation,
  type TrackScore,
} from "../../core/score.ts";
import type { ClickBus } from "../audio/engine.ts";
import { DEFAULT_CLICK_VOLUME, parseClickArgument } from "../audio/click.ts";
import {
  LiveSynth,
  MAX_LIVE_NOTE_SECONDS,
  type LiveNotePcm,
} from "../audio/live.ts";
import type { SampleBank } from "../audio/samples.ts";
import {
  DEFAULT_STRUM,
  perform,
  type PerformMode,
  type PerformedNote,
} from "../../core/chords.ts";
import {
  ChordPad,
  chordCapable,
  defaultChordSettings,
  songKey,
  type ChordSettings,
  type PlayedChord,
} from "./play-chords.ts";
import type { PlayHeaderView, PlayStripKey } from "../../tui/play-strip.ts";
import {
  NOTE_KEYS,
  PlayKeyboard,
  REPEAT_DELAY_MS,
  playLayoutFor,
  stripCells,
  type PlayAction,
  type PlayCommand,
  type PlayLayout,
  type PlayedNote,
} from "./play-mode.ts";

/** The part of AudioEngine play mode uses. */
export interface LiveEngine {
  readonly sampleRate: number;
  readonly canMonitor: boolean;
  readonly leadMs: number;
  monitor(on: boolean): Promise<void>;
  setLeadMs(ms: number | undefined): void;
  noteOn(id: number, note: LiveNotePcm): number;
  noteOff(id: number): void;
  setClick(click: ClickBus | undefined): void;
}

export interface PlayHost {
  score(): TrackScore;
  trackId(): string;
  /** Monotonic ms (performance.now()). */
  now(): number;
  playing(): boolean;
  /** Transport beat (unwrapped) at monotonic `ms`. */
  beatAt(ms: number): number;
  engine(): LiveEngine | undefined;
  samples?(): SampleBank | undefined;
  commit(
    next: TrackScore,
    kind: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
  /** Start the transport at `beat`. */
  startTransport(beat: number): Promise<void>;
  stopTransport(): Promise<void>;
  card(text: string, tone: "info" | "success" | "warning" | "error"): void;
  newNoteId(): string;
}

/** Grid steps in beats, coarse to fine. */
export const GRIDS: readonly Readonly<{ label: string; beats: number }>[] =
  Object.freeze([
    { label: "1/4", beats: 1 },
    { label: "1/8", beats: 0.5 },
    { label: "1/8T", beats: 1 / 3 },
    { label: "1/16", beats: 0.25 },
    { label: "1/16T", beats: 1 / 6 },
    { label: "1/32", beats: 0.125 },
  ]);
export const DEFAULT_GRID = "1/16";
/** Play mode's queue lead: short enough that a key feels immediate. */
export const PLAY_LEAD_MS = 60;
export const FLASH_MS = 110;

export function gridBeats(label: string): number | undefined {
  return GRIDS.find((grid) => grid.label === label.toUpperCase())?.beats;
}

/** Snap `beat` to the nearest multiple of `step`. */
export function quantize(beat: number, step: number): number {
  if (!(step > 0)) return beat;
  return Math.round(beat / step) * step;
}

type Pending = {
  id: number;
  pitch: number;
  velocity: number;
  atMs: number;
  /** Unwrapped transport beat of the press. */
  beat: number;
  releaseAtMs: number;
  /** Set when the key played a chord: laid out with `perform` on flush. */
  chord?: RecordedChord;
};

/** What a recorded chord press expands to. */
export type RecordedChord = Readonly<{
  pitches: readonly number[];
  bass?: number | undefined;
  mode: PerformMode;
  /** Arp step in beats. */
  rate: number;
  octaves: number;
  seed: number;
  /** CHORD_PATTERNS name when `mode` is `pattern`. */
  pattern?: string;
}>;

/** A chord sounding live: its voices start and stop from `tick()`. */
type LiveChord = {
  played: PlayedChord;
  velocity: number;
  startMs: number;
  releaseAtMs: number;
  /** Voices in beats from the press, sorted by start. */
  plan: PerformedNote[];
  next: number;
  /** Live voice id → its plan index, start and own end (Infinity: the key's). */
  sounding: Map<number, { index: number; atMs: number; endMs: number }>;
};

/** Beats a held live chord's plan covers (arps keep stepping this long). */
const LIVE_PLAN_BEATS = 64;
/** Live chord voices use ids far above the keyboard's. */
const VOICE_ID_BASE = 1_000_000_000;

type CountIn = { startMs: number; beats: number; startBeat: number };

export type PlayKeyResult =
  | { type: "handled" }
  | { type: "unmapped" }
  | { type: "command"; command: PlayCommand };

export class PlaySession {
  public readonly keyboard: PlayKeyboard;
  public layout: PlayLayout;
  public armed = false;
  public replace = false;
  public clickOn = false;
  public clickVolume = DEFAULT_CLICK_VOLUME;
  public countInBars = 1;
  public grid = DEFAULT_GRID;
  public status: string | undefined;
  private active = false;
  private synth: LiveSynth | undefined;
  private readonly pending = new Map<number, Pending>();
  /** Played note id → recorded score note id, for this pass. */
  private readonly recordedIds = new Set<string>();
  /** In-loop bars the playhead finished while replacing. */
  private readonly replaceBars = new Set<number>();
  private lastBar: number | undefined;
  private countIn: CountIn | undefined;
  private flushing: Promise<void> = Promise.resolve();
  /** Most recent key-to-sound schedule, ms (lead before device latency). */
  public lastLatencyMs: number | undefined;
  private readonly trackId: string;
  public readonly chords: ChordPad;
  private readonly liveChords = new Map<number, LiveChord>();
  private nextVoiceId = VOICE_ID_BASE;
  /** The `n` key's last route, so its auto-repeats hold one chord. */
  private nRoute:
    { key: string; chord: PlayedChord["chord"]; atMs: number } | undefined;

  /** The track this session plays and records into. */
  public get track(): string {
    return this.trackId;
  }

  public constructor(
    private readonly host: PlayHost,
    options: Readonly<{
      clickOn?: boolean;
      clickVolume?: number;
      chords?: ChordSettings;
    }> = {},
  ) {
    this.trackId = host.trackId();
    const track = this.trackData();
    this.layout = playLayoutFor(track);
    const settings = options.chords ?? defaultChordSettings();
    // Auto chords by default on chord-capable tracks, until chosen by hand.
    if (!settings.explicit)
      settings.mode = chordCapable(track) ? "auto" : "manual";
    this.chords = new ChordPad(settings, () => this.host.score().key);
    this.keyboard = new PlayKeyboard({ base: this.layout.base });
    this.clickOn = options.clickOn ?? false;
    this.clickVolume = options.clickVolume ?? DEFAULT_CLICK_VOLUME;
  }

  public get on(): boolean {
    return this.active;
  }

  private trackData() {
    return this.host
      .score()
      .tracks.find((track) => track.id === this.host.trackId());
  }

  public get gridStep(): number {
    return gridBeats(this.grid) ?? 0.25;
  }

  /** Gate for a single press: one grid step at the current tempo. */
  public gateMs(): number {
    return (this.gridStep * 60_000) / this.host.score().tempoBpm;
  }

  public async enter(): Promise<void> {
    this.active = true;
    const engine = this.host.engine();
    if (engine?.canMonitor) {
      engine.setLeadMs(PLAY_LEAD_MS);
      await engine.monitor(true);
    } else this.status = "no audio · keys still record";
    this.applyClick();
  }

  public async exit(): Promise<void> {
    if (!this.active) return;
    await this.stopRecording();
    this.active = false;
    this.countIn = undefined;
    const engine = this.host.engine();
    if (engine) {
      engine.setClick(this.clickOn ? this.clickBus() : undefined);
      engine.setLeadMs(undefined);
      await engine.monitor(false);
    }
  }

  /** The click bus the engine mixes: count-in, then the transport. */
  public clickBus(): ClickBus {
    const score = this.host.score();
    return {
      volume: this.clickVolume,
      beatsPerBar: score.beatsPerBar,
      subdivision: 1,
      beatAt: (ms) => this.clickBeatAt(ms),
    };
  }

  /** Beat the click follows at `ms`, or undefined while silent. */
  public clickBeatAt(ms: number): number | undefined {
    const count = this.countIn;
    if (count) {
      const beatMs = 60_000 / this.host.score().tempoBpm;
      return count.startBeat - count.beats + (ms - count.startMs) / beatMs;
    }
    if (!this.clickOn || !this.host.playing()) return undefined;
    return this.host.beatAt(ms);
  }

  private applyClick(): void {
    const engine = this.host.engine();
    if (!engine) return;
    engine.setClick(this.clickOn || this.countIn ? this.clickBus() : undefined);
  }

  /** `/click on|off|<volume>`. */
  public clickCommand(argument: string): string {
    const parsed = parseClickArgument(argument, {
      on: this.clickOn,
      volume: this.clickVolume,
    });
    if ("error" in parsed) return parsed.error;
    this.clickOn = parsed.on;
    this.clickVolume = parsed.volume || this.clickVolume;
    this.applyClick();
    return this.clickOn
      ? `click on · ${Math.round(this.clickVolume * 100)}%`
      : "click off";
  }

  public setCountIn(bars: number): string {
    this.countInBars = Math.max(0, Math.min(2, Math.round(bars)));
    return `count-in · ${this.countInBars} bar${this.countInBars === 1 ? "" : "s"}`;
  }

  public setGrid(label: string): string | undefined {
    const match = GRIDS.find((grid) => grid.label === label.toUpperCase());
    if (!match) return undefined;
    this.grid = match.label;
    return `grid · ${match.label}`;
  }

  /** Handle one decoded key; mode commands return to the caller. */
  public press(value: string): PlayKeyResult {
    const now = this.host.now();
    let key = value;
    if (this.chords.on && value === "n") {
      // Route the suggestion through the note key of its root, so holding
      // `n` sustains it like any held key.
      const route =
        this.nRoute && now - this.nRoute.atMs <= REPEAT_DELAY_MS
          ? this.nRoute
          : { ...this.nextRoute(), atMs: now };
      route.atMs = now;
      this.nRoute = route;
      this.chords.force(route.chord);
      key = route.key;
    } else {
      const pad = this.chords.press(value);
      if (pad.type === "status") {
        this.status = pad.status;
        return { type: "handled" };
      }
    }
    const action = this.keyboard.press(key, now, this.gateMs());
    return this.apply(action, now);
  }

  /** The suggested next chord and the lowest note key on its root. */
  private nextRoute(): { key: string; chord: PlayedChord["chord"] } {
    const chord = this.chords.next();
    const keys = Object.entries(NOTE_KEYS).sort((a, b) => a[1] - b[1]);
    const found = keys.find(
      ([, offset]) => (this.keyboard.base + offset - chord.root) % 12 === 0,
    );
    return { key: found?.[0] ?? "a", chord };
  }

  private apply(action: PlayAction, now: number): PlayKeyResult {
    switch (action.type) {
      case "unmapped":
        return { type: "unmapped" };
      case "command":
        return this.command(action.command);
      case "octave":
        this.status = action.clamped
          ? `octave limit · ${this.keyboard.range}`
          : `octave ${this.keyboard.range}`;
        return { type: "handled" };
      case "velocity":
        this.status = `velocity ${action.velocity}${action.clamped ? " · limit" : ""}`;
        return { type: "handled" };
      case "sustain":
        this.release(action.released, action.atMs);
        this.status = action.on ? "sustain latched" : "sustain off";
        return { type: "handled" };
      case "note": {
        this.release(action.released, now);
        const chord = this.chords.chordFor(action.note.pitch);
        if (chord) {
          const played = this.chords.voice(chord, action.note.pitch);
          this.startChord(action.note, played);
          this.record(action.note, this.recordedChord(played, action.note.id));
          this.status = played.name;
          return { type: "handled" };
        }
        // Bass modes that sound bass under single notes (unison, single, solo).
        const single = this.chords.single(action.note.pitch);
        if (single) {
          this.startChord(action.note, single, "block");
          this.record(
            action.note,
            this.recordedChord(single, action.note.id, "block"),
          );
          return { type: "handled" };
        }
        this.sound(action.note.id, action.note);
        this.record(action.note);
        return { type: "handled" };
      }
      case "extend": {
        const pending = this.pending.get(action.id);
        if (action.absorbed !== undefined) {
          this.host.engine()?.noteOff(action.absorbed);
          this.stopChord(action.absorbed);
          this.pending.delete(action.absorbed);
        }
        if (pending) pending.releaseAtMs = action.releaseAtMs;
        const live = this.liveChords.get(action.id);
        if (live) {
          live.releaseAtMs = action.releaseAtMs;
          this.resoundChord(live);
          return { type: "handled" };
        }
        const pitch = this.keyboard.pitchFor(action.key);
        if (pitch !== undefined)
          this.sound(action.id, {
            id: action.id,
            key: action.key,
            pitch,
            velocity: this.keyboard.velocity,
            atMs: pending?.atMs ?? now,
            releaseAtMs: action.releaseAtMs,
            sustain: !Number.isFinite(action.releaseAtMs),
          });
        return { type: "handled" };
      }
    }
  }

  private command(command: PlayCommand): PlayKeyResult {
    if (command === "record") {
      this.armed = !this.armed;
      if (!this.armed) void this.stopRecording();
      this.status = this.armed ? "record armed" : "record off";
      return { type: "handled" };
    }
    if (command === "replace") {
      this.replace = !this.replace;
      this.armed = true;
      this.status = this.replace ? "replace · bars are overwritten" : "overdub";
      return { type: "handled" };
    }
    if (command === "click") {
      this.status = this.clickCommand("toggle");
      return { type: "handled" };
    }
    return { type: "command", command };
  }

  /** Render the note through the track's own voice and start it. */
  private sound(id: number, note: PlayedNote): void {
    const engine = this.host.engine();
    if (!engine?.canMonitor) return;
    const seconds = Number.isFinite(note.releaseAtMs)
      ? (note.releaseAtMs - note.atMs) / 1000
      : MAX_LIVE_NOTE_SECONDS;
    const samples = this.host.samples?.();
    if (this.synth?.rate !== engine.sampleRate)
      this.synth = new LiveSynth(engine.sampleRate);
    const pcm = this.synth.render({
      score: this.host.score(),
      trackId: this.trackId,
      pitch: note.pitch,
      velocity: note.velocity / 127,
      seconds,
      ...(samples ? { samples } : {}),
    });
    if (!pcm) return;
    const scheduled = engine.noteOn(id, pcm);
    this.lastLatencyMs = Math.max(0, scheduled - this.host.now());
  }

  private release(ids: readonly number[], atMs: number): void {
    const engine = this.host.engine();
    for (const id of ids) {
      engine?.noteOff(id);
      const live = this.liveChords.get(id);
      if (live) live.releaseAtMs = Math.min(live.releaseAtMs, atMs);
      const pending = this.pending.get(id);
      if (pending) pending.releaseAtMs = atMs;
    }
  }

  public get recording(): boolean {
    return this.armed && this.host.playing() && this.countIn === undefined;
  }

  private record(note: PlayedNote, chord?: RecordedChord): void {
    if (!this.recording) return;
    this.pending.set(note.id, {
      id: note.id,
      pitch: note.pitch,
      velocity: note.velocity,
      atMs: note.atMs,
      beat: this.host.beatAt(note.atMs),
      releaseAtMs: note.releaseAtMs,
      ...(chord ? { chord } : {}),
    });
  }

  private recordedChord(
    played: PlayedChord,
    seed: number,
    mode: PerformMode = this.chords.settings.perform,
  ): RecordedChord {
    const settings = this.chords.settings;
    return {
      pitches: played.pitches,
      bass: played.bass,
      mode,
      rate: this.chords.rateBeats(this.gridStep),
      octaves: settings.octaves,
      seed,
      ...(mode === "pattern" ? { pattern: settings.pattern } : {}),
    };
  }

  // ── live chords ──────────────────────────────────────────────────────

  private startChord(
    note: PlayedNote,
    played: PlayedChord,
    mode: PerformMode = this.chords.settings.perform,
  ): void {
    const settings = this.chords.settings;
    // Velocity 1: pattern hits carry their own accents, scaled by the press.
    const plan = perform(played.pitches, 0, LIVE_PLAN_BEATS, {
      mode,
      rate: this.chords.rateBeats(this.gridStep),
      octaves: settings.octaves,
      strum: mode === "harp" ? DEFAULT_STRUM * 2 : DEFAULT_STRUM,
      seed: note.id,
      pattern: settings.pattern,
      velocity: 1,
    });
    if (played.bass !== undefined)
      plan.push({
        pitch: played.bass,
        start: 0,
        length: LIVE_PLAN_BEATS,
        velocity: 1,
      });
    plan.sort((a, b) => a.start - b.start);
    this.liveChords.set(note.id, {
      played,
      velocity: note.velocity,
      startMs: note.atMs,
      releaseAtMs: note.releaseAtMs,
      plan,
      next: 0,
      sounding: new Map(),
    });
    this.pumpChords(this.host.now());
  }

  private stopChord(id: number): void {
    const live = this.liveChords.get(id);
    if (!live) return;
    const engine = this.host.engine();
    for (const voice of live.sounding.keys()) engine?.noteOff(voice);
    this.liveChords.delete(id);
  }

  private beatMs(): number {
    return 60_000 / this.host.score().tempoBpm;
  }

  /** Start due voices, end finished ones, drop released chords. */
  private pumpChords(now: number): void {
    if (this.liveChords.size === 0) return;
    const engine = this.host.engine();
    const beatMs = this.beatMs();
    for (const [id, live] of this.liveChords) {
      for (const [voice, state] of live.sounding)
        if (state.endMs <= now || live.releaseAtMs <= now) {
          engine?.noteOff(voice);
          live.sounding.delete(voice);
        }
      while (live.next < live.plan.length) {
        const planned = live.plan[live.next]!;
        const atMs = live.startMs + planned.start * beatMs;
        if (atMs > now || atMs >= live.releaseAtMs) break;
        live.next += 1;
        const endMs = live.startMs + (planned.start + planned.length) * beatMs;
        // Notes that ring to the end of the plan follow the key instead.
        const own = planned.start + planned.length < LIVE_PLAN_BEATS - 1e-6;
        const voice = this.nextVoiceId++;
        live.sounding.set(voice, {
          index: live.next - 1,
          atMs,
          endMs: own ? endMs : Infinity,
        });
        this.soundVoice(
          voice,
          live,
          planned,
          atMs,
          own ? endMs : live.releaseAtMs,
        );
      }
      const exhausted =
        live.next >= live.plan.length ||
        live.startMs + live.plan[live.next]!.start * beatMs >= live.releaseAtMs;
      if (live.releaseAtMs <= now || (exhausted && live.sounding.size === 0))
        this.stopChord(id);
    }
  }

  /** A held chord's release moved: re-render the voices that follow it. */
  private resoundChord(live: LiveChord): void {
    for (const [voice, state] of live.sounding)
      if (!Number.isFinite(state.endMs)) {
        const planned = live.plan[state.index]!;
        this.soundVoice(voice, live, planned, state.atMs, live.releaseAtMs);
      }
  }

  private soundVoice(
    voice: number,
    live: LiveChord,
    planned: Readonly<{ pitch: number; velocity: number }>,
    atMs: number,
    endMs: number,
  ): void {
    this.sound(voice, {
      id: voice,
      key: "",
      pitch: planned.pitch,
      velocity: scaleVelocity(live.velocity, planned.velocity),
      atMs,
      releaseAtMs: endMs,
      sustain: !Number.isFinite(endMs),
    });
  }

  /**
   * Space in play mode: with record armed and the transport stopped, count
   * in from the bar the playhead is in, then start. Returns false when the
   * caller should toggle the transport itself.
   */
  public startWithCountIn(): boolean {
    if (!this.armed || this.host.playing() || this.countIn) return false;
    const score = this.host.score();
    const startBeat =
      Math.floor(this.host.beatAt(this.host.now()) / score.beatsPerBar) *
      score.beatsPerBar;
    if (this.countInBars === 0) {
      void this.host.startTransport(startBeat);
      return true;
    }
    this.countIn = {
      startMs: this.host.now(),
      beats: this.countInBars * score.beatsPerBar,
      startBeat,
    };
    this.applyClick();
    return true;
  }

  /** Advance count-in, flush finished bars. Call every frame. */
  public tick(): void {
    if (!this.active) return;
    const now = this.host.now();
    this.pumpChords(now);
    const count = this.countIn;
    if (count) {
      const beatMs = 60_000 / this.host.score().tempoBpm;
      if (now - count.startMs >= count.beats * beatMs) {
        this.countIn = undefined;
        this.applyClick();
        void this.host.startTransport(count.startBeat);
      }
      return;
    }
    if (!this.armed || !this.host.playing()) {
      if (this.pending.size > 0 || this.replaceBars.size > 0)
        void this.stopRecording();
      this.lastBar = undefined;
      return;
    }
    const score = this.host.score();
    const bar = Math.floor(this.host.beatAt(now) / score.beatsPerBar);
    if (this.lastBar !== undefined && bar !== this.lastBar) {
      if (this.replace) this.replaceBars.add(this.loopBar(this.lastBar));
      this.queueFlush(bar, now, false);
    }
    this.lastBar = bar;
  }

  private loopBar(bar: number): number {
    const bars = this.host.score().bars;
    return ((bar % bars) + bars) % bars;
  }

  /** Commit what record armed collected; called when recording ends. */
  public async stopRecording(): Promise<void> {
    const now = this.host.now();
    this.queueFlush(Number.POSITIVE_INFINITY, now, true);
    await this.flushing;
    this.recordedIds.clear();
    this.lastBar = undefined;
  }

  private queueFlush(currentBar: number, now: number, all: boolean): void {
    this.flushing = this.flushing
      .then(() => this.flush(currentBar, now, all))
      .catch((error: unknown) =>
        this.host.card(
          `record failed · ${error instanceof Error ? error.message : String(error)}`,
          "error",
        ),
      );
  }

  /**
   * Commit pending notes whose bar is behind the playhead and whose key has
   * released (all of them when `all`), plus replace-mode erasures.
   */
  private async flush(
    currentBar: number,
    now: number,
    all: boolean,
  ): Promise<void> {
    const score = this.host.score();
    const ready: Pending[] = [];
    for (const pending of this.pending.values()) {
      const bar = Math.floor(pending.beat / score.beatsPerBar);
      const released = pending.releaseAtMs <= now;
      if (all || (bar < currentBar && released)) ready.push(pending);
    }
    const erase = [...this.replaceBars];
    this.replaceBars.clear();
    if (ready.length === 0 && erase.length === 0) return;
    for (const pending of ready) this.pending.delete(pending.id);
    const operations = recordOperations(score, {
      trackId: this.trackId,
      notes: ready.flatMap((pending) => {
        const beats =
          ((Math.min(pending.releaseAtMs, now) - pending.atMs) *
            score.tempoBpm) /
          60_000;
        return pending.chord
          ? chordNotes(pending.chord, {
              beat: pending.beat,
              beats,
              velocity: pending.velocity,
              grid: this.gridStep,
            })
          : [
              {
                pitch: pending.pitch,
                velocity: pending.velocity,
                beat: pending.beat,
                beats,
              },
            ];
      }),
      grid: this.gridStep,
      eraseBars: erase,
      keep: this.recordedIds,
      newId: () => this.host.newNoteId(),
    });
    if (operations.length === 0) return;
    let next = score;
    for (const operation of operations)
      next = applyScoreOperation(next, operation);
    for (const operation of operations)
      if (operation.type === "addNote") this.recordedIds.add(operation.note.id);
    const added = operations.filter((op) => op.type === "addNote").length;
    const removed = operations.length - added;
    await this.host.commit(next, "score.record", {
      trackId: this.trackId,
      operations,
      replace: this.replace,
    });
    this.host.card(
      `recorded ${added} note${added === 1 ? "" : "s"}${removed ? ` · replaced ${removed}` : ""} · ${this.trackId}`,
      "success",
    );
  }

  public header(): PlayHeaderView {
    const now = this.host.now();
    const score = this.host.score();
    const count = this.countIn;
    let beat: PlayHeaderView["beat"];
    let countIn: string | undefined;
    const beatMs = 60_000 / score.tempoBpm;
    const at = count
      ? count.startBeat - count.beats + (now - count.startMs) / beatMs
      : this.host.playing()
        ? this.host.beatAt(now)
        : undefined;
    if (at !== undefined) {
      const whole = Math.floor(at);
      const inBar =
        ((whole % score.beatsPerBar) + score.beatsPerBar) % score.beatsPerBar;
      beat = {
        index: inBar + 1,
        of: score.beatsPerBar,
        flash: (at - whole) * beatMs < FLASH_MS,
      };
      if (count) countIn = `count-in ${Math.ceil(count.startBeat - at)}`;
    }
    return {
      range: this.keyboard.range,
      velocity: this.keyboard.velocity,
      armed: this.armed,
      recording: this.recording,
      replace: this.replace,
      click: this.clickOn,
      sustain: this.keyboard.sustain,
      countIn,
      beat,
      grid: `grid ${this.grid}`,
      chords: this.chords.headerText(songKey(this.host.score().key).set),
      status: this.status,
      keys: this.strip(now),
    };
  }

  public strip(now = this.host.now()): PlayStripKey[] {
    return stripCells(
      this.keyboard,
      this.keyboard.litKeys(now),
      this.layout.labels,
    ).map((cell) => {
      const chord = this.keyboard.pitchFor(cell.key);
      const name =
        chord === undefined ? undefined : this.chords.keyLabel(chord);
      return name ? { ...cell, label: name } : this.noteCell(cell);
    });
  }

  private noteCell(cell: PlayStripKey): PlayStripKey {
    return {
      ...cell,
      // Octave digits only on C keep 18 keys inside 80 columns.
      label:
        this.layout.labels.size > 0 ||
        (cell.label.startsWith("C") && !cell.label.startsWith("C#"))
          ? cell.label
          : cell.label.replace(/-?\d+$/, ""),
    };
  }
}

export type RecordedNote = Readonly<{
  pitch: number;
  /** MIDI velocity 1..127. */
  velocity: number;
  /** Unwrapped transport beat of the press. */
  beat: number;
  /** Held length in beats. */
  beats: number;
  /** Already on the grid (a laid-out chord voice): keep beat and length. */
  exact?: boolean;
}>;

/** A press velocity (1..127) times a pattern accent (0..1), at least 1. */
function scaleVelocity(velocity: number, accent: number): number {
  return accent >= 1 ? velocity : Math.max(1, Math.round(velocity * accent));
}

/**
 * A recorded chord press as notes: the press snaps to `grid`, its held
 * length rounds to whole grid steps (at least one), and `perform` lays the
 * voices out inside it; the bass holds the whole length.
 */
export function chordNotes(
  chord: RecordedChord,
  press: Readonly<{
    beat: number;
    beats: number;
    velocity: number;
    grid: number;
  }>,
): RecordedNote[] {
  const start = quantize(press.beat, press.grid);
  const length = Math.max(press.grid, quantize(press.beats, press.grid));
  const notes = perform(chord.pitches, start, length, {
    mode: chord.mode,
    rate: chord.rate,
    octaves: chord.octaves,
    strum: chord.mode === "harp" ? DEFAULT_STRUM * 2 : DEFAULT_STRUM,
    seed: chord.seed,
    ...(chord.pattern !== undefined ? { pattern: chord.pattern } : {}),
    velocity: 1,
  }).map((note) => ({
    pitch: note.pitch,
    velocity: scaleVelocity(press.velocity, note.velocity),
    beat: note.start,
    beats: note.length,
    exact: true,
  }));
  if (chord.bass !== undefined)
    notes.push({
      pitch: chord.bass,
      velocity: press.velocity,
      beat: start,
      beats: length,
      exact: true,
    });
  return notes;
}

/**
 * The ScoreOperations one recorded bar commits: notes quantized to `grid`
 * and wrapped into the loop (overdub), plus removals of existing notes that
 * start in `eraseBars` (replace), except notes this pass recorded (`keep`).
 */
export function recordOperations(
  score: TrackScore,
  options: Readonly<{
    trackId: string;
    notes: readonly RecordedNote[];
    grid: number;
    eraseBars?: readonly number[];
    keep?: ReadonlySet<string>;
    newId: () => string;
  }>,
): ScoreOperation[] {
  const operations: ScoreOperation[] = [];
  const loopBeats = score.bars * score.beatsPerBar;
  const tpb = score.ticksPerBeat;
  const erase = new Set(options.eraseBars ?? []);
  if (erase.size > 0)
    for (const note of score.notes) {
      if (note.trackId !== options.trackId) continue;
      if (options.keep?.has(note.id)) continue;
      const bar = Math.floor(note.startTick / tpb / score.beatsPerBar);
      if (erase.has(bar))
        operations.push({ type: "removeNote", noteId: note.id });
    }
  const removed = new Set(
    operations.map((operation) =>
      operation.type === "removeNote" ? operation.noteId : "",
    ),
  );
  const taken = new Set(
    score.notes
      .filter(
        (note) => note.trackId === options.trackId && !removed.has(note.id),
      )
      .map((note) => `${note.pitch}:${note.startTick}`),
  );
  for (const note of options.notes) {
    let start =
      (note.exact ? note.beat : quantize(note.beat, options.grid)) % loopBeats;
    if (start < 0) start += loopBeats;
    const beats = note.exact
      ? note.beats
      : Math.max(options.grid, quantize(note.beats, options.grid));
    const startTick = Math.round(start * tpb);
    const durationTicks = Math.max(
      1,
      Math.min(Math.round(beats * tpb), loopBeats * tpb - startTick),
    );
    const slot = `${note.pitch}:${startTick}`;
    // The same pitch on the same step twice is one note (a stutter).
    if (taken.has(slot)) continue;
    taken.add(slot);
    operations.push({
      type: "addNote",
      note: {
        id: options.newId(),
        trackId: options.trackId,
        startTick,
        durationTicks,
        pitch: note.pitch,
        velocity: Math.max(0.01, Math.min(1, note.velocity / 127)),
      },
    });
  }
  return operations;
}
