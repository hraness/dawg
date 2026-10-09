import { resolveInstrumentWord } from "../../core/instruments.ts";
import { pitchToMidi } from "../../core/pitch.ts";
import { SCORE_LIMITS } from "../../core/score.ts";

export { pitchToMidi };

export type AgentOperation =
  | { type: "add-track"; trackId: string }
  | {
      type: "add-note";
      pitch: number;
      start: number;
      duration: number;
      velocity: number;
      /** Static offset from an `E4-14c` pitch; absent is 0. */
      cents?: number;
    }
  | { type: "remove-note"; noteId: string }
  | {
      type: "update-note";
      noteId: string;
      patch: {
        start?: number;
        duration?: number;
        pitch?: number;
        velocity?: number;
        /** 0 clears the offset. */
        cents?: number;
      };
    }
  | { type: "set-tempo"; tempoBpm: number }
  | { type: "set-bars"; bars: number }
  | { type: "extend-bars"; bars: number }
  | {
      type: "track";
      patch: {
        instrument?: string;
        string?: { preset: string };
        muted?: boolean;
        volume?: number;
        pan?: number;
        name?: string;
      };
      /** The instrument word as typed (a guitar alias also loads its rig). */
      word?: string;
    }
  | {
      type: "automation";
      parameter: "volume" | "pan";
      points: readonly { beat: number; value: number }[];
    }
  | { type: "clear-track" }
  | { type: "transport"; action: "play" | "pause" | "toggle" };

export function parsePrompt(prompt: string): AgentOperation | undefined {
  const text = prompt.trim().toLowerCase();
  if (/^(play|start)\b/.test(text))
    return { type: "transport", action: "play" };
  if (/^(pause|stop)\b/.test(text))
    return { type: "transport", action: "pause" };
  if (/^toggle\b/.test(text)) return { type: "transport", action: "toggle" };
  const track = text.match(/^(?:add\s+)?track\s+([a-z0-9._-]{1,64})$/);
  if (track) return { type: "add-track", trackId: track[1]! };
  const bars = text.match(/^bars\s+(\d+)$/);
  const extension = text.match(/^extend\s+(\d+)\s+bars?$/);
  if (bars || extension) {
    const count = Number((bars ?? extension)![1]);
    if (Number.isInteger(count) && count >= 1 && count <= SCORE_LIMITS.maxBars)
      return { type: bars ? "set-bars" : "extend-bars", bars: count };
  }
  const tempo = text.match(/^(?:tempo|bpm)\s+(\d+(?:\.\d+)?)\s*$/);
  if (tempo) {
    const tempoBpm = Number(tempo[1]);
    if (Number.isFinite(tempoBpm)) return { type: "set-tempo", tempoBpm };
  }
  if (/^(?:clear|clear\s+track|remove\s+all)$/.test(text))
    return { type: "clear-track" };
  const instrument = text.match(
    /^(?:instrument|sound|voice)\s+([a-z0-9._ -]{1,64})$/,
  );
  if (instrument) {
    const word = instrument[1]!.trim();
    return {
      type: "track",
      patch: instrumentPatch(word),
      ...(resolveInstrumentWord(word)?.fx ? { word } : {}),
    };
  }
  if (/^(?:mute|silence)\b/.test(text))
    return { type: "track", patch: { muted: true } };
  if (/^(?:unmute|unsilence)\b/.test(text))
    return { type: "track", patch: { muted: false } };
  const volume = text.match(/^(?:volume|vol)\s+(0(?:\.\d+)?|1(?:\.0+)?)$/);
  if (volume) return { type: "track", patch: { volume: Number(volume[1]) } };
  const clearAutomation = text.match(
    /^(?:clear|reset)\s+(?:(volume|pan)\s+)?automation$/,
  );
  if (clearAutomation)
    return {
      type: "automation",
      parameter:
        (clearAutomation[1] as "volume" | "pan" | undefined) ?? "volume",
      points: [],
    };
  const automation = text.match(
    /^(?:automate|automation)\s+(volume|pan)\s+at\s+(\d+(?:\.\d+)?)\s+(-?(?:0(?:\.\d+)?|1(?:\.0+)?))$/,
  );
  if (automation) {
    const parameter = automation[1] as "volume" | "pan";
    const beat = Number(automation[2]);
    const value = Number(automation[3]);
    if (
      Number.isFinite(beat) &&
      Number.isFinite(value) &&
      (parameter === "pan" ? value >= -1 : value >= 0)
    )
      return {
        type: "automation",
        parameter,
        points: [{ beat, value }],
      };
  }
  const pan = text.match(/^(?:pan)\s+(-?1(?:\.0+)?|-?0(?:\.\d+)?)$/);
  if (pan) return { type: "track", patch: { pan: Number(pan[1]) } };
  const remove = text.match(
    /^(?:remove|delete)(?:\s+note)?\s+([a-z0-9._-]{1,64})$/,
  );
  if (remove) return { type: "remove-note", noteId: remove[1]! };
  const move = text.match(
    /^(?:move|shift)\s+(?:note\s+)?([a-z0-9._-]{1,64})\s+(?:to|at)\s+(\d+(?:\.\d+)?)$/,
  );
  if (move)
    return {
      type: "update-note",
      noteId: move[1]!,
      patch: { start: Number(move[2]) },
    };
  const length = text.match(
    /^(?:length|duration)\s+(?:note\s+)?([a-z0-9._-]{1,64})\s+(\d+(?:\.\d+)?)$/,
  );
  if (length)
    return {
      type: "update-note",
      noteId: length[1]!,
      patch: { duration: Number(length[2]) },
    };
  const velocity = text.match(
    /^(?:velocity|vel)\s+(?:note\s+)?([a-z0-9._-]{1,64})\s+(0(?:\.\d+)?|1(?:\.0+)?)$/,
  );
  if (velocity)
    return {
      type: "update-note",
      noteId: velocity[1]!,
      patch: { velocity: Number(velocity[2]) },
    };
  const cents = text.match(
    /^(?:cents|detune)\s+(?:note\s+)?([a-z0-9._-]{1,64})\s+([+-]?\d+(?:\.\d+)?)c?$/,
  );
  if (cents) {
    const value = Number(cents[2]);
    if (Math.abs(value) <= 1200)
      return {
        type: "update-note",
        noteId: cents[1]!,
        patch: { cents: value },
      };
  }
  const match = text.match(
    /^(?:add|put)\s+(?:note\s+)?([a-g](?:#|b)?-?\d+)([+-]\d+(?:\.\d+)?c)?\s+(?:at\s+)?(\d+(?:\.\d+)?)\s*(?:for|dur|duration)?\s*(\d+(?:\.\d+)?)?$/,
  );
  if (!match) return undefined;
  const pitch = pitchToMidi(match[1] ?? "c4");
  const offset = match[2] ? Number(match[2].slice(0, -1)) : 0;
  const start = Number(match[3] ?? 0);
  const duration = Number(match[4] ?? 1);
  if (!(Math.abs(offset) <= 1200)) return undefined;
  if (
    !Number.isFinite(pitch) ||
    !Number.isFinite(start) ||
    !Number.isFinite(duration) ||
    duration <= 0
  )
    return undefined;
  return {
    type: "add-note",
    pitch,
    start,
    duration,
    velocity: 0.8,
    ...(offset !== 0 ? { cents: offset } : {}),
  };
}

/**
 * The track patch an instrument word means: a 0.6 resolver word for the
 * string engine also writes its preset (`instrument nylon` plays the nylon
 * string); every other word stores the instrument as before.
 */
export function instrumentPatch(word: string): {
  instrument: string;
  string?: { preset: string };
} {
  const meaning = resolveInstrumentWord(word);
  if (!meaning) return { instrument: word };
  if (meaning.field === "string" && meaning.preset)
    return {
      instrument: meaning.instrument,
      string: { preset: meaning.preset },
    };
  return { instrument: meaning.instrument };
}
