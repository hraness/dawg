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
  /**
   * A one-time info card (a launch note, a tip): it leaves the strip after
   * `ONCE_TTL_MS` or `ONCE_ACTIONS` later actions, whichever comes first.
   */
  once?: boolean | undefined;
  /** Repeats of the same text and tone, shown as `×N` (absent is 1). */
  count?: number | undefined;
  /** A quieter note joined to the card, e.g. the auto-name. */
  suffix?: string | undefined;
  /** `actions` when the card was pushed, for the `once` expiry. */
  atAction?: number | undefined;
}

/** A `once` card's lifetime in milliseconds. */
export const ONCE_TTL_MS = 8_000;
/** Actions (receipts, requests) after which a `once` card leaves. */
export const ONCE_ACTIONS = 3;
/** Age after which an older error fades to the faint role. */
export const ERROR_FADE_MS = 6_000;

/** One strip line: newlines read as ` · `, runs of space collapse. */
export function stripLine(text: string): string {
  return text
    .split(/\s*\n\s*/)
    .map((part) => part.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join(" · ");
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
  private turnReceipt = "";
  private queue = 0;
  /** Receipts and requests so far: the clock `once` cards expire on. */
  private actions = 0;
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

  /**
   * The cards the strip shows at `nowMs`, first slot first: the newest
   * receipt leads, live `once` notes follow it, and expired `once` notes
   * are gone.
   */
  visible(nowMs: number = this.clock()): ActivityCard[] {
    const live = this.cardList.filter(
      (card) =>
        !card.once ||
        (nowMs - card.atMs < ONCE_TTL_MS &&
          this.actions - (card.atAction ?? 0) < ONCE_ACTIONS),
    );
    const newest = [...live].reverse();
    return [
      ...newest.filter((card) => !card.once),
      ...newest.filter((card) => card.once),
    ];
  }

  /** The next time a `once` card expires on the clock, for frame wakeups. */
  nextExpiry(nowMs: number = this.clock()): number | undefined {
    let next: number | undefined;
    for (const card of this.cardList) {
      if (!card.once) continue;
      const at = card.atMs + ONCE_TTL_MS;
      if (at > nowMs && (next === undefined || at < next)) next = at;
    }
    return next;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  pushCard(
    text: string,
    details: Omit<Partial<ActivityCard>, "id" | "atMs" | "text"> = {},
  ): ActivityCard {
    const line = stripLine(text);
    const once = details.once === true;
    if (!once) this.actions += 1;
    const last = this.cardList[this.cardList.length - 1];
    const tone = details.tone ?? "info";
    // The same message again reads `×N` instead of filling the strip.
    if (
      last &&
      last.text === line &&
      last.tone === tone &&
      last.resultRevision === details.resultRevision
    ) {
      const repeat: ActivityCard = {
        ...last,
        count: (last.count ?? 1) + 1,
        atMs: this.clock(),
        atAction: this.actions,
      };
      this.cardList = [...this.cardList.slice(0, -1), repeat];
      this.record(tone === "error" ? "error" : "op", line);
      this.changed();
      return repeat;
    }
    const card: ActivityCard = {
      id: this.nextId++,
      text: line,
      tone,
      atMs: this.clock(),
      baseRevision: details.baseRevision,
      resultRevision: details.resultRevision,
      trackId: details.trackId,
      hint: details.hint,
      ...(once ? { once: true } : {}),
      ...(details.suffix ? { suffix: stripLine(details.suffix) } : {}),
      atAction: this.actions,
    };
    this.cardList = [...this.cardList, card].slice(-this.maxCards);
    const revision = revisionLabel(card.baseRevision, card.resultRevision);
    this.record(
      card.tone === "error" ? "error" : "op",
      revision ? `${line} · ${revision}` : line,
    );
    this.changed();
    return card;
  }

  /**
   * Join a quiet note to the newest receipt (`… · named "dusk loop"`), so
   * it rides in the first slot instead of pushing the receipt aside. With
   * no receipt in the last few seconds it becomes a `once` card.
   */
  attachNote(text: string, withinMs = ONCE_TTL_MS): ActivityCard {
    const line = stripLine(text);
    const last = this.cardList[this.cardList.length - 1];
    if (
      last &&
      !last.once &&
      last.tone !== "error" &&
      this.clock() - last.atMs < withinMs
    ) {
      const joined: ActivityCard = {
        ...last,
        suffix: last.suffix ? `${last.suffix} · ${line}` : line,
      };
      this.cardList = [...this.cardList.slice(0, -1), joined];
      this.record("note", line);
      this.changed();
      return joined;
    }
    return this.pushCard(line, { tone: "info", once: true });
  }

  pushError(message: string): ActivityCard {
    return this.pushCard(message, { tone: "error" });
  }

  /** Record a user request in the transcript without adding a strip card. */
  pushRequest(text: string): void {
    this.actions += 1;
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

  /**
   * The musical receipt of the running agent turn (`musicalReceipt` of the
   * score before and after), shown as the turn's closing card.
   */
  setTurnReceipt(text: string): void {
    this.turnReceipt = text;
  }

  /**
   * The latest prose sentence of the streaming agent text, for the faint
   * tail of the spinner: a complete sentence when one has ended, else the
   * one being written.
   */
  get streamSentence(): string {
    return latestSentence(this.streamText);
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
          hint: unchanged ? undefined : "ctrl-z undo",
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
        // A turn that changed the music ends on what it changed, in musical
        // terms; its prose stays in the ctrl-o log.
        const receipt = this.turnReceipt;
        this.turnReceipt = "";
        const summary =
          receipt ||
          event.summary ||
          firstSentence(event.text ?? "").slice(0, 160) ||
          undefined;
        if (summary)
          this.pushCard(summary, {
            tone: "agent",
            hint: receipt ? "ctrl-z undo" : undefined,
          });
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
            `canceled${event.revision === undefined ? "" : ` · kept rev ${event.revision}`}`,
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

/** The first sentence of a reply (up to its first `.`, `!` or `?`). */
export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const match = /^.*?[.!?](?=\s|$)/.exec(flat);
  return (match ? match[0] : flat).trim();
}

/** The last complete sentence of streaming text, or the one in progress. */
export function latestSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const sentences = flat.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [flat];
  const last = sentences[sentences.length - 1]!.trim();
  // A fragment of a few words reads as noise; keep the sentence before it.
  if (
    !/[.!?]$/.test(last) &&
    last.split(" ").length < 4 &&
    sentences.length > 1
  )
    return sentences[sentences.length - 2]!.trim();
  return last;
}
