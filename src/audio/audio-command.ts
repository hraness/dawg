/**
 * `audio`, `audio out <name|default>`, `audio in <name|default>` and
 * `audio test`: the typed form of Ctrl-K › Project › audio. One output and
 * one input; the choice lives in `<config>/audio.json` on this machine.
 */
import type { AudioBackendInfo } from "./engine.ts";
import {
  audioChoicePath,
  blipSamples,
  deviceLabel,
  deviceSupport,
  levelMeter,
  listDevices,
  matchDevice,
  measureInput,
  parseAudioCommand,
  playOnce,
  readAudioChoice,
  writeAudioChoice,
  type AudioChoice,
} from "./devices.ts";
import type { MenuAudioDevices } from "../tui/menu.ts";

export const AUDIO_USAGE =
  "usage · audio · audio out <name|default> · audio in <name|default> · audio test";

export type AudioCommandContext = Readonly<{
  info: AudioBackendInfo;
  env?: Readonly<Record<string, string | undefined>>;
  /** Where the choice is saved (default `<config>/audio.json`). */
  path?: string;
  /** Move this window's playback (the engine's `setDevice`). */
  setOutput?: (name: string | undefined) => void;
  /** Injected by tests: no real waiting for the blip, tone and meter. */
  wait?: (ms: number) => Promise<void>;
  /** Run the blip without blocking the reply (the default awaits it). */
  background?: (task: Promise<unknown>) => void;
}>;

export type AudioCommandResult = Readonly<{
  ok: boolean;
  message: string;
  /** Extra lines for a panel (the device lists, the test result). */
  lines?: readonly string[];
}>;

function names(devices: readonly { name: string }[]): string {
  return devices.length > 0
    ? devices.map((device) => device.name).join(" · ")
    : "none found";
}

/** What Project › audio shows. */
export function audioMenuState(
  info: AudioBackendInfo,
  choice: AudioChoice = readAudioChoice(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): MenuAudioDevices {
  const support = deviceSupport(info);
  if (support.kind !== "native") {
    const output =
      support.kind === "sox"
        ? ((env.DAWG_AUDIO_DEVICE?.trim() || choice.output) ?? "default")
        : "default";
    return {
      output,
      input: "default",
      outputs: [],
      inputs: [],
      unavailable:
        support.kind === "sox"
          ? "sox cannot list devices · type audio out <name> (sox AUDIODEV) · the native sink lists them"
          : support.reason,
    };
  }
  const outputs = listDevices(support.library, false);
  const inputs = listDevices(support.library, true);
  const override = env.DAWG_AUDIO_DEVICE?.trim();
  return {
    output: deviceLabel(override || choice.output, outputs),
    input: deviceLabel(choice.input, inputs),
    outputs: outputs.map((device) => device.name),
    inputs: inputs.map((device) => device.name),
  };
}

export async function runAudioCommand(
  args: string,
  context: AudioCommandContext,
): Promise<AudioCommandResult> {
  const parsed = parseAudioCommand(args);
  if (!parsed) return { ok: false, message: AUDIO_USAGE };
  const env = context.env ?? process.env;
  const path = context.path ?? audioChoicePath(env);
  const choice = readAudioChoice(path);
  const support = deviceSupport(context.info);
  const override = env.DAWG_AUDIO_DEVICE?.trim() || undefined;
  const overrideNote = override
    ? ` · DAWG_AUDIO_DEVICE=${override} overrides the output`
    : "";

  if (parsed.kind === "show") {
    const state = audioMenuState(context.info, choice, env);
    const lines = [
      `output  ${state.output}`,
      `input   ${state.input}`,
      `player  ${context.info.backend}`,
    ];
    if (state.unavailable) lines.push(state.unavailable);
    else {
      lines.push(`outputs ${state.outputs.join(" · ") || "none found"}`);
      lines.push(`inputs  ${state.inputs.join(" · ") || "none found"}`);
    }
    return {
      ok: true,
      message: `audio · out ${state.output} · in ${state.input}${overrideNote}`,
      lines,
    };
  }

  if (support.kind === "none") return { ok: false, message: support.reason };

  if (parsed.kind === "set" && parsed.side === "output") {
    if (support.kind === "sox") {
      writeAudioChoice("output", parsed.name, path);
      context.setOutput?.(override ?? parsed.name);
      return {
        ok: true,
        message: `audio out ${parsed.name ?? "default"} · sox plays on AUDIODEV (it cannot list devices; the native sink can)${overrideNote}`,
      };
    }
    const devices = listDevices(support.library, false);
    const device = parsed.name ? matchDevice(devices, parsed.name) : undefined;
    if (parsed.name && !device)
      return {
        ok: false,
        message: `no output named "${parsed.name}" · ${names(devices)}`,
      };
    writeAudioChoice("output", device?.name, path);
    const playing = override ?? device?.name;
    context.setOutput?.(playing);
    // The soft blip says where sound now comes out.
    const blip = playOnce(
      support.library,
      playing,
      blipSamples(48_000),
      48_000,
      context.wait,
    ).catch(() => false);
    if (context.background) context.background(blip);
    else await blip;
    return {
      ok: true,
      message: `audio out ${deviceLabel(device?.name, devices)}${overrideNote}`,
    };
  }

  if (parsed.kind === "set") {
    if (support.kind === "sox")
      return {
        ok: false,
        message:
          "choosing an input needs the native sink (it captures by name; sox here only plays)",
      };
    const devices = listDevices(support.library, true);
    const device = parsed.name ? matchDevice(devices, parsed.name) : undefined;
    if (parsed.name && !device)
      return {
        ok: false,
        message: `no input named "${parsed.name}" · ${names(devices)}`,
      };
    writeAudioChoice("input", device?.name, path);
    return {
      ok: true,
      message: `audio in ${deviceLabel(device?.name, devices)} · audio test meters it`,
    };
  }

  // audio test: a short tone on the output, then the input's level.
  if (support.kind === "sox")
    return {
      ok: false,
      message:
        "audio test needs the native sink (it plays the tone and meters the input)",
    };
  const output = override ?? choice.output;
  const outputs = listDevices(support.library, false);
  const inputs = listDevices(support.library, true);
  const played = await playOnce(
    support.library,
    output,
    blipSamples(48_000, 0.4, 440, 0.15),
    48_000,
    context.wait,
  ).catch(() => false);
  let meter: string;
  try {
    const level = await measureInput(
      support.library,
      choice.input,
      1,
      48_000,
      context.wait,
    );
    meter = levelMeter(level.peakDb);
  } catch (error) {
    meter = `could not open (${error instanceof Error ? error.message : String(error)})`;
  }
  const lines = [
    `output  ${deviceLabel(output, outputs)} · ${played ? "tone played" : "could not open"}`,
    `input   ${deviceLabel(choice.input, inputs)} · peak ${meter}`,
  ];
  return {
    ok: played,
    message: `audio test · ${lines[0]!.replace(/\s+/, " ")} · ${lines[1]!.replace(/\s+/, " ")}`,
    lines,
  };
}
