/**
 * Brief in, song out: ask a model for a sheet, validate it, critique it and
 * send the notes back until it passes (or the rounds run out), then render
 * the best sheet. The model is injected, so core stays free of transports.
 */
import type { TrackScore } from "../../score.ts";
import { compileSheet } from "./compile.ts";
import { critique } from "./critic.ts";
import { messages, type ChatMessage } from "./prompt.ts";
import { sheetSchema } from "./schema.ts";
import { settleSheet, validateSheet, type SongSheet } from "./sheet.ts";

/** One completion: the chat in, the reply text out (JSON, schema-constrained when the model can). */
export type SheetModel = (
  chat: readonly ChatMessage[],
  schema: Record<string, unknown>,
) => Promise<string>;

export type Round = Readonly<{
  round: number;
  ok: boolean;
  score: number;
  notes: readonly string[];
  ms: number;
}>;

export type Generated = Readonly<{
  sheet: SongSheet;
  score: TrackScore;
  critic: number;
  notes: readonly string[];
  rounds: readonly Round[];
}>;

export type GenerateOptions = Readonly<{
  /** Rounds in all, the first included (default 3). */
  rounds?: number;
  /** The critic score that ends the loop early (default 90). */
  pass?: number;
  /** The most on-beat semitone clashes a passing sheet may have (default 0.1). */
  maxRubs?: number;
  onRound?: (round: Round) => void;
}>;

/** The JSON object in a reply (models sometimes wrap it in a fence). */
export function parseReply(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start)
    throw new Error("the reply has no JSON object");
  return JSON.parse(text.slice(start, end + 1));
}

export async function generateSong(
  brief: string,
  model: SheetModel,
  options: GenerateOptions = {},
): Promise<Generated> {
  const rounds = Math.max(1, options.rounds ?? 3);
  const pass = options.pass ?? 90;
  const maxRubs = options.maxRubs ?? 0.1;
  const schema = sheetSchema();
  const log: Round[] = [];
  let best:
    { sheet: SongSheet; critic: number; notes: readonly string[] } | undefined;
  let retry: { sheet: string; notes: readonly string[] } | undefined;
  for (let round = 1; round <= rounds; round++) {
    const started = Date.now();
    const reply = await model(messages(brief, retry), schema);
    let raw: unknown;
    let notes: readonly string[];
    let score = 0;
    let ok = false;
    let clean = false;
    try {
      raw = parseReply(reply);
      const checked = validateSheet(raw);
      if (checked.ok) {
        ok = true;
        // Settle clashes here so the retries spend themselves on rhythm and shape.
        const sheet = settleSheet(checked.sheet);
        const review = critique(sheet);
        // Every repair the validator made costs a little, so retries fix them.
        score = Math.max(0, review.score - 2 * checked.warnings.length);
        clean = review.rubs <= maxRubs;
        notes = [...review.notes, ...checked.warnings];
        if (!best || score > best.critic)
          best = { sheet, critic: score, notes };
      } else notes = checked.errors;
    } catch (error) {
      notes = [
        `the reply was not a JSON sheet (${(error as Error).message}); reply with JSON only`,
      ];
    }
    const entry = { round, ok, score, notes, ms: Date.now() - started };
    log.push(entry);
    options.onRound?.(entry);
    // A sheet passes on its score and only with few clashes: the compiler
    // moves a clashing note, so a clashing sheet sounds unlike its plan.
    if (ok && score >= pass && clean) break;
    retry = { sheet: reply.slice(0, 24_000), notes: notes.slice(0, 12) };
  }
  if (!best)
    throw new Error(
      `no valid sheet after ${rounds} rounds: ${log.at(-1)?.notes.slice(0, 4).join("; ")}`,
    );
  return {
    sheet: best.sheet,
    score: compileSheet(best.sheet),
    critic: best.critic,
    notes: best.notes,
    rounds: log,
  };
}
