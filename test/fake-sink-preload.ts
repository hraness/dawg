/**
 * PTY preload: the process's native sink is a fake with named devices, so
 * the audio menu lists, switches and blips without hardware. Each output
 * opened is appended to `$DAWG_FAKE_SINK_LOG`.
 */
import { appendFileSync } from "node:fs";
import { setNativeProbe } from "../src/audio/engine.ts";
import { fakeSink } from "./fake-sink.ts";

const sink = fakeSink();
const log = process.env.DAWG_FAKE_SINK_LOG;
const openOutput = sink.openOutput;
sink.openOutput = (request) => {
  const endpoint = openOutput(request);
  if (log && endpoint) appendFileSync(log, `${sink.opened.at(-1)}\n`);
  return endpoint;
};
setNativeProbe({ ok: true, library: sink, path: "fake", detail: "fake" });
