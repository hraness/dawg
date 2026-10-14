import { expect, test } from "bun:test";
import { OnsetSamples } from "./onsets.ts";
import {
  PcmEdgeDetector,
  parseSinkLog,
  type SinkMetadata,
} from "./sink-protocol.ts";
const metadata: SinkMetadata = {
  backend: "command",
  sink: "discard",
  sampleRate: 1000,
  channels: 2,
  format: "s16le",
  schedule: "first-chunk-anchored",
  deviceLatencyMeasured: false,
  threshold: 40,
  quietMs: 46,
};

test("onset rows expose missing and late observations instead of silently shrinking n", () => {
  const samples = new OnsetSamples();
  samples.record(100, { arrival: 104, scheduled: 164, frame: 0, on: true });
  samples.record(200, undefined);
  expect(samples.metric("bytes", "bytes", "bytes", metadata)).toMatchObject({
    n: 1,
    samples: { sent: 2, observed: 1, missing: 1, late: 0 },
    audio: metadata,
  });
  expect(samples.metric("synthetic", "synthetic", "synthetic")).toMatchObject({
    n: 1,
    samples: { sent: 2, observed: 1, missing: 1, late: 1 },
  });
  const empty = new OnsetSamples();
  empty.record(100, undefined);
  expect(
    JSON.parse(JSON.stringify(empty.metric("empty", "empty", "bytes"))),
  ).toMatchObject({
    n: 0,
    median: null,
    samples: { sent: 1, observed: 0, missing: 1 },
  });
});

test("the silent sink preserves stereo PCM and timestamps across odd chunk boundaries", () => {
  const pcm = Buffer.alloc(51 * 4);
  pcm.writeInt16LE(50, 2); // right-channel-only attack at frame 0
  pcm.writeInt16LE(60, 50 * 4); // after a long quiet gap
  const whole = new PcmEdgeDetector(metadata).write(pcm, 100);
  const detector = new PcmEdgeDetector(metadata);
  const split = [
    ...detector.write(pcm.subarray(0, 1), 100),
    ...detector.write(pcm.subarray(1, 7), 100),
    ...detector.write(pcm.subarray(7), 100),
  ];
  expect(split).toEqual(whole);
  expect(split).toEqual([
    { arrival: 100, scheduled: 100, frame: 0, on: true },
    { arrival: 100, scheduled: 147, frame: 47, on: false },
    { arrival: 100, scheduled: 150, frame: 50, on: true },
  ]);
  const log = `# ${JSON.stringify(metadata)}\n${split.map((e) => `${e.arrival} ${e.scheduled} ${Number(e.on)} ${e.frame}\n`).join("")}invalid\n`;
  expect(parseSinkLog(log)).toEqual({ metadata, edges: split });
});
