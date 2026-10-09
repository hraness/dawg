/**
 * `dawg render <out.wav>` (or `<out.mid>`): renders a session, the project files (`song.ts`,
 * in a project with no `--session`), or a `track.loop/v1` file to
 * a stereo 16-bit PCM WAV through the same deterministic renderer playback
 * uses, so two renders of one score are byte-identical. It reads the session
 * record from disk and never starts dawgd or plays audio.
 */
import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  scoreFromJSON,
  ScoreValidationError,
  withNoteCap,
  type TrackScore,
} from "../core/score.ts";
import { decodeLoop } from "../core/loop.ts";
import { scoreToMidi } from "../core/midi.ts";
import { RENDER_CHANNELS, encodeWav, withWavCues } from "./audio/wav.ts";
import { exportSampleRate, measureRendered } from "./audio/measure.ts";
import {
  applyMasterCommand,
  loudnessLine,
  measurementLine,
  parseMasterCommand,
} from "./commands/master.ts";
import {
  BAKED_NOTE_CAP,
  bakeTrackTime,
  findSection,
  sectionScore,
} from "../core/sections.ts";
import {
  exportScore,
  renderArrangedPcm,
  sectionCues,
} from "./audio/arrange.ts";
import { SampleLibrary, hasSamplerTracks } from "./audio/samples.ts";
import { withClipLengths } from "./audio/clips.ts";
import {
  PackStore,
  creditsLine,
  packCredits,
  withWavComment,
  writeCredits,
} from "./audio/packs.ts";
import { evaluateProject, formatDiagnostic } from "../core/sdk/eval.ts";
import { isProject } from "./project/init.ts";
import { resolveSessionArg } from "./session/attach.ts";
import {
  loadSession,
  readCurrentSessionId,
  sessionPaths,
} from "./session/store.ts";

export const RENDER_USAGE =
  "usage: dawg render <out.wav> [--session <name|id>] [--import <file.track.json>] [--section <name>] [--normalize <lufs|streaming|club|loud|…>] [--measure] [--rate <hz>] · <out.mid> writes MIDI";

const MAX_LOOP_FILE_BYTES = 512 * 1024;

type Output = { write(text: string): unknown };

export async function runRenderCommand(
  argv: readonly string[],
  workspace: string,
  stdout: Output,
  stderr: Output,
): Promise<number> {
  const rest = argv.slice(1);
  if (rest.includes("--help") || rest.includes("-h")) {
    stdout.write(`${RENDER_USAGE}\n`);
    return 0;
  }
  const options = new Map<string, string>();
  const positional: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (arg === "--measure") options.set(arg, "");
    else if (
      arg === "--session" ||
      arg === "--import" ||
      arg === "--normalize" ||
      arg === "--rate" ||
      arg === "--section"
    ) {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) {
        stderr.write(`${arg} needs a value · ${RENDER_USAGE}\n`);
        return 2;
      }
      options.set(arg, value);
      index += 1;
    } else if (arg.startsWith("--")) {
      stderr.write(`unknown option · ${arg} · ${RENDER_USAGE}\n`);
      return 2;
    } else positional.push(arg);
  }
  const target = positional[0];
  if (positional.length !== 1 || !target || !/\.(wav|midi?)$/i.test(target)) {
    stderr.write(`${RENDER_USAGE}\n`);
    return 2;
  }
  let score: TrackScore;
  try {
    score = await loadScore(workspace, options);
  } catch (error) {
    stderr.write(
      `render failed · ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
  const only = options.get("--section");
  if (only !== undefined) {
    const section = findSection(score, only);
    if (!section) {
      const names = score.sections.map((entry) => entry.name).join(", ");
      stderr.write(
        `render failed · no section "${only}"${names ? ` · sections: ${names}` : ""}\n`,
      );
      return 1;
    }
    // Clips crossing the section's edges are cut against their files' real
    // ends, so read their lengths first (load problems are reported below).
    if (score.tracks.some((track) => track.clips)) {
      const bank = await new SampleLibrary({ projectRoot: workspace }).load(
        score,
      );
      score = withClipLengths(score, bank);
    }
    // One section as it plays when looped: its mutes and variations, no form.
    score = withNoteCap(BAKED_NOTE_CAP, () =>
      sectionScore(bakeTrackTime(score), section),
    );
  }
  if (/\.midi?$/i.test(target)) {
    // MIDI carries notes, not audio: the master and loudness flags do not apply.
    const audioOnly = ["--normalize", "--measure", "--rate"].find((flag) =>
      options.has(flag),
    );
    if (audioOnly) {
      stderr.write(`render failed · ${audioOnly} applies to .wav only\n`);
      return 2;
    }
    const midi = scoreToMidi(exportScore(score));
    const midiPath = resolve(workspace, target);
    const midiTemporary = `${midiPath}.${process.pid}.tmp`;
    await writeFile(midiTemporary, midi);
    await rename(midiTemporary, midiPath);
    const midiSha = createHash("sha256").update(midi).digest("hex");
    stdout.write(
      `rendered · ${target} · ${midi.byteLength} bytes · ${midiSha}\n`,
    );
    return 0;
  }
  // `--normalize` is the song master's loudness target for this export only:
  // a named target also brings the limiter in at that target's ceiling.
  const normalize = options.get("--normalize");
  if (normalize !== undefined) {
    const command = parseMasterCommand(`master target ${normalize}`);
    const result = command && applyMasterCommand(score, command);
    if (!result?.ok) {
      stderr.write(
        `render failed · --normalize takes LUFS (-40 to -3) or a target name · ${RENDER_USAGE}\n`,
      );
      return 2;
    }
    score = result.next ?? score;
    const flipped =
      command?.type === "master-target" ? command.flipped : undefined;
    if (flipped !== undefined)
      stderr.write(
        `render · --normalize ${normalize} read as ${-flipped} LUFS\n`,
      );
  }
  let samples;
  if (hasSamplerTracks(score)) {
    samples = await new SampleLibrary({ projectRoot: workspace }).load(score);
    for (const problem of samples.problems)
      stderr.write(`sample ${problem.level} · ${problem.message}\n`);
    // A voice that cannot load (a missing file, a pin that no longer
    // matches) would render as silence: fail rather than write a song with
    // a part missing.
    const failed = samples.problems.filter((p) => p.level === "error").length;
    if (failed > 0) {
      stderr.write(
        `render failed · ${failed} sample ${failed === 1 ? "voice" : "voices"} could not load · fix or re-pick ${failed === 1 ? "it" : "them"} and render again\n`,
      );
      return 1;
    }
  }
  // A song with a master is a deliverable: 48 kHz unless --rate says
  // otherwise; a plain song keeps the engine's rate, as dawg 0.4 wrote it.
  const rateArg = options.get("--rate");
  const sampleRate =
    rateArg === undefined ? exportSampleRate(score) : Number(rateArg);
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate < 8_000 ||
    sampleRate > 48_000
  ) {
    stderr.write(
      `render failed · --rate takes 8000 to 48000 Hz · ${RENDER_USAGE}\n`,
    );
    return 2;
  }
  let audio;
  try {
    audio = renderArrangedPcm(score, { samples, sampleRate });
  } catch (error) {
    if (!(error instanceof ScoreValidationError)) throw error;
    stderr.write(`render failed · ${error.message}\n`);
    return 1;
  }
  let wav = encodeWav(audio.pcm, audio.sampleRate, RENDER_CHANNELS);
  // Section starts as cue points (a --section render is one section).
  if (only === undefined)
    wav = withWavCues(wav, sectionCues(score, audio.sampleRate));
  // Pack sounds: name the packs (and CC-BY attributions) in the WAV's INFO
  // comment and on stdout; CREDITS.md in a project keeps the attributions.
  const refs = score.tracks.flatMap((track) =>
    Object.values(track.sampler?.voices ?? {}),
  );
  let credits: string | undefined;
  if (refs.some((ref) => ref.src.startsWith("pack:"))) {
    const list = packCredits(refs, await new PackStore().list());
    credits = creditsLine(list);
    if (credits) wav = withWavComment(wav, `samples: ${credits}`);
    if (await isProject(workspace).catch(() => false))
      await writeCredits(workspace, list).catch(() => undefined);
  }
  const path = resolve(workspace, target);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, wav);
  await rename(temporary, path);
  const sha = createHash("sha256").update(wav).digest("hex");
  const seconds = audio.frames / audio.sampleRate;
  stdout.write(
    `rendered · ${target} · ${seconds.toFixed(2)} s · ${wav.byteLength} bytes · ${sha}\n`,
  );
  if (credits) stdout.write(`credits · ${credits}\n`);
  const clipped = clippedSamples(audio.pcm);
  if (clipped > 0)
    stderr.write(
      `warning · ${clipped} ${clipped === 1 ? "sample clips" : "samples clip"} at full scale · ${
        audio.master
          ? "add master limiter or lower the master gain"
          : "lower track volumes or add a master with a limiter (master streaming, or master: { limiter: {} } in song.ts)"
      }\n`,
    );
  if (options.has("--measure"))
    stdout.write(
      `loudness · ${measurementLine(measureRendered(audio, false).mix, audio.master)}\n`,
    );
  else if (audio.master)
    stdout.write(`loudness · ${loudnessLine(audio.master)}\n`);
  return 0;
}

/** Samples at or past 16-bit full scale: the mix bus hit the rails. */
export function clippedSamples(pcm: Int16Array): number {
  let count = 0;
  for (const value of pcm) if (value >= 32_767 || value <= -32_768) count += 1;
  return count;
}

async function loadScore(
  workspace: string,
  options: ReadonlyMap<string, string>,
): Promise<TrackScore> {
  const importPath = options.get("--import");
  if (importPath !== undefined) {
    const contents = await readFile(resolve(workspace, importPath));
    if (contents.byteLength > MAX_LOOP_FILE_BYTES)
      throw new Error("loop import exceeds 512 KiB");
    return decodeLoop(contents.toString("utf8"));
  }
  const query = options.get("--session");
  if (query === undefined && (await isProject(workspace))) {
    const evaluated = await evaluateProject(workspace);
    if (!evaluated.ok)
      throw new Error(
        `${evaluated.diagnostics.map(formatDiagnostic).join("; ").slice(0, 400)} · fix song.ts and retry (dawg check)`,
      );
    return evaluated.score;
  }
  const sessionId =
    query === undefined
      ? await readCurrentSessionId(workspace)
      : await resolveSessionArg(workspace, query);
  if (sessionId === undefined)
    throw new Error("no session here · run dawg first or pass --import");
  const record = await loadSession<unknown>(
    sessionPaths(workspace, sessionId),
  ).catch(() => {
    throw new Error(`no session named "${query ?? sessionId}" · dawg sessions`);
  });
  return scoreFromJSON(record.composition);
}
