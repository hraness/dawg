/**
 * The agent's session-history tools (design §3.4, §4.2, §8):
 *
 * - `comment` leaves a breadcrumb in the session transcript, linked to the
 *   agent's last edit of the turn (or the turn itself), with the human's
 *   live context (focus, playhead, loop, open screen) captured at once.
 * - `history_query` searches this session's history: one line per row,
 *   newest first, at most 6 KiB, paged with `before`.
 * - `docs` reads the agent docs lens (tool reference, recipes, guides).
 *
 * Plus the end-of-turn bookkeeping every loop runs: the turn row and the
 * fallback comment when a turn changed the score without commenting.
 */
import { parseSince } from "../history/db.ts";
import { contextTargets } from "../history/targets.ts";
import { formatDetail, formatRowShort } from "../history/format.ts";
import { turnRow } from "../history/agent-rows.ts";
import {
  ACTOR_KINDS,
  HISTORY_KINDS,
  type ActorKind,
  type CommentContext,
  type HistoryFilter,
  type HistoryHandle,
  type HistoryKind,
  type HistoryRow,
} from "../history/types.ts";
import type { TrackScore } from "../../core/score.ts";
import type { AgentTool, ActionContext, ActionResult } from "./tools.ts";
import { ToolArgumentError } from "./tool-error.ts";

export const HISTORY_TOOL_LIMITS = Object.freeze({
  maxCommentChars: 600,
  maxTags: 4,
  maxTagChars: 32,
  maxResultBytes: 6 * 1024,
  defaultRows: 20,
  maxRows: 100,
  /** Fallback comment body clip (design §3.4). */
  autoCommentChars: 300,
  /** The brief's "now and recent history" section. */
  briefBytes: 700,
});

const ABOUT = /^(last_edit|turn|none|rev:\d+)$/;

/** Per-turn facts a history tool needs; set by `executeCall`. */
export type TurnInfo = Readonly<{
  id: string;
  /** Score revision when the turn's first call ran. */
  startRevision: number;
  subagentId?: string;
}>;

function need(context: ActionContext): {
  history: HistoryHandle;
  turn: TurnInfo | undefined;
} {
  if (!context.history)
    throw new ToolArgumentError(
      "history is off in this session (DAWG_HISTORY=off or no .dawg/history.db)",
    );
  return { history: context.history, turn: context.turn };
}

function tagsOf(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new ToolArgumentError("tags must be an array of words");
  const out: string[] = [];
  for (const tag of value) {
    if (typeof tag !== "string") continue;
    const clean = tag
      .replace(/^#/, "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, HISTORY_TOOL_LIMITS.maxTagChars);
    if (clean && !out.includes(clean)) out.push(clean);
    if (out.length >= HISTORY_TOOL_LIMITS.maxTags) break;
  }
  return out;
}

/** `#love` words inside the text count as tags too. */
function inlineTags(text: string): string[] {
  return [...text.matchAll(/(?:^|\s)#([a-z0-9_-]{1,32})\b/gi)].map((m) =>
    m[1]!.toLowerCase(),
  );
}

/**
 * The agent's newest edit since the turn began, or undefined. Edit rows are
 * written by the session record after each commit, so this is a query, not
 * bookkeeping that could drift from the record.
 */
export function lastAgentEdit(
  history: HistoryHandle,
  turn: TurnInfo | undefined,
): HistoryRow | undefined {
  const row = history.query({
    kinds: ["edit"],
    actors: ["agent", "subagent"],
    limit: 1,
  }).rows[0];
  if (row === undefined) return undefined;
  if (turn !== undefined && (row.rev ?? -1) <= turn.startRevision)
    return undefined;
  return row;
}

function parentTargets(parent: HistoryRow | undefined) {
  return (parent?.targets ?? []).filter(
    (target) =>
      target.type === "track" ||
      target.type === "instrument" ||
      target.type === "param",
  );
}

/** Writes one agent comment through the handle; returns its id. */
export function appendAgentComment(
  history: HistoryHandle,
  input: {
    text: string;
    tags: readonly string[];
    turn: TurnInfo | undefined;
    parent?: HistoryRow;
    parentId?: string;
    sub?: string;
    score?: TrackScore;
  },
): { id: string; context: CommentContext; done: Promise<unknown> } {
  let context: CommentContext;
  try {
    context = history.context();
  } catch {
    context = { rev: 0 };
  }
  const parentId = input.parent?.id ?? input.parentId;
  const seen = new Set<string>();
  const targets = [
    ...contextTargets(context, beatsPerBar(input.score)),
    ...parentTargets(input.parent),
  ].filter((target) => {
    const key = `${target.type}\u0000${target.key}\u0000${target.trackId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const appended = history.append({
    kind: "comment",
    ...(input.sub !== undefined ? { sub: input.sub } : {}),
    ...(parentId !== undefined ? { parentId } : {}),
    actor: {
      kind: input.turn?.subagentId !== undefined ? "subagent" : "agent",
      ...(input.turn?.subagentId !== undefined
        ? { actorId: input.turn.subagentId }
        : {}),
    },
    summary: input.text,
    body: input.text,
    context,
    payload: {
      ...(input.turn !== undefined ? { turnId: input.turn.id } : {}),
      ...(input.turn?.subagentId !== undefined
        ? { subagent: input.turn.subagentId }
        : {}),
    },
    targets: targets.slice(0, 64),
    tags: input.tags,
  });
  return { id: appended.id, context, done: appended.done };
}

function beatsPerBar(score: TrackScore | undefined): number | undefined {
  const meter = (score as { beatsPerBar?: unknown } | undefined)?.beatsPerBar;
  return typeof meter === "number" ? meter : undefined;
}

const commentTool: AgentTool = {
  name: "comment",
  description:
    "Leave a comment in the session transcript (what you changed and why); linked to your last edit by default, with the human's focus and playhead.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        minLength: 1,
        maxLength: HISTORY_TOOL_LIMITS.maxCommentChars,
      },
      about: {
        type: "string",
        description: "last_edit (default), turn, rev:N or none",
      },
      tags: {
        type: "array",
        items: { type: "string", maxLength: HISTORY_TOOL_LIMITS.maxTagChars },
        maxItems: HISTORY_TOOL_LIMITS.maxTags,
      },
    },
    required: ["text"],
    additionalProperties: false,
  },
  plan(args, toolContext) {
    const raw = typeof args.text === "string" ? args.text : "";
    // eslint-disable-next-line no-control-regex
    const text = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
    if (!text) throw new ToolArgumentError("comment needs text");
    if (text.length > HISTORY_TOOL_LIMITS.maxCommentChars)
      throw new ToolArgumentError(
        `comment text is at most ${HISTORY_TOOL_LIMITS.maxCommentChars} characters`,
      );
    const about = args.about === undefined ? "last_edit" : String(args.about);
    if (!ABOUT.test(about))
      throw new ToolArgumentError(
        'about must be "last_edit", "turn", "rev:N" or "none"',
      );
    const tags = [...new Set([...tagsOf(args.tags), ...inlineTags(text)])]
      .slice(0, HISTORY_TOOL_LIMITS.maxTags);
    return {
      kind: "action",
      summary: `comment · ${text.slice(0, 60)}`,
      async run(context): Promise<ActionResult> {
        const { history, turn } = need(context);
        let parent: HistoryRow | undefined;
        let parentId: string | undefined;
        if (about === "last_edit") parent = lastAgentEdit(history, turn);
        else if (about === "turn") parentId = turn?.id;
        else if (about.startsWith("rev:")) {
          const rev = Number(about.slice(4));
          parent = history.query({ rev, limit: 1 }).rows[0];
          if (parent === undefined)
            throw new ToolArgumentError(`no revision ${rev} in history`);
        }
        const written = appendAgentComment(history, {
          text,
          tags,
          turn,
          ...(parent ? { parent } : {}),
          ...(parentId ? { parentId } : {}),
          score: toolContext.score,
        });
        const where = [
          written.context.loop?.label ?? written.context.playhead?.label,
          written.context.focus?.trackName ?? written.context.focus?.trackId,
        ]
          .filter(Boolean)
          .join(" · ");
        const link = parent
          ? ` about ${parent.rev !== null ? `rev ${parent.rev}` : parent.id}`
          : parentId
            ? " about this turn"
            : "";
        return {
          content: JSON.stringify({
            ok: true,
            id: written.id,
            ...(parent ? { about: parent.id } : parentId ? { about: parentId } : {}),
            ...(where ? { context: where } : {}),
            ...(tags.length > 0 ? { tags } : {}),
          }),
          summary: `comment${link}`,
        };
      },
    };
  },
};

/** "bass" → the track id, by id or name (case-insensitive). */
function resolveTrack(score: TrackScore, word: string): string {
  const lower = word.toLowerCase();
  const tracks = score.tracks as readonly { id: string; name?: string }[];
  return (
    tracks.find((track) => track.id === word)?.id ??
    tracks.find((track) => track.id.toLowerCase() === lower)?.id ??
    tracks.find((track) => (track.name ?? "").toLowerCase() === lower)?.id ??
    word
  );
}

function enumList<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): T[] | undefined {
  if (value === undefined) return undefined;
  const words = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,]+/).filter(Boolean)
      : undefined;
  if (!words) throw new ToolArgumentError(`${name} must be an array`);
  const out: T[] = [];
  for (const word of words) {
    if (!(allowed as readonly unknown[]).includes(word))
      throw new ToolArgumentError(
        `${name} must be one of ${allowed.join(", ")}`,
      );
    out.push(word as T);
  }
  return out.length > 0 ? out : undefined;
}

function str(value: unknown, name: string, max = 200): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim())
    throw new ToolArgumentError(`${name} must be a non-empty string`);
  return value.trim().slice(0, max);
}

/** Builds the query filter from `history_query` arguments. */
export function historyFilterFromArgs(
  args: Record<string, unknown>,
  score: TrackScore,
): HistoryFilter {
  const filter: { -readonly [K in keyof HistoryFilter]: HistoryFilter[K] } = {};
  const kinds = enumList<HistoryKind>(args.kind, HISTORY_KINDS, "kind");
  if (kinds) filter.kinds = kinds;
  const actors = enumList<ActorKind>(args.actor, ACTOR_KINDS, "actor");
  if (actors) filter.actors = actors;
  const track = str(args.track, "track", 128);
  if (track) filter.track = resolveTrack(score, track);
  const instrument = str(args.instrument, "instrument", 64);
  if (instrument) filter.instrument = instrument;
  const param = str(args.param, "param", 128);
  if (param) filter.param = param;
  const tag = str(args.tag, "tag", 32);
  if (tag) filter.tag = tag.replace(/^#/, "").toLowerCase();
  const grep = str(args.grep, "grep", 200);
  if (grep) filter.grep = grep;
  const bars = str(args.bars, "bars", 16);
  if (bars) {
    const match = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(bars);
    if (!match) throw new ToolArgumentError('bars wants "A-B", e.g. "9-16"');
    const from = Number(match[1]);
    const to = Number(match[2] ?? match[1]);
    filter.bars = [Math.min(from, to), Math.max(from, to)];
  }
  const since = str(args.since, "since", 40);
  if (since) {
    const seq = /^seq:(\d+)$/.exec(since);
    if (seq) filter.sinceSeq = Number(seq[1]);
    else {
      const at = parseSince(since);
      if (at === undefined)
        throw new ToolArgumentError(
          'since wants "10m", "2h", "1d", an ISO time or "seq:N"',
        );
      filter.sinceAt = at;
    }
  }
  if (args.before !== undefined) {
    if (!Number.isInteger(args.before) || (args.before as number) < 1)
      throw new ToolArgumentError("before must be a row number (seq)");
    filter.beforeSeq = args.before as number;
  }
  const limit =
    args.limit === undefined ? HISTORY_TOOL_LIMITS.defaultRows : args.limit;
  if (
    !Number.isInteger(limit) ||
    (limit as number) < 1 ||
    (limit as number) > HISTORY_TOOL_LIMITS.maxRows
  )
    throw new ToolArgumentError(
      `limit must be 1..${HISTORY_TOOL_LIMITS.maxRows}`,
    );
  filter.limit = limit as number;
  return filter;
}

function trackNamer(score: TrackScore) {
  const names = new Map(
    (score.tracks as readonly { id: string; name?: string }[]).map((track) => [
      track.id,
      track.name ?? track.id,
    ]),
  );
  return (id: string) => names.get(id);
}

/**
 * One line per row, newest first, clipped to 6 KiB; a `next: before=<seq>`
 * line when more rows (or rows cut for size) remain.
 */
export function formatHistoryPage(
  rows: readonly HistoryRow[],
  next: number | undefined,
  score: TrackScore,
  maxBytes: number = HISTORY_TOOL_LIMITS.maxResultBytes,
): string {
  if (rows.length === 0) return "no history rows match";
  const trackName = trackNamer(score);
  const lines: string[] = [];
  let bytes = 0;
  let cutAt: number | undefined;
  for (const row of rows) {
    const line = formatRowShort(row, { width: 200, trackName });
    const size = Buffer.byteLength(line) + 1;
    if (bytes + size > maxBytes - 40) {
      cutAt = row.seq + 1;
      break;
    }
    lines.push(line);
    bytes += size;
  }
  const more = cutAt ?? next;
  if (more !== undefined) lines.push(`next: before=${more}`);
  return lines.join("\n");
}

const historyQueryTool: AgentTool = {
  name: "history_query",
  description:
    "Search this session's history (edits, undo/redo, comments, tool calls, dev logs): newest first, 20 one-line rows; show <id|seq> for one row in full, before to page.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "array",
        items: { type: "string", enum: [...HISTORY_KINDS] },
      },
      actor: {
        type: "array",
        items: { type: "string", enum: [...ACTOR_KINDS] },
      },
      track: { type: "string" },
      instrument: { type: "string" },
      param: { type: "string" },
      bars: { type: "string", description: "A-B" },
      tag: { type: "string" },
      grep: { type: "string" },
      since: { type: "string" },
      show: {
        type: "string",
        description: "event id or seq: full detail of one event",
      },
      before: { type: "integer", minimum: 1 },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: HISTORY_TOOL_LIMITS.maxRows,
      },
    },
    additionalProperties: false,
  },
  plan(args, toolContext) {
    const show = args.show === undefined ? undefined : str(args.show, "show", 64);
    const filter = show ? undefined : historyFilterFromArgs(args, toolContext.score);
    return {
      kind: "action",
      summary: show ? `history · show ${show}` : "history · query",
      async run(context): Promise<ActionResult> {
        const { history } = need(context);
        if (show !== undefined) {
          const row = findRow(history, show);
          if (!row) throw new ToolArgumentError(`no history row ${show}`);
          const detail = formatDetail(row, {
            trackName: trackNamer(toolContext.score),
          });
          return {
            content: clipBytes(detail, HISTORY_TOOL_LIMITS.maxResultBytes),
            summary: `history · #${row.seq}`,
          };
        }
        const page = history.query(filter!);
        return {
          content: formatHistoryPage(page.rows, page.next, toolContext.score),
          summary: `history · ${page.rows.length} rows`,
        };
      },
    };
  },
};

/** A row by seq (`812`, `#812`) or id / id prefix (≥ 6 chars). */
function findRow(history: HistoryHandle, ref: string): HistoryRow | undefined {
  const seq = /^#?(\d+)$/.exec(ref);
  if (seq) {
    const n = Number(seq[1]);
    const row = history.query({ beforeSeq: n + 1, limit: 1 }).rows[0];
    return row?.seq === n ? row : undefined;
  }
  // Ids are not a filter field; scan recent rows (bounded) for the prefix.
  let before: number | undefined;
  for (let page = 0; page < 10; page += 1) {
    const result = history.query({
      limit: 500,
      ...(before !== undefined ? { beforeSeq: before } : {}),
    });
    const hit = result.rows.find(
      (row) => row.id === ref || (ref.length >= 6 && row.id.startsWith(ref)),
    );
    if (hit) return hit;
    if (result.next === undefined) return undefined;
    before = result.next;
  }
  return undefined;
}

function clipBytes(text: string, max: number): string {
  if (Buffer.byteLength(text) <= max) return text;
  let out = text.slice(0, max);
  while (Buffer.byteLength(out) > max - 12) out = out.slice(0, -64);
  return `${out}\n… clipped`;
}

export const HISTORY_TOOLS: readonly AgentTool[] = [
  commentTool,
  historyQueryTool,
];

/** What the loops track per turn for the end-of-turn rows. */
export type TurnLedger = {
  /** Summaries of calls that moved the score revision. */
  edits: string[];
  /** A `comment` call succeeded this turn. */
  commented: boolean;
  /** Tool calls made. */
  calls: number;
};

export function newTurnLedger(): TurnLedger {
  return { edits: [], commented: false, calls: 0 };
}

/**
 * The fallback comment (design §3.4): a turn that committed at least one
 * revision without calling `comment` gets one, written by the host:
 * `sub='auto'`, tags `["auto"]`, body = the final reply clipped to 300
 * characters or, when empty, the joined edit summaries.
 */
export function autoCommentText(
  ledger: TurnLedger,
  finalText: string,
): string | undefined {
  if (ledger.edits.length === 0 || ledger.commented) return undefined;
  const text = (finalText.trim() || ledger.edits.join("; "))
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return text.length > HISTORY_TOOL_LIMITS.autoCommentChars
    ? `${text.slice(0, HISTORY_TOOL_LIMITS.autoCommentChars - 1)}…`
    : text;
}

/**
 * End-of-turn history for a top-level turn: the fallback comment, then the
 * `turn` row whose id was pre-assigned (`turnId`). Dispatch children skip
 * both: their parent records child turn rows and comments for the turn.
 * Never throws; history is observability.
 */
export function recordTurnEnd(input: {
  history: HistoryHandle | undefined;
  subagentId?: string;
  turnId: string;
  startRevision: number;
  ledger: TurnLedger;
  prompt: string;
  model: string;
  outcome: string;
  finalText: string;
  score?: TrackScore;
}): void {
  const history = input.history;
  if (!history || input.subagentId !== undefined) return;
  const turn: TurnInfo = { id: input.turnId, startRevision: input.startRevision };
  try {
    const text = autoCommentText(input.ledger, input.finalText);
    if (text !== undefined) {
      const parent = lastAgentEdit(history, turn);
      const written = appendAgentComment(history, {
        text,
        tags: ["auto"],
        turn,
        sub: "auto",
        ...(parent ? { parent } : { parentId: input.turnId }),
        ...(input.score ? { score: input.score } : {}),
      });
      void written.done.catch?.(() => undefined);
    }
  } catch {
    // never let history break a turn
  }
  try {
    const row = turnRow({
      id: input.turnId,
      prompt: input.prompt,
      model: input.model,
      steps: input.ledger.calls,
      spend: "-",
      outcome: input.outcome,
    });
    void history.append(row).done.catch(() => undefined);
  } catch {
    // ditto
  }
}

/**
 * The brief's "now and recent history" lines (design §4.2), ≤ 700 bytes:
 * the human's live context, the last 5 human comments and the last 3 edits
 * by others since the agent's last turn. Empty when there is no history.
 */
export function historyBriefSection(
  history: HistoryHandle | undefined,
  maxBytes: number = HISTORY_TOOL_LIMITS.briefBytes,
): string | undefined {
  if (!history) return undefined;
  try {
    const lines: string[] = [];
    const context = history.context();
    const now = [
      context.view?.screen ? `screen ${context.view.screen}` : undefined,
      context.focus?.trackName ?? context.focus?.trackId
        ? `focus ${context.focus?.trackName ?? context.focus?.trackId}${context.focus?.param ? `/${context.focus.param}` : ""}`
        : undefined,
      context.playhead ? `playhead ${context.playhead.label}` : undefined,
      context.loop ? `loop ${context.loop.label}` : undefined,
      context.transport
        ? `${context.transport.playing ? "playing" : "stopped"} ${context.transport.bpm} bpm`
        : undefined,
    ].filter(Boolean);
    if (now.length > 0) lines.push(`now: ${now.join(" · ")}`);
    const lastTurn = history.query({
      kinds: ["turn"],
      actors: ["agent"],
      limit: 1,
    }).rows[0];
    const comments = history.query({
      kinds: ["comment"],
      actors: ["human"],
      limit: 5,
    }).rows;
    for (const row of [...comments].reverse())
      lines.push(`human comment #${row.seq}: ${formatRowShort(row, { width: 120 })}`);
    const others = history.query({
      kinds: ["edit", "undo", "redo"],
      actors: ["human", "external"],
      limit: 3,
      ...(lastTurn ? { sinceSeq: lastTurn.seq } : {}),
    }).rows;
    for (const row of [...others].reverse())
      lines.push(`edit by ${row.actor.kind}: ${formatRowShort(row, { width: 120 })}`);
    if (lines.length === 0) return undefined;
    let text = lines.join("\n");
    while (Buffer.byteLength(text) > maxBytes && lines.length > 1) {
      lines.splice(1, 1);
      text = lines.join("\n");
    }
    return Buffer.byteLength(text) > maxBytes
      ? text.slice(0, maxBytes - 3)
      : text;
  } catch {
    return undefined;
  }
}
