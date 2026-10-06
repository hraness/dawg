export type AgentOperation =
  | {
      type: "add-note";
      pitch: number;
      start: number;
      duration: number;
      velocity: number;
    }
  | { type: "remove-note"; noteId: string }
  | { type: "transport"; action: "play" | "pause" | "toggle" };

export function parsePrompt(prompt: string): AgentOperation | undefined {
  const text = prompt.trim().toLowerCase();
  if (/^(play|start)\b/.test(text))
    return { type: "transport", action: "play" };
  if (/^(pause|stop)\b/.test(text))
    return { type: "transport", action: "pause" };
  if (/^toggle\b/.test(text)) return { type: "transport", action: "toggle" };
  const match = text.match(
    /^(?:add|put)\s+(?:note\s+)?([a-g](?:#|b)?-?\d+)\s+(?:at\s+)?(\d+(?:\.\d+)?)\s*(?:for|dur|duration)?\s*(\d+(?:\.\d+)?)?/,
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
