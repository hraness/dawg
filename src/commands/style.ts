/**
 * The `style` prompt command: browse the style taxonomy (core/styles) and
 * generate a song from a style card.
 *
 *   style                          the families and their roots
 *   style list [id|family]         children of a node (or a family's roots)
 *   style search <words>           ranked name, alias and region search
 *   style info <id>                one style: path, meter, tempo, pitch, harmony
 *   style <id> [bars] [seed]       generate the song from a style (replaces it)
 *   style blend <a> <b> [w] [bars] [seed]
 *                                  a weighted blend; w 0 is a, 1 is b (0.5)
 *   style again                    the current style with the next seed
 *
 * A generated song replaces the score in one revision (one undo step) and
 * records `style` provenance (id, seed, bars, blend) on the song.
 */
import type { TrackScore } from "../../core/score.ts";
import {
  blendStyles,
  hasCard,
  LEAF_IDS,
  ROOT_IDS,
  resolveStyle,
  searchStyles,
  STYLE_CARDS,
  STYLE_IDS,
  STYLE_TREE,
  styleByName,
  stylePath,
  type StyleNode,
} from "../../core/styles/index.ts";
import {
  generateStyle,
  STYLE_LIMITS,
  StyleError,
  styleScore,
  type GeneratedStyle,
} from "../../core/styles/generate.ts";
import { STYLE_FAMILIES } from "../../core/styles/taxonomy.ts";
import type { ResolvedStyle, StyleId } from "../../core/styles/schema.ts";
import { validateGenerated } from "../../core/styles/validate.ts";

export type StyleCommand =
  | { type: "style-families" }
  | { type: "style-list"; id: string }
  | { type: "style-search"; query: string }
  | { type: "style-info"; id: string }
  | { type: "style-again" }
  | {
      type: "style-apply";
      id: string;
      bars?: number;
      seed?: number;
      blend?: Readonly<{ id: string; weight: number }>;
    }
  | { type: "style-bad"; message: string };

export type StyleResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
}>;

export const STYLE_USAGE =
  "style [list [id]|search <words>|info <id>|<id> [bars] [seed]|blend <a> <b> [w] [bars] [seed]|again]";

const INTEGER = /^\d{1,10}$/;
const WEIGHT = /^(?:0(?:\.\d+)?|1(?:\.0+)?|\.\d+|\d{1,3}%)$/;

function bad(message: string): StyleCommand {
  return { type: "style-bad", message };
}

/** Trailing `[bars] [seed]` integers; ids may contain digits, so only the tail. */
function tailNumbers(words: string[]): {
  rest: string[];
  bars?: number;
  seed?: number;
} {
  const numbers: number[] = [];
  let end = words.length;
  while (end > 1 && numbers.length < 2 && INTEGER.test(words[end - 1]!)) {
    numbers.unshift(Number(words[end - 1]));
    end -= 1;
  }
  return {
    rest: words.slice(0, end),
    ...(numbers[0] !== undefined ? { bars: numbers[0] } : {}),
    ...(numbers[1] !== undefined ? { seed: numbers[1] } : {}),
  };
}

function weightOf(text: string): number {
  return text.endsWith("%") ? Number(text.slice(0, -1)) / 100 : Number(text);
}

export function parseStyleCommand(prompt: string): StyleCommand | undefined {
  if (prompt.length > 512) return undefined;
  const words = prompt.trim().split(/\s+/);
  const head = words[0]?.toLowerCase();
  if (head !== "style" && head !== "/style" && head !== "styles")
    return undefined;
  const rest = words.slice(1);
  if (rest.length === 0) return { type: "style-families" };
  const verb = rest[0]!.toLowerCase();
  if (verb === "list" || verb === "ls" || verb === "tree")
    return rest.length === 1
      ? { type: "style-families" }
      : { type: "style-list", id: rest.slice(1).join(" ") };
  if (verb === "search" || verb === "find") {
    const query = rest.slice(1).join(" ").trim();
    return query
      ? { type: "style-search", query }
      : bad("style search <words> · style search maqam");
  }
  if (verb === "info" || verb === "show" || verb === "about") {
    const id = rest.slice(1).join(" ").trim();
    return id ? { type: "style-info", id } : bad("style info <id>");
  }
  if (verb === "again" || verb === "next" || verb === "reroll")
    return { type: "style-again" };
  if (verb === "blend" || verb === "mix") {
    // Ids are single words (`deep-house`); then [weight] [bars] [seed].
    const [a, b, ...numbers] = rest.slice(1);
    const usage = bad(
      "style blend <a> <b> [weight 0..1] [bars] [seed] · style blend bebop bossa-nova 0.3",
    );
    if (!a || !b || numbers.length > 3) return usage;
    let weight = 0.5;
    if (numbers[0] !== undefined) {
      if (!WEIGHT.test(numbers[0])) return usage;
      weight = weightOf(numbers[0]);
      if (!(weight >= 0 && weight <= 1)) return usage;
    }
    if (numbers.slice(1).some((word) => !INTEGER.test(word))) return usage;
    return {
      type: "style-apply",
      id: a,
      blend: { id: b, weight },
      ...(numbers[1] !== undefined ? { bars: Number(numbers[1]) } : {}),
      ...(numbers[2] !== undefined ? { seed: Number(numbers[2]) } : {}),
    };
  }
  const tail = tailNumbers(rest);
  return {
    type: "style-apply",
    id: tail.rest.join(" "),
    ...(tail.bars !== undefined ? { bars: tail.bars } : {}),
    ...(tail.seed !== undefined ? { seed: tail.seed } : {}),
  };
}

/** A taxonomy id from typed text: id, title or alias. */
export function findStyle(text: string): StyleId | undefined {
  const lowered = text.trim().toLowerCase();
  if (STYLE_TREE.has(lowered)) return lowered;
  return styleByName(text);
}

function unknown(text: string): string {
  const near = searchStyles(text, 4).map((match) => match.id);
  return `style · no style "${text}"${near.length ? ` · try ${near.join(" ")}` : " · style search <words>"}`;
}

function childCount(node: StyleNode): string {
  if (node.leaf) return hasCard(node.id) ? "" : " ·";
  return ` (${node.children.length})`;
}

/** One-line node label: id, a card mark, and its child count. */
function nodeLabel(node: StyleNode): string {
  return `${node.id}${childCount(node)}`;
}

export function styleFamiliesText(): string {
  const lines = STYLE_FAMILIES.map(
    (family) =>
      `${family.key}: ${family.roots.map((id) => nodeLabel(STYLE_TREE.get(id)!)).join(" ")}`,
  );
  return [
    `styles · ${STYLE_IDS.length} in the tree · ${LEAF_IDS.length} leaves · ${STYLE_CARDS.size} cards`,
    ...lines,
    "style list <id> · style search <words> · style info <id> · style <id> [bars] [seed]",
  ].join("\n");
}

export function styleListText(text: string): StyleResult {
  const family = STYLE_FAMILIES.find((entry) => entry.key === text.trim());
  if (family)
    return {
      ok: true,
      message: `${family.title}: ${family.roots.map((id) => nodeLabel(STYLE_TREE.get(id)!)).join(" ")}`,
    };
  const id = findStyle(text);
  if (!id) return { ok: false, message: unknown(text) };
  const node = STYLE_TREE.get(id)!;
  const path = stylePath(id).join(" › ");
  if (node.leaf)
    return { ok: true, message: `${path} · a leaf · style info ${id}` };
  return {
    ok: true,
    message: `${path}: ${node.children.map((child) => nodeLabel(STYLE_TREE.get(child)!)).join(" ")}`,
  };
}

export function styleSearchText(query: string): StyleResult {
  const matches = searchStyles(query, 12);
  if (matches.length === 0)
    return { ok: false, message: `style search · nothing for "${query}"` };
  return {
    ok: true,
    message: `style search ${query}: ${matches.map((match) => match.id).join(" ")}`,
  };
}

const pct = (value: number) => `${Math.round(value * 100)}%`;

function weightedText<T>(
  list: readonly (readonly [T, number])[] | undefined,
  show: (value: T) => string = String,
): string {
  if (!list || list.length === 0) return "-";
  const total = list.reduce((sum, [, weight]) => sum + weight, 0) || 1;
  return [...list]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([value, weight]) =>
      list.length === 1 ? show(value) : `${show(value)} ${pct(weight / total)}`,
    )
    .join(", ");
}

/** The facts of a resolved style, one per line, for /style info and tools. */
export function describeStyle(style: ResolvedStyle): string[] {
  const node = STYLE_TREE.get(style.id);
  const roles = Object.entries(style.texture.roles)
    .filter(([, role]) => role)
    .map(([name, role]) => (role!.required ? name : `${name}?`));
  const harmony = [
    style.harmony.model,
    style.harmony.presets
      ? `presets ${weightedText(style.harmony.presets)}`
      : "",
    style.harmony.forms ? `forms ${style.harmony.forms.length}` : "",
    style.harmony.chain ? "numeral chain" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const era = node
    ? node.era.from === null
      ? ""
      : `${node.era.from}${node.era.to === null ? "-" : `-${node.era.to}`}`
    : "";
  return [
    `${style.title} (${style.id})${era ? ` · ${era}` : ""}${node?.region.length ? ` · ${node.region.join(", ")}` : ""}`,
    `path ${stylePath(style.id).join(" › ")} · cards ${style.lineage.join(" › ") || "base"}`,
    style.summary,
    `meter ${weightedText(style.meter.signatures)}${style.meter.cycle ? ` · cycle ${style.meter.cycle.name}` : ""} · tempo ${style.tempo.bpm[0]}-${style.tempo.bpm[1]} (${style.tempo.typical}) bpm`,
    `groove ${style.groove.subdivision}/beat · swing ${style.groove.swingRatio[0] === style.groove.swingRatio[1] ? style.groove.swingRatio[0] : style.groove.swingRatio.join("-")}`,
    `pitch ${style.pitch.tuning ?? "12-TET"} · ${weightedText(style.pitch.scales)}`,
    `harmony ${harmony}`,
    `texture ${style.texture.kind} · ${roles.join(" ")}`,
  ].filter((line) => line.trim().length > 0);
}

export function styleInfoText(text: string): StyleResult {
  const id = findStyle(text);
  if (!id) return { ok: false, message: unknown(text) };
  const lines = describeStyle(resolveStyle(id));
  const node = STYLE_TREE.get(id)!;
  if (!node.leaf) lines.push(`children ${node.children.join(" ")}`);
  if (!hasCard(id) && STYLE_CARDS.size > 0)
    lines.push("no card of its own yet: plays its nearest ancestor's card");
  return { ok: true, message: lines.join("\n") };
}

/** Generate a song for a resolved command; throws StyleError on bad input. */
export function generateFromCommand(
  command: Extract<StyleCommand, { type: "style-apply" }>,
): GeneratedStyle {
  const id = findStyle(command.id);
  if (!id) throw new StyleError(unknown(command.id));
  let style: ResolvedStyle = resolveStyle(id);
  if (command.blend) {
    const other = findStyle(command.blend.id);
    if (!other) throw new StyleError(unknown(command.blend.id));
    style = blendStyles(style, resolveStyle(other), command.blend.weight);
  }
  if (
    command.bars !== undefined &&
    (command.bars < STYLE_LIMITS.minBars || command.bars > STYLE_LIMITS.maxBars)
  )
    throw new StyleError(
      `style · bars take ${STYLE_LIMITS.minBars}..${STYLE_LIMITS.maxBars}`,
    );
  if (command.seed !== undefined && command.seed > STYLE_LIMITS.maxSeed)
    throw new StyleError(`style · seed takes 0..${STYLE_LIMITS.maxSeed}`);
  return generateStyle(style, {
    ...(command.bars !== undefined ? { bars: command.bars } : {}),
    ...(command.seed !== undefined ? { seed: command.seed } : {}),
  });
}

/** One line about a generated song. */
export function generatedSummary(generated: GeneratedStyle): string {
  const { plan, provenance } = generated;
  const name = provenance.blend
    ? `${provenance.id} + ${provenance.blend.id} ${pct(provenance.blend.weight)}`
    : provenance.id;
  const report = validateGenerated(generated);
  const failed = report.checks.filter((check) => !check.ok);
  return [
    `style ${name} · seed ${plan.seed} · ${plan.bars} bars`,
    `${plan.signature} ${Math.round(plan.bpm)} bpm`,
    plan.keyText ?? plan.tuning?.name ?? "",
    `${plan.tracks.length} tracks`,
    failed.length === 0
      ? `${report.checks.length} checks pass`
      : `${failed.length} of ${report.checks.length} checks off: ${failed.map((check) => check.name).join(" ")}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function applyStyleCommand(
  score: TrackScore,
  command: StyleCommand,
): StyleResult {
  switch (command.type) {
    case "style-bad":
      return { ok: false, message: command.message };
    case "style-families":
      return { ok: true, message: styleFamiliesText() };
    case "style-list":
      return styleListText(command.id);
    case "style-search":
      return styleSearchText(command.query);
    case "style-info":
      return styleInfoText(command.id);
    case "style-again": {
      const current = score.style;
      if (!current)
        return {
          ok: false,
          message: "style again · this song has no style yet · style <id>",
        };
      return applyStyleCommand(score, {
        type: "style-apply",
        id: current.id,
        bars: Math.min(current.bars, STYLE_LIMITS.maxBars),
        seed: (current.seed + 1) % (STYLE_LIMITS.maxSeed + 1),
        ...(current.blend ? { blend: current.blend } : {}),
      });
    }
    case "style-apply": {
      if (!command.id) return { ok: false, message: `usage: ${STYLE_USAGE}` };
      let generated: GeneratedStyle;
      try {
        generated = generateFromCommand(command);
      } catch (error) {
        if (error instanceof StyleError)
          return { ok: false, message: error.message };
        throw error;
      }
      return {
        ok: true,
        message: `${generatedSummary(generated)} · undo restores the song`,
        next: styleScore(generated),
        kind: "style.apply",
        payload: { style: generated.provenance },
      };
    }
  }
}

/** Taxonomy order of root ids, for the browser. */
export const STYLE_BROWSER_ROOTS: readonly StyleId[] = ROOT_IDS;
