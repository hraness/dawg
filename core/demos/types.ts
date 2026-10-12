import type { TrackScore } from "../score.ts";

/** Browsing a demo never renders audio or constructs its score. */
export type DemoInfo = Readonly<{
  id: string;
  title: string;
  style: string;
  description: string;
  tempoBpm: number;
  key: string;
  bars: number;
  durationSeconds: number;
  features: readonly string[];
  arrangement: readonly string[];
  mixNotes: readonly string[];
  /** Zero-based score bar and an interesting editable track. */
  highlightBar: number;
  trackId: string;
}>;

export type DemoDefinition = Readonly<{
  info: DemoInfo;
  build: () => TrackScore;
}>;

/** These songs all use a steady 4/4 meter; duration excludes effect tails. */
export function demoInfo(info: Omit<DemoInfo, "durationSeconds">): DemoInfo {
  return Object.freeze({
    ...info,
    durationSeconds: (info.bars * 240) / info.tempoBpm,
    features: Object.freeze([...info.features]),
    arrangement: Object.freeze([...info.arrangement]),
    mixNotes: Object.freeze([...info.mixNotes]),
  });
}
