/**
 * `dawg doctor`: how dawg makes sound on this machine. The backend and why
 * it was chosen, the native sink's verification (or why it fell back), the
 * audio devices, the output and input saved from the audio menu, and the
 * play-mode lead.
 */
import {
  AudioEngine,
  detectAudioBackend,
  type AudioBackendInfo,
} from "./engine.ts";
import {
  audioChoicePath,
  matchDevice,
  readAudioChoice,
  type AudioChoice,
} from "./devices.ts";
import { PREBUILT_DIR, nativeTarget, type SinkDevice } from "./native.ts";
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
  /**
   * The audio menu's saved choice (`audio out`/`audio in`): a name, or
   * `default`; `missing` when the native sink lists devices and the saved
   * one is not among them (playback falls back to the default).
   */
  chosen: Readonly<{
    output: string;
    input: string;
    path: string;
    /** `DAWG_AUDIO_DEVICE` overrides the saved output. */
    override?: string;
    missing?: readonly ("output" | "input")[];
  }>;
}>;

export type DoctorOptions = Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
  choice?: AudioChoice;
}>;

export function audioDoctor(
  info = detectAudioBackend(),
  options: DoctorOptions = {},
): DoctorReport {
  const env = options.env ?? process.env;
  const path = audioChoicePath(env);
  const choice = options.choice ?? readAudioChoice(path);
  const engine = new AudioEngine({ info, worker: false, timer: false });
  const playLeadMs = engine.playLeadMs;
  void engine.dispose();
  const devices = (input: boolean): SinkDevice[] | undefined => {
    try {
      return info.native?.devices(input);
    } catch {
      return undefined;
    }
  };
  const outputDevices = devices(false);
  const inputDevices = devices(true);
  const list = (found: readonly SinkDevice[] | undefined) =>
    found?.map(
      (d) =>
        `${d.name}${d.default ? " (default)" : ""} · ${d.channels} ch · ${d.rate} Hz`,
    ) ?? [];
  const override = env.DAWG_AUDIO_DEVICE?.trim() || undefined;
  const missing: ("output" | "input")[] = [];
  const isMissing = (
    name: string | undefined,
    found: readonly SinkDevice[] | undefined,
  ) => !!name && !!found && found.length > 0 && !matchDevice(found, name);
  if (isMissing(override ?? choice.output, outputDevices))
    missing.push("output");
  if (isMissing(choice.input, inputDevices)) missing.push("input");
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
    outputs: list(outputDevices),
    inputs: list(inputDevices),
    chosen: {
      output: choice.output ?? "default",
      input: choice.input ?? "default",
      path,
      ...(override ? { override } : {}),
      ...(missing.length > 0 ? { missing } : {}),
    },
  };
}

/** `chosen: output AirPods · input default`, with what overrides or is gone. */
function chosenLines(chosen: DoctorReport["chosen"]): string[] {
  const missing = new Set(chosen.missing ?? []);
  const side = (label: "output" | "input", name: string) =>
    `${label} ${name}${missing.has(label) ? " (missing, using default)" : ""}`;
  const lines = [
    `chosen: ${side("output", chosen.override ?? chosen.output)} · ${side("input", chosen.input)} · ${chosen.path}`,
  ];
  if (chosen.override)
    lines.push(
      `  DAWG_AUDIO_DEVICE overrides the saved output (${chosen.output})`,
    );
  lines.push("  change it: audio out <name|default> · audio in <name|default>");
  return lines;
}

export function formatAudioDoctor(report: DoctorReport): string[] {
  const lines = [
    `audio: ${report.backend} · ${report.detail}`,
    report.native.loaded
      ? `native sink: loaded (${report.native.target})`
      : `native sink: not in use · ${report.native.reason ?? "another backend was forced"} · falls back to ffplay, sox or afplay`,
    `play lead: ${report.playLeadMs} ms · render rate ${DEFAULT_SAMPLE_RATE} Hz`,
    ...chosenLines(report.chosen),
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
      "usage: dawg doctor [--json]  audio backend, native sink, devices, saved choice\n",
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
