/**
 * Activity feed: the strip under the hit line and the transcript overlay.
 *
 * Other subsystems describe what happened; the TUI decides how to show it.
 *   - Command handlers push receipts (`pushCard`) and errors (`pushError`).
 *   - The agent lane forwards streaming events through `applyAgentEvent`.
 *   - A spinner (`setSpinner`) shows that work is in flight.
 *
 * The feed is plain data with an injectable clock, so tests can assert exact
 * strip contents without timers.
 */

export type CardTone = "info" | "success" | "warning" | "error" | "agent";

export interface ActivityCard {
  id: number;
  /** Short operation summary, e.g. "+8 bass notes". */
  text: string;
  tone: CardTone;
  atMs: number;
  baseRevision?: number | undefined;
  resultRevision?: number | undefined;
  trackId?: string | undefined;
  /** Key hint shown after the card, e.g. "u undo". */
  hint?: string | undefined;
}

export type TranscriptKind =
  "request" | "op" | "revision" | "error" | "agent" | "note";

export interface TranscriptEntry {
  id: number;
  kind: TranscriptKind;
  text: string;
  atMs: number;
}

/**
 * Streaming agent events.  Structurally compatible with `AgentEvent` from
 * src/agent/agent.ts (`delta`, `diagnostic`, `text`, `code`), so the agent lane
 * forwards events unchanged; the shorter aliases (`text`, `reason`, `summary`)
 * are accepted for other producers.
 */
export type AgentActivityEvent =
  | { type: "start"; prompt?: string | undefined; model?: string | undefined }
  | { type: "step"; step: number }
  | { type: "text-delta"; delta?: string; text?: string }
  | { type: "activity"; message: string }
  | { type: "tool-start"; name: string; callId?: string; step?: number }
  | { type: "tool-progress"; line: string; name?: string; callId?: string }
  | {
      type: "tool-applied";
      summary: string;
      name?: string;
      callId?: string;
      baseRevision?: number | undefined;
      resultRevision?: number | undefined;
      trackId?: string | undefined;
    }
  | {
      type: "tool-rejected";
      name?: string;
      callId?: string;
      diagnostic?: string;
      summary?: string | undefined;
      reason?: string;
    }
  | {
      type: "done";
      summary?: string | undefined;
      text?: string;
      applied?: number;
      rejected?: number;
      revision?: number;
    }
  | {
      type: "error";
      message: string;
      code?: string;
      applied?: number;
      revision?: number;
    };

export interface ActivityOptions {
  clock?: () => number;
  /** Cards kept for the strip. */
  maxCards?: number;
  /** Entries kept for the transcript overlay. */
  maxTranscript?: number;
}

export const BRAILLE_SPINNER = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;
export const ASCII_SPINNER = ["-", "\\", "|", "/"] as const;

export function spinnerFrame(
  nowMs: number,
  unicode: boolean,
  reducedMotion = false,
): string {
  const frames = unicode ? BRAILLE_SPINNER : ASCII_SPINNER;
  if (reducedMotion) return unicode ? "…" : "~";
  return frames[Math.floor(nowMs / 80) % frames.length]!;
}

/** Format a revision transition, e.g. "rev 41→42". */
export function revisionLabel(
  base: number | undefined,
  result: number | undefined,
  unicode = true,
): string | undefined {
  if (result === undefined) return undefined;
  if (base === undefined || base === result) return `rev ${result}`;
  return `rev ${base}${unicode ? "→" : "->"}${result}`;
}

export class ActivityFeed {
  private nextId = 1;
  private readonly clock: () => number;
  private readonly maxCards: number;
  private readonly maxTranscript: number;
  private cardList: ActivityCard[] = [];
  private log: TranscriptEntry[] = [];
  private spinnerLabel: string | undefined;
  private spinnerSince = 0;
  private streamText = "";
  private queue = 0;
  private listeners = new Set<() => void>();
  /** Increments on every change; renderers can skip work when unchanged. */
  version = 0;

  constructor(options: ActivityOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.maxCards = options.maxCards ?? 6;
    this.maxTranscript = options.maxTranscript ?? 200;
  }

  get cards(): readonly ActivityCard[] {
    return this.cardList;
  }
  get transcript(): readonly TranscriptEntry[] {
    return this.log;
  }
  get spinner(): { label: string; sinceMs: number } | undefined {
    return this.spinnerLabel === undefined
      ? undefined
      : { label: this.spinnerLabel, sinceMs: this.spinnerSince };
  }
  /** Latest streamed agent text (single line, newest tail kept). */
  get streaming(): string {
    return this.streamText;
  }
  get queueDepth(): number {
    return this.queue;
  }
  get latest(): ActivityCard | undefined {
    return this.cardList[this.cardList.length - 1];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  pushCard(
    text: string,
    details: Omit<Partial<ActivityCard>, "id" | "atMs" | "text"> = {},
  ): ActivityCard {
    const card: ActivityCard = {
      id: this.nextId++,
      text,
      tone: details.tone ?? "info",
      atMs: this.clock(),
      baseRevision: details.baseRevision,
      resultRevision: details.resultRevision,
      trackId: details.trackId,
      hint: details.hint,
    };
    this.cardList = [...this.cardList, card].slice(-this.maxCards);
    const revision = revisionLabel(card.baseRevision, card.resultRevision);
    this.record(
      card.tone === "error" ? "error" : "op",
      revision ? `${text} · ${revision}` : text,
    );
    this.changed();
    return card;
  }

  pushError(message: string): ActivityCard {
    return this.pushCard(message, { tone: "error" });
  }

  /** Record a user request in the transcript without adding a strip card. */
  pushRequest(text: string): void {
    this.record("request", text);
    this.changed();
  }

  pushNote(text: string, kind: TranscriptKind = "note"): void {
    this.record(kind, text);
    this.changed();
  }

  setSpinner(label: string | undefined): void {
    if (label === this.spinnerLabel) return;
    if (label !== undefined && this.spinnerLabel === undefined)
      this.spinnerSince = this.clock();
    this.spinnerLabel = label;
    if (label === undefined) this.streamText = "";
    this.changed();
  }

  setQueueDepth(depth: number): void {
    const next = Math.max(0, Math.floor(depth));
    if (next === this.queue) return;
    this.queue = next;
    this.changed();
  }

  /** Adapter for the agent lane's streaming events. */
  applyAgentEvent(event: AgentActivityEvent): void {
    switch (event.type) {
      case "start":
        this.streamText = "";
        if (event.prompt) this.record("request", event.prompt);
        this.setSpinner(event.model ? `thinking · ${event.model}` : "thinking");
        return;
      case "step":
        this.setSpinner(
          event.step <= 1 ? "thinking" : `thinking · step ${event.step}`,
        );
        return;
      case "activity":
        this.setSpinner(event.message);
        return;
      case "text-delta": {
        const chunk = event.delta ?? event.text ?? "";
        const joined = `${this.streamText}${chunk}`.replace(/\s+/g, " ");
        this.streamText = joined.slice(-240);
        if (this.spinnerLabel === undefined) this.setSpinner("thinking");
        this.changed();
        return;
      }
      case "tool-start":
        this.setSpinner(`${event.name.replace(/_/g, " ")}…`);
        return;
      case "tool-progress":
        this.setSpinner(
          event.name
            ? `${event.name.replace(/_/g, " ")} · ${event.line}`
            : event.line,
        );
        return;
      case "tool-applied": {
        // A media or explain result leaves the revision alone: nothing to undo.
        const unchanged =
          event.baseRevision !== undefined &&
          event.baseRevision === event.resultRevision;
        this.pushCard(event.summary, {
          tone: "success",
          baseRevision: event.baseRevision,
          resultRevision: event.resultRevision,
          trackId: event.trackId,
          hint: unchanged ? undefined : "^z undo",
        });
        return;
      }
      case "tool-rejected": {
        const what = event.summary ?? event.name?.replace(/_/g, " ");
        const why = event.reason ?? event.diagnostic;
        this.pushCard(
          `rejected${what ? ` · ${what}` : ""}${why ? ` · ${why}` : ""}`,
          { tone: "warning" },
        );
        return;
      }
      case "done": {
        if (this.streamText) this.record("agent", this.streamText);
        this.streamText = "";
        const summary =
          event.summary ?? event.text?.split("\n")[0]?.slice(0, 160);
        if (summary) this.pushCard(summary, { tone: "agent" });
        else if (event.applied === 0)
          this.pushCard("agent made no changes", { tone: "info" });
        this.setSpinner(undefined);
        return;
      }
      case "error":
        this.streamText = "";
        this.setSpinner(undefined);
        if (event.code === "aborted")
          this.pushCard(
            `cancelled${event.revision === undefined ? "" : ` · kept rev ${event.revision}`}`,
            { tone: "warning" },
          );
        else
          this.pushError(
            event.code
              ? `agent ${event.code}: ${event.message}`
              : event.message,
          );
        return;
    }
  }

  private record(kind: TranscriptKind, text: string): void {
    this.log = [
      ...this.log,
      { id: this.nextId++, kind, text, atMs: this.clock() },
    ].slice(-this.maxTranscript);
  }

  private changed(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

/**
 * A command receipt with its outcome carried structurally: `ok: true` is a
 * success, `false` a failure, `"warn"` a no-op or conflict. Handlers return
 * these so the strip never infers failure from prose.
 */
export type Receipt = Readonly<{ ok: boolean | "warn"; text: string }>;

export const ok = (text: string): Receipt => ({ ok: true, text });
export const fail = (text: string): Receipt => ({ ok: false, text });
export const warn = (text: string): Receipt => ({ ok: "warn", text });

/** Tone of a structured receipt; strings fall back to `receiptTone`. */
export function toneOf(receipt: string | Receipt): CardTone {
  if (typeof receipt === "string") return receiptTone(receipt);
  return receipt.ok === true
    ? "success"
    : receipt.ok === "warn"
      ? "warning"
      : "error";
}

/**
 * Classify a legacy command receipt string (e.g. "undid · rev 41",
 * "tempo error · …") into a card tone. Fallback for handlers that still
 * return plain strings; new handlers return a `Receipt`.
 */
export function receiptTone(message: string): CardTone {
  const lower = message.toLowerCase();
  if (
    /\berror\b|unrecognized|failed|invalid|cannot|can't|not found/.test(lower)
  )
    return "error";
  if (/nothing to|conflict|changed; retry|exists|another window/.test(lower))
    return "warning";
  return "success";
}
