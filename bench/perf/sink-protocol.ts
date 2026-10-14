/** The external player's byte receipt and synthetic first-chunk clock, not a device clock. */
export type SinkMetadata = {
  backend: "command";
  sink: "discard";
  sampleRate: number;
  channels: 2;
  format: "s16le";
  schedule: "first-chunk-anchored";
  deviceLatencyMeasured: false;
  threshold: number;
  quietMs: number;
};
export type SinkEdge = {
  arrival: number;
  scheduled: number;
  frame: number;
  on: boolean;
};

export function parseSinkLog(raw: string): {
  metadata?: SinkMetadata;
  edges: SinkEdge[];
} {
  let metadata: SinkMetadata | undefined;
  const edges: SinkEdge[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("# ")) {
      try {
        metadata = JSON.parse(line.slice(2));
      } catch {
        /* partial log write */
      }
      continue;
    }
    const [arrival, scheduled, on, frame] = line
      .trim()
      .split(/\s+/)
      .map(Number);
    if (
      [arrival, scheduled, frame].every(Number.isFinite) &&
      (on === 0 || on === 1)
    )
      edges.push({
        arrival: arrival!,
        scheduled: scheduled!,
        frame: frame!,
        on: on === 1,
      });
  }
  return { metadata, edges };
}

/** Keep incomplete stereo frames across stdin chunks; either channel can start an edge. */
export class PcmEdgeDetector {
  private pending = Buffer.alloc(0);
  private frame = 0;
  private started?: number;
  private sounding = false;
  private quietFrames = 0;
  constructor(readonly metadata: SinkMetadata) {}
  write(chunk: Uint8Array, arrival: number): SinkEdge[] {
    if (chunk.length === 0) return [];
    this.started ??= arrival;
    const bytes = this.pending.length
      ? Buffer.concat([this.pending, chunk])
      : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const complete = bytes.length - (bytes.length % 4);
    const edges: SinkEdge[] = [];
    const quietLimit =
      (this.metadata.sampleRate * this.metadata.quietMs) / 1000;
    for (let i = 0; i < complete; i += 4, this.frame += 1) {
      const loud =
        Math.max(
          Math.abs(bytes.readInt16LE(i)),
          Math.abs(bytes.readInt16LE(i + 2)),
        ) > this.metadata.threshold;
      if (loud) this.quietFrames = 0;
      else this.quietFrames += 1;
      if (
        (!this.sounding && loud) ||
        (this.sounding && this.quietFrames > quietLimit)
      ) {
        this.sounding = loud;
        edges.push({
          arrival,
          scheduled:
            this.started + (this.frame * 1000) / this.metadata.sampleRate,
          frame: this.frame,
          on: loud,
        });
      }
    }
    this.pending = Buffer.from(bytes.subarray(complete));
    return edges;
  }
}
