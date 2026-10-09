/**
 * The style registry (quality-08): the taxonomy tree, the cards of every
 * family file, inheritance (`resolveStyle`), name lookup (`styleByName`,
 * `searchStyles`) and blending (`blendStyles`).
 *
 * Every taxonomy id resolves, card or not: `resolveStyle` folds BASE_STYLE
 * and whichever cards exist on the path root..id. A family lane adds a leaf
 * by appending a `card({...})` to its family file; nothing here changes.
 */

import { BASE_STYLE } from "./base.ts";
import { AFRICA_MENA_SOUTHASIA_CARDS } from "./africa-mena-southasia.ts";
import { AMERICAS_CARDS } from "./americas.ts";
import { ART_CARDS } from "./art.ts";
import { ELECTRONIC_CARDS } from "./electronic.ts";
import { EUROPE_ASIA_PACIFIC_CARDS } from "./europe-asia-pacific.ts";
import { POP_CARDS } from "./pop.ts";
import { ROCK_CARDS } from "./rock.ts";
import { ROOTS_CARDS } from "./roots.ts";
import type {
  ResolvedStyle,
  StyleBody,
  StyleCard,
  StyleId,
  Weighted,
} from "./schema.ts";
import {
  STYLE_FAMILIES,
  TAXONOMY_ROWS,
  type StyleFamilyKey,
} from "./taxonomy.ts";

export * from "./schema.ts";
export { BASE_STYLE } from "./base.ts";
export { STYLE_FAMILIES, type StyleFamilyKey } from "./taxonomy.ts";

// ---------------------------------------------------------------------------
// Taxonomy

/** One taxonomy entry with its tree links. */
export type StyleNode = Readonly<{
  id: StyleId;
  parent: StyleId | null;
  family: StyleFamilyKey;
  title: string;
  aliases: readonly string[];
  region: readonly string[];
  era: Readonly<{ from: number | null; to: number | null }>;
  children: readonly StyleId[];
  /** True when no row names this id as its parent. */
  leaf: boolean;
}>;

function buildTree(): ReadonlyMap<StyleId, StyleNode> {
  const children = new Map<StyleId, StyleId[]>();
  for (const [id, parent] of TAXONOMY_ROWS) {
    if (parent === null) continue;
    const list = children.get(parent) ?? [];
    list.push(id);
    children.set(parent, list);
  }
  const out = new Map<StyleId, StyleNode>();
  for (const [
    id,
    parent,
    family,
    title,
    aliases,
    region,
    from,
    to,
  ] of TAXONOMY_ROWS) {
    const kids = children.get(id) ?? [];
    out.set(
      id,
      Object.freeze({
        id,
        parent,
        family,
        title,
        aliases,
        region,
        era: Object.freeze({ from, to }),
        children: Object.freeze(kids),
        leaf: kids.length === 0,
      }),
    );
  }
  return out;
}

/** Every taxonomy entry by id, in taxonomy order. */
export const STYLE_TREE: ReadonlyMap<StyleId, StyleNode> = buildTree();
/** Every taxonomy id in taxonomy order. */
export const STYLE_IDS: readonly StyleId[] = Object.freeze([
  ...STYLE_TREE.keys(),
]);
/** Leaf ids only. */
export const LEAF_IDS: readonly StyleId[] = Object.freeze(
  STYLE_IDS.filter((id) => STYLE_TREE.get(id)!.leaf),
);
/** Family roots in family order (`jazz`, `blues`, ... `oceania`). */
export const ROOT_IDS: readonly StyleId[] = Object.freeze(
  STYLE_FAMILIES.flatMap((family) => family.roots),
);

export function styleNode(id: StyleId): StyleNode | undefined {
  return STYLE_TREE.get(id);
}

/** Root..id path of taxonomy ids (empty for an unknown id). */
export function stylePath(id: StyleId): StyleId[] {
  const path: StyleId[] = [];
  let node = STYLE_TREE.get(id);
  while (node) {
    path.unshift(node.id);
    node = node.parent === null ? undefined : STYLE_TREE.get(node.parent);
  }
  return path;
}

// ---------------------------------------------------------------------------
// Cards

/** Every card from the family files, by id. */
export const STYLE_CARDS: ReadonlyMap<StyleId, StyleCard> = (() => {
  const out = new Map<StyleId, StyleCard>();
  for (const list of [
    ART_CARDS,
    ROOTS_CARDS,
    ROCK_CARDS,
    POP_CARDS,
    ELECTRONIC_CARDS,
    AMERICAS_CARDS,
    AFRICA_MENA_SOUTHASIA_CARDS,
    EUROPE_ASIA_PACIFIC_CARDS,
  ])
    for (const card of list) {
      if (!STYLE_TREE.has(card.id))
        throw new Error(`style card "${card.id}" is not a taxonomy id`);
      if (out.has(card.id))
        throw new Error(`style card "${card.id}" is defined twice`);
      out.set(card.id, card);
    }
  return out;
})();

/** True when `id` has a card of its own (not just inherited defaults). */
export function hasCard(id: StyleId): boolean {
  return STYLE_CARDS.has(id);
}

// ---------------------------------------------------------------------------
// Merge

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAppend(value: unknown): value is { "+": readonly unknown[] } {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    Array.isArray(value["+"])
  );
}

/** `[value, weight]` pairs. */
function isWeightedList(value: unknown): value is Weighted<unknown> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[1] === "number",
    )
  );
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Append a weighted list: an existing value takes the new weight. */
function appendWeighted(
  base: unknown,
  extra: readonly unknown[],
): readonly unknown[] {
  const out: (readonly [unknown, number])[] = isWeightedList(base)
    ? base.map((entry) => [entry[0], entry[1]] as const)
    : [];
  for (const entry of extra as Weighted<unknown>) {
    const at = out.findIndex((item) => same(item[0], entry[0]));
    if (at >= 0) out[at] = [entry[0], entry[1]];
    else out.push([entry[0], entry[1]]);
  }
  return out;
}

/**
 * Apply one card patch to a body: records merge per key and `null` deletes
 * a key; arrays, ranges and scalars replace; `{ "+": list }` appends to a
 * weighted list.
 */
export function mergePatch(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (isAppend(patch)) return appendWeighted(base, patch["+"]);
  if (isRecord(patch) && isRecord(base)) {
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete out[key];
      else if (value !== undefined) out[key] = mergePatch(base[key], value);
    }
    return out;
  }
  if (isRecord(patch)) return mergePatch({}, patch);
  return patch;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** Merge card patches over BASE_STYLE in order. */
export function mergeCards(cards: readonly StyleCard[]): StyleBody {
  let body: unknown = BASE_STYLE;
  for (const card of cards) {
    const { id: _id, abstract: _abstract, ...patch } = card;
    body = mergePatch(body, patch);
  }
  return body as StyleBody;
}

const resolved = new Map<StyleId, ResolvedStyle>();

/**
 * The resolved style for a taxonomy id: BASE_STYLE, then the card of each
 * id on the path root..id that has one. Frozen and cached. Throws on an
 * unknown id (use `styleByName` for user text).
 */
export function resolveStyle(id: StyleId): ResolvedStyle {
  const hit = resolved.get(id);
  if (hit) return hit;
  const node = STYLE_TREE.get(id);
  if (!node) throw new Error(`unknown style "${id}"`);
  const path = stylePath(id);
  const cards = path.flatMap((step) => {
    const card = STYLE_CARDS.get(step);
    return card ? [card] : [];
  });
  const body = mergeCards(cards);
  const style = deepFreeze({
    ...body,
    id,
    title: node.title,
    lineage: cards.map((card) => card.id),
  }) as ResolvedStyle;
  resolved.set(id, style);
  return style;
}

// ---------------------------------------------------------------------------
// Names

/** Lowercase, hyphens and underscores as spaces, accents folded. */
export function normalizeStyleName(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9&'+/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NAME_INDEX: ReadonlyMap<string, StyleId> = (() => {
  const out = new Map<string, StyleId>();
  // Ids first, then titles, then aliases: an earlier kind wins a clash.
  for (const node of STYLE_TREE.values())
    out.set(normalizeStyleName(node.id), node.id);
  for (const node of STYLE_TREE.values()) {
    const key = normalizeStyleName(node.title);
    if (!out.has(key)) out.set(key, node.id);
  }
  for (const node of STYLE_TREE.values())
    for (const alias of node.aliases) {
      const key = normalizeStyleName(alias);
      if (!out.has(key)) out.set(key, node.id);
    }
  return out;
})();

/** The taxonomy id an id, title or alias names (case and accents ignored). */
export function styleByName(text: string): StyleId | undefined {
  if (typeof text !== "string" || text.length > 120) return undefined;
  return NAME_INDEX.get(normalizeStyleName(text));
}

export type StyleMatch = Readonly<{ id: StyleId; score: number; via: string }>;

/**
 * Ranked lexical search over ids, titles, aliases, regions and summaries:
 * exact names first, then prefix, word and substring matches. Cheap and
 * offline, so the agent and the menu can call it on every keystroke.
 */
export function searchStyles(query: string, limit = 20): StyleMatch[] {
  const q = normalizeStyleName(query);
  if (!q) return [];
  const words = q.split(" ");
  const out: StyleMatch[] = [];
  for (const node of STYLE_TREE.values()) {
    const names = [node.id, node.title, ...node.aliases].map(
      normalizeStyleName,
    );
    let best = 0;
    let via = "";
    for (const name of names) {
      let score = 0;
      if (name === q) score = 100;
      else if (name.startsWith(q)) score = 60;
      else if (` ${name} `.includes(` ${q} `)) score = 45;
      else if (name.includes(q)) score = 30;
      else if (words.length > 1 && words.every((word) => name.includes(word)))
        score = 25;
      if (score > best) {
        best = score;
        via = name;
      }
    }
    if (best === 0) {
      const extra = [...node.region, STYLE_CARDS.get(node.id)?.summary ?? ""]
        .map(normalizeStyleName)
        .join(" ");
      if (words.every((word) => extra.includes(word))) {
        best = 10;
        via = "summary";
      }
    }
    if (best > 0)
      out.push({ id: node.id, score: best + (node.leaf ? 1 : 0), via });
  }
  return out
    .sort(
      (a, b) =>
        b.score - a.score || STYLE_IDS.indexOf(a.id) - STYLE_IDS.indexOf(b.id),
    )
    .slice(0, Math.max(0, limit));
}

// ---------------------------------------------------------------------------
// Blend

/** Keys whose values are categorical: the heavier side wins whole. */
const DISCRETE = new Set([
  "meter",
  "summary",
  "seedSalt",
  "subdivision",
  "tuning",
  "degrees",
  "tonic",
  "maqam",
  "raga",
  "model",
  "kind",
  "archetype",
  "fills",
  "locks",
  "walk",
  "instrument",
  "voices",
  "loudness",
]);

const lerp = (a: number, b: number, w: number) => a + (b - a) * w;

/** Stretch a probability grid to `size` steps (nearest step). */
export function stretchGrid(grid: readonly number[], size: number): number[] {
  if (grid.length === size || grid.length === 0) return [...grid];
  const out = new Array<number>(size).fill(0);
  for (let i = 0; i < grid.length; i += 1) {
    const at = Math.round((i * size) / grid.length);
    if (at < size) out[at] = Math.max(out[at]!, grid[i]!);
  }
  return out;
}

/**
 * A role's onset grid for one bar of a plan. An aksak hand drum (perc
 * under a beat grouping) whose grid was written for another bar length
 * strikes the group starts instead: stretching would smear 2+2+3.
 */
export function roleGrid(
  grid: readonly number[] | undefined,
  role: string,
  plan: {
    stepsPerBar: number;
    beatsPerBar: number;
    grouping?: readonly number[] | undefined;
  },
): number[] | undefined {
  if (!grid || !grid.length) return undefined;
  if (role === "perc" && plan.grouping && grid.length !== plan.stepsPerBar) {
    const out = new Array<number>(plan.stepsPerBar).fill(0);
    const stepsPerUnit = plan.stepsPerBar / plan.beatsPerBar;
    let at = 0;
    for (const group of plan.grouping) {
      out[Math.round(at * stepsPerUnit) % plan.stepsPerBar] = 1;
      at += group;
    }
    return out;
  }
  return stretchGrid(grid, plan.stepsPerBar);
}

function blendValue(a: unknown, b: unknown, w: number, key: string): unknown {
  if (a === undefined) return w >= 0.5 || key === "onsets-role" ? b : undefined;
  if (b === undefined) return w < 0.5 || key === "onsets-role" ? a : undefined;
  if (DISCRETE.has(key)) return w < 0.5 ? a : b;
  if (typeof a === "number" && typeof b === "number") return lerp(a, b, w);
  if (isWeightedList(a) && isWeightedList(b)) {
    const out: [unknown, number][] = a.map((entry) => [
      entry[0],
      entry[1] * (1 - w),
    ]);
    for (const entry of b) {
      const at = out.findIndex((item) => same(item[0], entry[0]));
      if (at >= 0) out[at]![1] += entry[1] * w;
      else out.push([entry[0], entry[1] * w]);
    }
    return out.filter((entry) => entry[1] > 0);
  }
  if (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.every((x) => typeof x === "number") &&
    b.every((x) => typeof x === "number")
  ) {
    const bb = stretchGrid(b as number[], a.length);
    return (a as number[]).map((x, i) => lerp(x, bb[i]!, w));
  }
  if (isRecord(a) && isRecord(b)) {
    const out: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      // A role grid on one side only fades in by its weight.
      const childKey = key === "onsets" ? "onsets-role" : k;
      let value: unknown;
      if (key === "onsets") {
        const left = a[k] as number[] | undefined;
        const right = b[k] as number[] | undefined;
        const size = (left ?? right)!.length;
        value = blendValue(
          left ?? new Array<number>(size).fill(0),
          right ? stretchGrid(right, size) : new Array<number>(size).fill(0),
          w,
          childKey,
        );
      } else value = blendValue(a[k], b[k], w, childKey);
      if (value !== undefined) out[k] = value;
    }
    return out;
  }
  return w < 0.5 ? a : b;
}

/**
 * A weighted merge of two styles: `weight` 0 is `a`, 1 is `b`. Numbers,
 * ranges and same-shape grids interpolate; weighted lists pool their
 * weights; meter, tuning, harmony model and instrument choices come whole
 * from the heavier side. When the two use different tunings or degree
 * sets the heavier side's pitch system comes whole, so the result is
 * always playable.
 */
export function blendStyles(
  a: ResolvedStyle,
  b: ResolvedStyle,
  weight: number,
): ResolvedStyle {
  const w = Math.min(1, Math.max(0, Number.isFinite(weight) ? weight : 0.5));
  const { id: _a, title: titleA, lineage: lineageA, ...bodyA } = a;
  const { id: _b, title: titleB, lineage: lineageB, ...bodyB } = b;
  const body = blendValue(bodyA, bodyB, w, "") as Record<string, unknown>;
  const heavy = w < 0.5 ? bodyA : bodyB;
  // Pitch systems with different tunings or degree sets do not mix.
  if (
    !same(bodyA.pitch.tuning, bodyB.pitch.tuning) ||
    bodyA.pitch.degrees ||
    bodyB.pitch.degrees
  )
    body.pitch = heavy.pitch;
  // A harmony model change brings its whole grammar.
  if (bodyA.harmony.model !== bodyB.harmony.model) body.harmony = heavy.harmony;
  // Rhythm grids follow the heavier side's meter.
  if (
    !same(bodyA.meter, bodyB.meter) ||
    bodyA.groove.subdivision !== bodyB.groove.subdivision
  )
    body.rhythm = heavy.rhythm;
  // Section energies and role maps stay consistent with the chosen plans.
  body.form = heavy.form;
  body.summary = `${Math.round((1 - w) * 100)}% ${titleA}, ${Math.round(w * 100)}% ${titleB}`;
  return deepFreeze({
    ...(body as StyleBody),
    id: w < 0.5 ? a.id : b.id,
    title: `${titleA} + ${titleB}`,
    lineage: [...lineageA, ...lineageB],
    blend: { a: a.id, b: b.id, weight: w },
  }) as ResolvedStyle;
}
