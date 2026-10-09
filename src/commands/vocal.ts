/**
 * `/vocal` (0.7): the umbrella over every voice verb. Each lane appends its
 * verbs to its own commented block in `VOCAL_VERBS`; bare `/vocal` lists
 * them and `/help` prints a Voice section from the same table, so a verb is
 * documented and typo-matched the moment it is registered.
 */
import type { TrackScore } from "../../core/score.ts";

/** What a verb sees: the score, the focused track and the project folder. */
export type VocalContext = Readonly<{
  score: TrackScore;
  trackId: string;
  cwd: string;
}>;

/** A verb's outcome. `next` and `kind` commit a score change. */
export type VocalResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  /** History kind for the commit, e.g. `clip.place`. */
  kind?: string;
  payload?: Readonly<Record<string, unknown>>;
}>;

export type VocalVerb = Readonly<{
  /** The word after `/vocal`, e.g. `import`. */
  verb: string;
  /** Full usage after `/vocal`, e.g. `import <file> [at <beat>]`. */
  usage: string;
  /** What it does, short enough for one help row. */
  summary: string;
  /** The 0.7 lane that owns it. */
  lane: string;
  run: (args: string, context: VocalContext) => Promise<VocalResult>;
}>;

/** Every `/vocal` verb, one block per lane in signal order. */
export const VOCAL_VERBS: readonly VocalVerb[] = [
  // clips: import, stem, setups
  // pitch: pitch, notes
  // autotune: autotune
  // formant: formant
  // vocoder: vocoder
  // 0.7.1: record, take, comp (record), say (say), harmony (harmony),
  // chop (chops)
];

export type VocalCommand =
  | Readonly<{ kind: "list" }>
  | Readonly<{ kind: "verb"; verb: VocalVerb; args: string }>
  | Readonly<{ kind: "unknown"; word: string }>;

/** Parse `/vocal [<verb> [args]]` (the slash is optional). */
export function parseVocalCommand(
  command: string,
  verbs: readonly VocalVerb[] = VOCAL_VERBS,
): VocalCommand | undefined {
  const match = command.trim().match(/^\/?vocal(?:\s+(\S+)(?:\s+(.*))?)?$/i);
  if (!match) return undefined;
  const word = match[1]?.toLowerCase();
  if (word === undefined || word === "help" || word === "list")
    return { kind: "list" };
  const verb = verbs.find((candidate) => candidate.verb === word);
  if (!verb) return { kind: "unknown", word };
  return { kind: "verb", verb, args: (match[2] ?? "").trim() };
}

/** The lines bare `/vocal` prints. */
export function vocalListLines(
  verbs: readonly VocalVerb[] = VOCAL_VERBS,
): string[] {
  if (verbs.length === 0) return ["vocal: no voice tools yet in this build"];
  const width = Math.max(...verbs.map((verb) => verb.usage.length));
  return [
    "vocal <verb>:",
    ...verbs.map(
      (verb) => `  /vocal ${verb.usage.padEnd(width)}  ${verb.summary}`,
    ),
  ];
}

/** Run a parsed `/vocal` command. Never throws: failures come back as text. */
export async function runVocalCommand(
  command: VocalCommand,
  context: VocalContext,
  verbs: readonly VocalVerb[] = VOCAL_VERBS,
): Promise<VocalResult> {
  if (command.kind === "list")
    return { ok: true, message: vocalListLines(verbs).join("\n") };
  if (command.kind === "unknown") {
    const known = verbs.map((verb) => verb.verb);
    return {
      ok: false,
      message: known.length
        ? `vocal: unknown verb ${command.word} · try ${known.join(", ")}`
        : `vocal: unknown verb ${command.word} · no voice tools yet in this build`,
    };
  }
  try {
    return await command.verb.run(command.args, context);
  } catch (error) {
    return {
      ok: false,
      message: `vocal ${command.verb.verb}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
