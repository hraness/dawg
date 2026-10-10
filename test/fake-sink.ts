/**
 * A fake native sink (`SinkLibrary`) with named devices: enumeration,
 * open-by-name, writes recorded per device, and unplugging (the device
 * leaves the list and its open endpoints report `failed`). Shared by the
 * unit tests and the PTY preload (test/fake-sink-preload.ts).
 */
import type {
  OpenRequest,
  SinkDevice,
  SinkEndpoint,
  SinkLibrary,
  SinkStats,
} from "../src/audio/native.ts";
import { SINK_ABI_VERSION } from "../src/audio/native.ts";

export type FakeSink = SinkLibrary & {
  outputs: SinkDevice[];
  inputs: SinkDevice[];
  /** Device name of every output opened, in order ("default" resolved). */
  opened: string[];
  /** Samples written per resolved output name. */
  written: Map<string, number>;
  /** Unplug a device: gone from the lists, its endpoints fail. */
  unplug(name: string): void;
  /** Endpoints still open. */
  live(): number;
};

function device(name: string, isDefault = false, channels = 2): SinkDevice {
  return { name, default: isDefault, channels, rate: 48_000 };
}

export function fakeSink(
  options: {
    outputs?: string[];
    inputs?: string[];
    /** Input level the fake captures (a constant, 0…1). */
    level?: number;
  } = {},
): FakeSink {
  const outputs = (
    options.outputs ?? ["Built-in Output", "USB Audio Interface"]
  ).map((name, index) => device(name, index === 0));
  const inputs = (
    options.inputs ?? ["Built-in Microphone", "USB Audio Interface"]
  ).map((name, index) => device(name, index === 0, 1));
  const endpoints = new Set<{ name: string; failed: boolean }>();
  const opened: string[] = [];
  const written = new Map<string, number>();
  let error = "";
  const level = options.level ?? 0.25;

  const open = (
    list: SinkDevice[],
    request: OpenRequest,
    input: boolean,
  ): SinkEndpoint | undefined => {
    const wanted = request.device;
    const found =
      !wanted || wanted === "default"
        ? list.find((entry) => entry.default)
        : list.find((entry) => entry.name === wanted);
    if (!found) {
      error = `no ${input ? "input" : "output"} device named ${wanted}`;
      return undefined;
    }
    const state = { name: found.name, failed: false };
    endpoints.add(state);
    if (!input) opened.push(found.name);
    let frames = 0;
    // Input: a second of signal waits to be read; output starts empty.
    let queued = input ? request.rate * request.channels : 0;
    const stats = (): SinkStats => ({
      queued,
      frames,
      xruns: 0,
      latencyNs: 3_000_000,
      callbackNs: 0,
      edgeNs: 0,
      framesAtEdge: frames,
      bufferFrames: 128,
      rate: request.rate,
      channels: request.channels,
      deviceRate: 48_000,
      failed: state.failed,
    });
    return {
      write: (samples) => {
        if (state.failed) return 0;
        written.set(
          found.name,
          (written.get(found.name) ?? 0) + samples.length,
        );
        frames += samples.length / request.channels;
        return samples.length;
      },
      read: (out) => {
        if (state.failed || queued <= 0) return 0;
        const count = Math.min(out.length, queued);
        out.fill(level, 0, count);
        queued -= count;
        return count;
      },
      stats,
      clear: () => 0,
      close: () => {
        endpoints.delete(state);
      },
    };
  };

  return {
    abiVersion: SINK_ABI_VERSION,
    outputs,
    inputs,
    opened,
    written,
    clockNs: () => Math.round(performance.now() * 1e6),
    lastError: () => error,
    devices: (input) => [...(input ? inputs : outputs)],
    openOutput: (request) => open(outputs, request, false),
    openInput: (request) => open(inputs, request, true),
    unplug: (name) => {
      for (const list of [outputs, inputs]) {
        const index = list.findIndex((entry) => entry.name === name);
        if (index >= 0) list.splice(index, 1);
      }
      for (const endpoint of endpoints)
        if (endpoint.name === name) endpoint.failed = true;
    },
    live: () => endpoints.size,
  };
}
