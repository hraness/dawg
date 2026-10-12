import type { DocMark } from "../guides/marks.ts";

/** Stable symbols carry the same meaning even without color. */
const MARKS: Record<string, DocMark> = {
  sound: { mark: "♪", ascii: "s", role: "track" },
  voice: { mark: "≈", ascii: "v", role: "track" },
  effects: { mark: "◇", ascii: "fx", role: "agent" },
  rhythm: { mark: "▦", ascii: "#", role: "warning" },
  chords: { mark: "♯", ascii: "#", role: "success" },
  mix: { mark: "≋", ascii: "=", role: "borderFocus" },
  arrange: { mark: "▤", ascii: "[]", role: "loopRule" },
  project: { mark: "▶", ascii: ">", role: "transport" },
  keys: { mark: "⌃", ascii: "^", role: "track" },
  agent: { mark: "✦", ascii: "*", role: "agent" },
};

export function topicMark(topic: string): DocMark | undefined {
  return MARKS[topic.toLowerCase().split(/[ ·]/)[0]!];
}
