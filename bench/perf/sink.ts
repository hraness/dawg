/** Silent external PCM player for PTY benchmarks. Logs bytes and a synthetic clock, never a device onset. */
import { appendFileSync, writeFileSync } from "node:fs";
import { PcmEdgeDetector, type SinkMetadata } from "./sink-protocol.ts";

const log = process.argv[2];
if (!log) process.exit(2);
const metadata: SinkMetadata = {
  backend: "command",
  sink: "discard",
  sampleRate: Number(process.argv[3] ?? 44100),
  channels: 2,
  format: "s16le",
  schedule: "first-chunk-anchored",
  deviceLatencyMeasured: false,
  threshold: 16,
  quietMs: 46,
};
writeFileSync(log, `# ${JSON.stringify(metadata)}\n`);
const detector = new PcmEdgeDetector(metadata);
const epoch = () => performance.timeOrigin + performance.now();
for await (const chunk of Bun.stdin.stream()) {
  const edges = detector.write(chunk, epoch());
  if (edges.length)
    appendFileSync(
      log,
      edges
        .map(
          (edge) =>
            `${edge.arrival} ${edge.scheduled} ${Number(edge.on)} ${edge.frame}\n`,
        )
        .join(""),
    );
}
