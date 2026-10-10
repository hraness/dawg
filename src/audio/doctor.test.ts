import { describe, expect, test } from "bun:test";
import { fakeSink } from "../../test/fake-sink.ts";
import type { AudioBackendInfo } from "./engine.ts";
import { audioDoctor, formatAudioDoctor } from "./doctor.ts";

const native = (): AudioBackendInfo => ({
  backend: "native",
  streaming: true,
  native: fakeSink(),
  detail: "fake",
});
const env = { XDG_CONFIG_HOME: "/nowhere/config", DAWG_CONFIG_DIR: "/nowhere/dawg" };

describe("dawg doctor", () => {
  test("shows the saved output and input from the audio menu", () => {
    const report = audioDoctor(native(), {
      env,
      choice: { output: "USB Audio Interface", input: "USB Audio Interface" },
    });
    expect(report.chosen.output).toBe("USB Audio Interface");
    expect(report.chosen.missing).toBeUndefined();
    const lines = formatAudioDoctor(report).join("\n");
    expect(lines).toContain(
      "chosen: output USB Audio Interface · input USB Audio Interface",
    );
    expect(lines).toContain("audio out <name|default>");
  });

  test("defaults when nothing is saved", () => {
    const report = audioDoctor(native(), { env, choice: {} });
    expect(formatAudioDoctor(report).join("\n")).toContain(
      "chosen: output default · input default",
    );
  });

  test("a saved device that is gone says so", () => {
    const report = audioDoctor(native(), {
      env,
      choice: { output: "AirPods" },
    });
    expect(report.chosen.missing).toEqual(["output"]);
    expect(formatAudioDoctor(report).join("\n")).toContain(
      "output AirPods (missing, using default)",
    );
  });

  test("DAWG_AUDIO_DEVICE overrides the saved output", () => {
    const report = audioDoctor(native(), {
      env: { ...env, DAWG_AUDIO_DEVICE: "USB Audio Interface" },
      choice: { output: "MacBook Speakers" },
    });
    const lines = formatAudioDoctor(report).join("\n");
    expect(lines).toContain("chosen: output USB Audio Interface");
    expect(lines).toContain(
      "DAWG_AUDIO_DEVICE overrides the saved output (MacBook Speakers)",
    );
  });

  test("without the native sink the choice still shows, never missing", () => {
    const report = audioDoctor(
      { backend: "none", streaming: false, detail: "off" },
      { env, choice: { output: "AirPods" } },
    );
    expect(report.chosen.missing).toBeUndefined();
    expect(formatAudioDoctor(report).join("\n")).toContain(
      "chosen: output AirPods · input default",
    );
  });
});
