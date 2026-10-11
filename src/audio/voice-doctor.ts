/**
 * The "voice" section of `dawg doctor` (machine vox, lane V1): the
 * built-in formant voice, and espeak-ng when one is on the PATH. Detection
 * only (`which`, then `--version` with a 2 s timeout); nothing is
 * installed and espeak-ng is never used for rendering here.
 */
import { spawnSync } from "node:child_process";
import { VOX_DICT_SIZE } from "../../core/g2p.ts";

export type VoiceRow = Readonly<{
  name: string;
  ok: boolean;
  detail: string;
}>;

export type VoiceProbe = (
  command: string,
  args: readonly string[],
) => { status: number | null; stdout: string } | undefined;

const probe: VoiceProbe = (command, args) => {
  try {
    const run = spawnSync(command, args, {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { status: run.status, stdout: run.stdout ?? "" };
  } catch {
    return undefined;
  }
};

export function voiceDoctor(run: VoiceProbe = probe): VoiceRow[] {
  const rows: VoiceRow[] = [
    {
      name: "formant",
      ok: true,
      detail: `built-in · en rules + ${VOX_DICT_SIZE}-word dict · sing articulate > 0 (presets robot, speak)`,
    },
  ];
  const where = run("which", ["espeak-ng"]);
  const path = where?.status === 0 ? where.stdout.trim().split("\n")[0] : "";
  if (path) {
    const version = run(path, ["--version"]);
    const v = /(\d+\.\d+(?:\.\d+)?)/.exec(version?.stdout ?? "")?.[1];
    rows.push({
      name: "espeak-ng",
      ok: true,
      detail: `${v ?? "version unknown"} ${path} · detected, not used yet (GPL, separate process)`,
    });
  } else {
    rows.push({
      name: "espeak-ng",
      ok: false,
      detail: "not found (optional) · brew install espeak-ng",
    });
  }
  return rows;
}

export function formatVoiceDoctor(rows: readonly VoiceRow[]): string[] {
  return [
    "voice",
    ...rows.map(
      (row) => `  ${row.ok ? "✓" : "·"} ${row.name.padEnd(10)} ${row.detail}`,
    ),
  ];
}
