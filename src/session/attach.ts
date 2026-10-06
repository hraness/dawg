/**
 * Glue between the TUI and sessions: resolving `--session <name|id>`,
 * choosing a track for a newly opened window, materializing draft tracks,
 * forking, and the auto-namer's port-backed target. Kept out of main.ts so
 * the entry point only wires these together.
 */
import { isDrumInstrument } from "../../core/drums.ts";
import type { TrackScore } from "../../core/score.ts";
import {
  ambiguousSessionMessage,
  listSessions,
  resolveSession,
  type SessionSummary,
} from "./list.ts";
import {
  forkName,
  normalizeSessionName,
  uniqueName,
  type SessionMeta,
} from "./meta.ts";
import type { NamingTarget } from "./naming.ts";
import type { SessionPort } from "./port.ts";
import {
  createForkSession,
  setCurrentSession,
  type SessionRecord,
} from "./store.ts";

export const ALL_TRACKS_OPEN_HINT = "all tracks open · new track";

export class SessionLookupError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SessionLookupError";
  }
}

/**
 * Maps `--session <name|id>` to a session id. Unknown values pass through
 * unchanged when they are valid ids (a new session with that id is created);
 * an ambiguous name throws with the candidate list.
 */
export async function resolveSessionArg(
  workspace: string,
  query: string,
  sessions?: readonly SessionSummary[],
): Promise<string> {
  const listed = sessions ?? (await listSessions(workspace));
  const result = resolveSession(listed, query);
  if (result.status === "found") return result.session.sessionId;
  if (result.status === "ambiguous")
    throw new SessionLookupError(
      ambiguousSessionMessage(query, result.candidates),
    );
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(query)) return query;
  throw new SessionLookupError(`no session named "${query}"`);
}

export type TrackAttachment = {
  trackId: string;
  /** Reserved id not yet in the score; created on the first edit. */
  draft: boolean;
  /** How the track was chosen, for the activity strip. */
  reason: "explicit" | "claimed" | "draft";
};

/**
 * `--track` always wins (focus is published but not exclusive). Otherwise
 * atomically claim the first track no live window has focused, or a draft.
 */
export async function attachTrack<T>(
  port: SessionPort<T>,
  score: TrackScore,
  explicit: string | undefined,
): Promise<TrackAttachment> {
  if (explicit !== undefined) {
    await port.focus(explicit).catch(() => undefined);
    return { trackId: explicit, draft: false, reason: "explicit" };
  }
  const claim = await port.claimOrDraft(score.tracks.map((track) => track.id));
  return {
    trackId: claim.trackId,
    draft: claim.draft,
    reason: claim.draft ? "draft" : "claimed",
  };
}

/** Score with `trackId` present: a draft becomes a real track here. */
export function withTrack(score: TrackScore, trackId: string): TrackScore {
  if (score.tracks.some((track) => track.id === trackId)) return score;
  const draft = trackId.match(/^track-(\d+)$/);
  return score.withTracks([
    ...score.tracks,
    {
      id: trackId,
      name: draft ? `track ${draft[1]}` : trackId,
      instrument: isDrumInstrument(trackId) ? "kit" : "sine",
    },
  ]);
}

/** Copies `source` into a new session named per the fork rules. */
export async function forkSession<T>(
  workspace: string,
  source: SessionRecord<T>,
  requested: string | undefined,
): Promise<SessionRecord<T>> {
  const others = (await listSessions(workspace))
    .filter((session) => !session.error)
    .map((session) => session.name);
  const name =
    requested !== undefined && requested.trim().length > 0
      ? uniqueName(normalizeSessionName(requested), others)
      : forkName(source.meta.name, others);
  const record = await createForkSession(workspace, source, name);
  await setCurrentSession(workspace, record.sessionId);
  return record;
}

/** The auto-namer's view of the live session. */
export function namingTarget<T>(
  workspace: string,
  current: () => { port: SessionPort<T>; record: SessionRecord<T> },
  adopt: (meta: SessionMeta) => void,
): NamingTarget {
  return {
    meta: () => current().record.meta,
    updateMeta: async (patch, expect) => {
      const result = await current().port.updateMeta(patch, expect);
      adopt(result.meta);
      return result;
    },
    otherNames: async () => {
      const id = current().record.sessionId;
      return (await listSessions(workspace))
        .filter((session) => !session.error && session.sessionId !== id)
        .map((session) => session.name);
    },
  };
}

/** `/resume` picker text: numbered recent sessions. */
export function pickerLines(
  sessions: readonly SessionSummary[],
  currentId: string,
  format: (session: SessionSummary) => string,
  limit = 9,
): string[] {
  return sessions
    .filter((session) => !session.error)
    .slice(0, limit)
    .map(
      (session, index) =>
        `${index + 1}${session.sessionId === currentId ? "*" : " "} ${format(session)}`,
    );
}
