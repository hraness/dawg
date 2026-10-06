export type AgentOperation =
  | {
      type: "add-note";
      pitch: number;
      start: number;
      duration: number;
      velocity: number;
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
      };
    }
  | { type: "set-tempo"; tempoBpm: number }
  | {
      type: "track";
      patch: {
        instrument?: string;
        muted?: boolean;
        volume?: number;
        pan?: number;
        name?: string;
      };
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
  const tempo = text.match(/^(?:tempo|bpm)\s+(\d+(?:\.\d+)?)\s*$/);
  if (tempo) {
    const tempoBpm = Number(tempo[1]);
    if (Number.isFinite(tempoBpm)) return { type: "set-tempo", tempoBpm };
  }
  if (/^(?:clear|clear\s+track|remove\s+all)\b/.test(text))
    return { type: "clear-track" };
  const instrument = text.match(
    /^(?:instrument|sound|voice)\s+([a-z0-9._ -]{1,64})$/,
  );
  if (instrument)
    return { type: "track", patch: { instrument: instrument[1]!.trim() } };
  if (/^(?:mute|silence)\b/.test(text))
    return { type: "track", patch: { muted: true } };
  if (/^(?:unmute|unsilence)\b/.test(text))
    return { type: "track", patch: { muted: false } };
  const volume = text.match(/^(?:volume|vol)\s+(0(?:\.\d+)?|1(?:\.0+)?)$/);
  if (volume) return { type: "track", patch: { volume: Number(volume[1]) } };
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
  const match = text.match(
    /^(?:add|put)\s+(?:note\s+)?([a-g](?:#|b)?-?\d+)\s+(?:at\s+)?(\d+(?:\.\d+)?)\s*(?:for|dur|duration)?\s*(\d+(?:\.\d+)?)?$/,
  );
  if (!match) return undefined;
  const pitch = pitchToMidi(match[1] ?? "c4");
  const start = Number(match[2] ?? 0);
  const duration = Number(match[3] ?? 1);
  if (
    !Number.isFinite(pitch) ||
    !Number.isFinite(start) ||
    !Number.isFinite(duration) ||
    duration <= 0
  )
    return undefined;
  return { type: "add-note", pitch, start, duration, velocity: 0.8 };
}

function pitchToMidi(value: string): number {
  const match = value.match(/^([a-g])([#b]?)(-?\d+)$/);
  if (!match) return Number.NaN;
  const semitones: Record<string, number> = {
    c: 0,
    d: 2,
    e: 4,
    f: 5,
    g: 7,
    a: 9,
    b: 11,
  };
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  return (
    (Number(match[3]) + 1) * 12 + (semitones[match[1] ?? "c"] ?? 0) + accidental
  );
}
