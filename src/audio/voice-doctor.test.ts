import { describe, expect, test } from "bun:test";
import { VOX_DICT_SIZE } from "../../core/g2p.ts";
import { formatVoiceDoctor, voiceDoctor } from "./voice-doctor.ts";

describe("dawg doctor voice section", () => {
  test("the built-in formant voice is always there; no espeak-ng is fine", () => {
    const rows = voiceDoctor(() => ({ status: 1, stdout: "" }));
    const text = formatVoiceDoctor(rows).join("\n");
    expect(text).toContain("voice\n  ✓ formant");
    expect(text).toContain(`en rules + ${VOX_DICT_SIZE}-word dict`);
    expect(text).toContain("· espeak-ng  not found (optional)");
  });

  test("a found espeak-ng shows its version and path, never runs otherwise", () => {
    const calls: string[] = [];
    const rows = voiceDoctor((command, args) => {
      calls.push([command, ...args].join(" "));
      return command === "which"
        ? { status: 0, stdout: "/opt/homebrew/bin/espeak-ng\n" }
        : {
            status: 0,
            stdout: "eSpeak NG text-to-speech: 1.52.0  Data at: x\n",
          };
    });
    expect(rows[1]).toEqual({
      name: "espeak-ng",
      ok: true,
      detail:
        "1.52.0 /opt/homebrew/bin/espeak-ng · detected, not used yet (GPL, separate process)",
    });
    expect(calls).toEqual([
      "which espeak-ng",
      "/opt/homebrew/bin/espeak-ng --version",
    ]);
  });

  test("a probe that throws or times out degrades to not found", () => {
    expect(voiceDoctor(() => undefined)[1]!.ok).toBe(false);
  });
});
