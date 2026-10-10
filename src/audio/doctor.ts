/**
 * `dawg doctor`: how dawg makes sound on this machine. The backend and why
 * it was chosen, the native sink's verification (or why it fell back), the
 * audio devices, and the play-mode lead.
 */
import {
  AudioEngine,
  detectAudioBackend,
  type AudioBackendInfo,
} from "./engine.ts";
import { PREBUILT_DIR, nativeTarget } from "./native.ts";
import { DEFAULT_SAMPLE_RATE } from "./wav.ts";

export type DoctorReport = Readonly<{
  backend: AudioBackendInfo["backend"];
  detail: string;
  native: Readonly<{
    target: string | null;
    dir: string;
    loaded: boolean;
    reason?: string;
  }>;
  playLeadMs: number;
  outputs: readonly string[];
  inputs: readonly string[];
}>;

export function audioDoctor(info = detectAudioBackend()): DoctorReport {
  const engine = new AudioEngine({ info, worker: false, timer: false });
  const playLeadMs = engine.playLeadMs;
  void engine.dispose();
  const list = (input: boolean) =>
    info.native
      ?.devices(input)
      .map(
        (d) =>
          `${d.name}${d.default ? " (default)" : ""} · ${d.channels} ch · ${d.rate} Hz`,
      ) ?? [];
  return {
    backend: info.backend,
    detail: info.detail,
    native: {
      target: nativeTarget() ?? null,
      dir: PREBUILT_DIR,
      loaded: info.backend === "native",
      ...(info.nativeUnavailable ? { reason: info.nativeUnavailable } : {}),
    },
    playLeadMs,
    outputs: list(false),
    inputs: list(true),
  };
}

export function formatAudioDoctor(report: DoctorReport): string[] {
  const lines = [
    `audio: ${report.backend} · ${report.detail}`,
    report.native.loaded
      ? `native sink: loaded (${report.native.target})`
      : `native sink: not in use · ${report.native.reason ?? "another backend was forced"} · falls back to ffplay, sox or afplay`,
    `play lead: ${report.playLeadMs} ms · render rate ${DEFAULT_SAMPLE_RATE} Hz`,
  ];
  if (report.outputs.length > 0)
    lines.push("outputs:", ...report.outputs.map((d) => `  ${d}`));
  if (report.inputs.length > 0)
    lines.push("inputs:", ...report.inputs.map((d) => `  ${d}`));
  return lines;
}

export async function runDoctorCommand(
  args: readonly string[],
  stdout: { write(text: string): unknown },
): Promise<number> {
  if (args.some((arg) => arg === "--help" || arg === "-h")) {
    stdout.write(
      "usage: dawg doctor [--json]  audio backend, native sink, devices\n",
    );
    return 0;
  }
  const report = audioDoctor();
  stdout.write(
    args.includes("--json")
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${formatAudioDoctor(report).join("\n")}\n`,
  );
  return 0;
}
