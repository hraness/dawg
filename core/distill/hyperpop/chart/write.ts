/**
 * A large model writes a chart from a brief: the chart format's own source
 * as the spec, the sound palette, the demos' craft as rules and the gold
 * charts as examples. Each draft is checked, performed and judged; whatever
 * is wrong goes back as the next turn, and the best draft wins. Token usage
 * is summed over the rounds so every song carries its cost.
 */
import { readFileSync } from "node:fs";
import house from "../../../../workflows/house-v1.json";
import type { TrackScore } from "../../../score.ts";
import { GRAMMARS, KITS } from "../genome/genome.ts";
import { ARP, BASS, LEAD, PAD, SINGERS, STAB } from "../genome/sounds.ts";
import { MODES } from "../genome/theory.ts";
import { judge, type Craft } from "./critic.ts";
import {
  CHART_KINDS,
  LAYERS,
  checkChart,
  repairChart,
  type Chart,
} from "./format.ts";
import { GOLD } from "./gold/index.ts";
import { performChart } from "./perform.ts";

export type ChatTurn = Readonly<{
  role: "system" | "user" | "assistant";
  content: string;
}>;
export type Usage = Readonly<{
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  /** The provider's own charge, when it reports one. */
  costUsd?: number;
}>;
export type Complete = (
  turns: readonly ChatTurn[],
) => Promise<{ text: string; usage?: Usage }>;

/** Claude Opus 5.5 list prices, dollars per million tokens. */
export const OPUS_PRICE = { input: 4, cachedInput: 0.2, output: 20 } as const;

/** Dollars for one request: the provider's charge, or list prices. */
export function costOf(usage: Usage, price = OPUS_PRICE): number {
  if (usage.costUsd !== undefined) return usage.costUsd;
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  return (
    ((usage.inputTokens - cached) * price.input +
      cached * price.cachedInput +
      usage.outputTokens * price.output) /
    1e6
  );
}

export const PALETTE = {
  pad: Object.keys(PAD),
  stab: Object.keys(STAB),
  arp: Object.keys(ARP),
  lead: Object.keys(LEAD),
  bass: Object.keys(BASS),
  singer: Object.keys(SINGERS),
  kit: [...KITS],
} as const;

const RULES = `Write one new hyperpop song as a chart, to the level of the three gold charts below. Every song is its own: a new title, key, mode, tempo, words, hook, form and sound. Never reuse a gold chart's melodies, words or patterns; they show the craft, not the content.

The craft (the performer and the critic measure it):
1. State the hook or an identity motif in the intro (4 to 8 bars) and build the intro in.
2. Every section 8 bars or fewer. A hook section is a sung chorus, then a drop: the hook on the lead or chops for up to 8 bars.
3. Develop every repeat: a second verse, chorus or drop adds or changes a layer, a feel, a stab grid, an arp order or a line. Write new tunes per section; at least 45% of the bars that carry a tune should bring one the song hasn't played.
4. Sung lines carry expression: vibrato (~) or a fall (>) on line ends and held words, about one expressive mark for every one or two sung notes, counting the moves.
5. Use the house profile's major scale throughout. Hold sung notes on chord tones or prepare a diatonic suspension (mark it with !). Chords are roman numerals, one per bar or two split with a dash, and may add diatonic 7, maj7 or add9 for color. No borrowed chords, secondary dominants, chromatic alterations, or modulation in the current house workflow.
6. Place moves by ear: stutters on the song's own syllables in drops, a dropout that spotlights a line, a silence before the last chorus, a landing on the last drop, a riser or crush into a drop, a drift from pretty to harsh, a dive out of a break, a tape stop.
7. The form and the sounds are the song's own. The gold charts share one form (intro, verse, pre, chorus, drop, twice, then bridge, break, last chorus, last drop, outro); don't copy it. Cold-open on the hook, run two verses back to back, put a post-chorus or a breakdown mid-song, end on a false ending or a new section, skip the pre or the bridge, use a 6-bar phrase. Pick the singer, stabs, counter and kit for this brief, not the gold charts' defaults.
8. A bridge or break turns somewhere new: a canon or counter-melody in the singer's rests (the counter layer), a half-time feel, a fugue-like entry of the chops or lead against the singer, sometimes.
9. Kick, snare and hat grids are 16 steps of digits (velocity / 10) and dots; the 808 locks to the kick. Stab grids are 16 steps; arp orders are 8 digits 0-4 over five chord tones. The whole song holds about 4000 notes: spend them on the hook sections, and keep verses, bridges and breaks lighter (the performer drops parts that don't fit).
10. Words are singable, concrete and a little strange: one image per song, internet-age, sung in short syllables. Write syllables split with "- " (ne- on) and hold vowels with _.

The current product writes our bright, plastic, bittersweet house hyperpop. The canonical policy is ${JSON.stringify(house)}. Choose a distinct tempo within that range; slower songs still have active drums and detailed production. Stock bf_emma carries the actual original words in the lower verse register, with a lift for the chorus. Keep space between sung phrases and let the instrumental answer. No ambient beds or whisper-only substitute for a sung lead. Match the brief within that house style.

Answer with the chart as one JSON object in a \`\`\`json fence and nothing else. It follows the Chart type below exactly.`;

/** The stable prompt: rules, the spec, the palette and the gold charts. */
export function chartSystemPrompt(): string {
  const spec = readFileSync(new URL("./format.ts", import.meta.url), "utf8");
  const types = spec.slice(0, spec.indexOf("// ----"));
  return [
    RULES,
    "## The chart format (TypeScript; Grammar and Mode are listed below)",
    "```ts",
    types.trim(),
    "```",
    "## Names",
    `Grammar (drum feels besides half, taps, none): ${GRAMMARS.join(", ")}`,
    `Mode: ${Object.keys(MODES).join(", ")}`,
    `Section kinds: ${CHART_KINDS.join(", ")}; layers: ${LAYERS.join(", ")}`,
    ...Object.entries(PALETTE).map(
      ([role, names]) =>
        `sounds.${role === "kit" ? "kit.kick / kit.snare / kit.hats" : role === "arp" ? "arp / arp2" : role === "lead" ? "lead (the counter takes a lead or an arp sound)" : role}: ${names.join(", ")}`,
    ),
    "## The gold charts",
    ...GOLD.map((chart) => `\`\`\`json\n${JSON.stringify(chart)}\n\`\`\``),
  ].join("\n\n");
}

/** The chart in a model's answer, or the reason it can't be read. */
export function readChartAnswer(
  text: string,
): { chart: Chart } | { error: string } {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const body =
    fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (e) {
    return { error: `the answer is not JSON (${(e as Error).message})` };
  }
  const problems = shapeOf(raw);
  // Off-by-one counts are mechanical, so code fixes them instead of a round.
  return problems.length
    ? { error: problems.join("; ") }
    : { chart: repairChart(raw as Chart) };
}

function shapeOf(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return ["the chart is not an object"];
  const c = raw as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of ["title", "key", "mode"])
    if (typeof c[key] !== "string") problems.push(`${key} must be a string`);
  if (typeof c.bpm !== "number") problems.push("bpm must be a number");
  if (typeof c.mode === "string" && !(c.mode in MODES))
    problems.push(
      `mode ${c.mode} is not one of ${Object.keys(MODES).join(", ")}`,
    );
  const s = c.sounds as Record<string, unknown> | undefined;
  if (!s || typeof s !== "object") problems.push("sounds is missing");
  else {
    const role: Record<string, readonly string[]> = {
      pad: PALETTE.pad,
      stab: PALETTE.stab,
      arp: PALETTE.arp,
      arp2: PALETTE.arp,
      lead: PALETTE.lead,
      counter: [...PALETTE.lead, ...PALETTE.arp],
      bass: PALETTE.bass,
      singer: PALETTE.singer,
    };
    for (const [key, names] of Object.entries(role))
      if (!names.includes(s[key] as string))
        problems.push(
          `sounds.${key} ${String(s[key])} is not one of ${names.join(", ")}`,
        );
    const kit = s.kit as Record<string, unknown> | undefined;
    for (const part of ["kick", "snare", "hats"])
      if (!PALETTE.kit.includes(kit?.[part] as never))
        problems.push(
          `sounds.kit.${part} must be one of ${PALETTE.kit.join(", ")}`,
        );
    const d = s.design as Record<string, unknown> | undefined;
    for (const k of ["brightness", "grit", "space", "width", "echo"])
      if (typeof d?.[k] !== "number")
        problems.push(`sounds.design.${k} must be a number 0..1`);
  }
  if (!Array.isArray(c.sections) || c.sections.length < 4)
    problems.push("sections must list the song's sections");
  else
    for (const [i, sec] of (
      c.sections as Record<string, unknown>[]
    ).entries()) {
      const name =
        typeof sec?.name === "string" ? sec.name : `section ${i + 1}`;
      if (!CHART_KINDS.includes(sec?.kind as never))
        problems.push(`${name}: kind must be one of ${CHART_KINDS.join(", ")}`);
      if (typeof sec?.bars !== "number") problems.push(`${name}: bars missing`);
      if (typeof sec?.chords !== "string")
        problems.push(`${name}: chords missing`);
      if (!Array.isArray(sec?.play)) problems.push(`${name}: play missing`);
      else
        for (const layer of sec.play as unknown[])
          if (!LAYERS.includes(layer as never))
            problems.push(`${name}: layer ${String(layer)} unknown`);
    }
  return problems;
}

export type Draft = Readonly<{
  round: number;
  chart?: Chart;
  problems: readonly string[];
  craft?: Craft;
  usage?: Usage;
  costUsd: number;
  ms: number;
}>;

export type WrittenChart = Readonly<{
  chart: Chart;
  score: TrackScore;
  craft: Craft;
  problems: readonly string[];
  drafts: readonly Draft[];
  /** Why the rounds ended early with the best draft so far, if they did. */
  stopped?: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
}>;

/** Problems in a chart, from the format check, the performer and the critic. */
export function reviewChart(chart: Chart): {
  problems: string[];
  score?: TrackScore;
  craft?: Craft;
} {
  const format = checkChart(chart);
  if (format.length) return { problems: format };
  try {
    const performed = performChart(chart);
    const verdict = judge(performed.score.toJSON());
    const form = chart.sections.map((x) => x.kind).join(" ");
    const copied = GOLD.find(
      (g) => g.sections.map((x) => x.kind).join(" ") === form,
    );
    // The budget always takes the quieter half of the second arp (as in the
    // gold charts); past that, or a third of any other part, the song lost it.
    const lost = Object.entries(performed.thinned)
      .filter(([id, share]) => share > (id === "arp2" ? 0.5 : 0.3))
      .map(([id, share]) => `${Math.round(share * 100)}% of ${id}`);
    return {
      problems: [
        ...verdict.problems,
        ...(copied
          ? [`the form copies ${copied.title}'s section for section`]
          : []),
        ...(lost.length
          ? [
              `the song writes more than the 4000-note budget, so the performer dropped ${lost.join(", ")}`,
            ]
          : []),
      ],
      score: performed.score,
      craft: verdict.craft,
    };
  } catch (e) {
    return { problems: [`the performer stopped: ${(e as Error).message}`] };
  }
}

/** What the model can change for each kind of critic problem. */
const HINTS: readonly (readonly [RegExp, string])[] = [
  [
    /bed moves/,
    "the performer voice-leads every chord for you, so this is the progression: move by chords that share two tones (roots a third apart, i-VI, I-iii, IV-ii), hold a chord for a whole bar instead of splitting it, or keep a pedal chord under a busy line",
  ],
  [
    /bring new material/,
    "write new hook, counter and chops lines for later passes instead of repeating earlier ones, and vary the verse 2 tune",
  ],
  [
    /expressive notes/,
    "add ~ or > to the held and line-ending sung notes, and stutters or dives in the drops",
  ],
  [
    /rub a semitone/,
    "move held sung notes onto chord tones, or mark a prepared suspension with !",
  ],
  [
    /the form copies/,
    "reorder, cut or add sections so the song has its own shape (rule 7)",
  ],
  [
    /note budget/,
    "spend notes where they count: sparser stab grids (2 to 4 hits a bar) and fewer layers in verses and the bridge, 16th hats only in choruses and drops, arp2 only where the arp leaves room",
  ],
  [
    /rhythm notes, \d+ degrees|syllables/,
    "count the x in each rhythm and give exactly one degree and one syllable per x",
  ],
];
const withHint = (problem: string) => {
  const hint = HINTS.find(([pattern]) => pattern.test(problem))?.[1];
  return hint ? `${problem} — ${hint}` : problem;
};

/** Write, check and revise a chart for `brief` over up to `rounds` drafts. */
export async function writeChart(
  brief: string,
  complete: Complete,
  options: { rounds?: number; onDraft?: (draft: Draft) => void } = {},
): Promise<WrittenChart> {
  const rounds = options.rounds ?? 3;
  const turns: ChatTurn[] = [
    { role: "system", content: chartSystemPrompt() },
    { role: "user", content: `Brief: ${brief}` },
  ];
  const drafts: Draft[] = [];
  let stopped: string | undefined;
  let best:
    | { chart: Chart; score: TrackScore; craft: Craft; problems: string[] }
    | undefined;
  for (let round = 1; round <= rounds; round++) {
    const started = Date.now();
    let reply: Awaited<ReturnType<Complete>> | undefined;
    // A dropped connection mid-answer asks once more; after that a song with
    // a played draft keeps it rather than losing the rounds already paid for.
    for (let tries = 0; !reply; tries++) {
      try {
        reply = await complete(turns);
      } catch (error) {
        const dropped = /stream (failed|timed out)/.test(
          (error as Error).message,
        );
        if (dropped && tries === 0) continue;
        if (!best) throw error;
        stopped = `round ${round} failed: ${(error as Error).message}`;
        break;
      }
    }
    if (!reply) break;
    const { text, usage } = reply;
    const read = readChartAnswer(text);
    const review =
      "chart" in read ? reviewChart(read.chart) : { problems: [read.error] };
    const draft: Draft = {
      round,
      ...("chart" in read ? { chart: read.chart } : {}),
      problems: review.problems,
      ...("craft" in review && review.craft ? { craft: review.craft } : {}),
      ...(usage ? { usage } : {}),
      costUsd: usage ? costOf(usage) : 0,
      ms: Date.now() - started,
    };
    drafts.push(draft);
    options.onDraft?.(draft);
    if ("chart" in read && review.score && review.craft) {
      if (!best || review.problems.length <= best.problems.length)
        best = {
          chart: read.chart,
          score: review.score,
          craft: review.craft,
          problems: review.problems,
        };
    }
    if (best && best.problems.length === 0 && best.chart === draft.chart) break;
    if (round === rounds) break;
    turns.push(
      { role: "assistant", content: text },
      {
        role: "user",
        content: `The chart needs another pass. Fix these and answer with the whole chart again:\n- ${review.problems.map(withHint).join("\n- ")}`,
      },
    );
  }
  if (!best)
    throw new Error(
      `no draft played: ${drafts.at(-1)?.problems.slice(0, 3).join("; ")}`,
    );
  const sum = (pick: (u: Usage) => number) =>
    drafts.reduce((n, d) => n + (d.usage ? pick(d.usage) : 0), 0);
  return {
    ...best,
    drafts,
    ...(stopped ? { stopped } : {}),
    inputTokens: sum((u) => u.inputTokens),
    outputTokens: sum((u) => u.outputTokens),
    cachedInputTokens: sum((u) => u.cachedInputTokens ?? 0),
    costUsd: drafts.reduce((n, d) => n + d.costUsd, 0),
  };
}
