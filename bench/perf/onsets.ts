import { metric, type Metric } from "./stats.ts";
import type { SinkEdge, SinkMetadata } from "./sink-protocol.ts";

export const ONSET_TIMEOUT_MS = 4000;
export const ONSET_LATE_MS = 20;

/** Missing edges remain visible in every result, including instruments with no detected attacks. */
export class OnsetSamples {
  private sent = 0;
  private readonly arrivals: number[] = [];
  private readonly schedules: number[] = [];
  record(sentAt: number, edge: SinkEdge | undefined): void {
    this.sent += 1;
    if (!edge) return;
    this.arrivals.push(edge.arrival - sentAt);
    this.schedules.push(edge.scheduled - sentAt);
  }
  metric(
    id: string,
    name: string,
    boundary: "bytes" | "synthetic",
    metadata?: SinkMetadata,
  ): Metric {
    const values = boundary === "bytes" ? this.arrivals : this.schedules;
    return {
      ...metric(id, name, values),
      samples: {
        sent: this.sent,
        observed: values.length,
        missing: this.sent - values.length,
        late: values.filter((ms) => ms > ONSET_LATE_MS).length,
        lateAfterMs: ONSET_LATE_MS,
        timeoutMs: ONSET_TIMEOUT_MS,
      },
      ...(metadata ? { audio: metadata } : {}),
    };
  }
}
