/**
 * Cross-track references (0.7). A track field that names another track (the
 * vocoder's `src`, autotune's `from`, 0.7.1 harmony's `guide`) registers
 * here once, at module load, with the edges it reads and how it forgets a
 * removed track. `removeTrack` then drops dangling references, the renderer
 * orders stems with `routingOrder`, and stem digests include the notes a
 * track follows through `notesDigestInputs`.
 *
 * Audio edges carry rendered sound (the target must render first, and a
 * cycle is an error). Notes edges only read the other track's notes, so
 * they never order rendering and never form a cycle.
 */
import {
  registerTrackRefDrop,
  ScoreValidationError,
  type Note,
  type Track,
  type TrackScore,
} from "./score.ts";
import { trackSlug } from "./slug.ts";

export type TrackRefKind = "audio" | "notes";

/** One reference from a track to another track. */
export type TrackRef = Readonly<{ trackId: string; kind: TrackRefKind }>;

export type TrackRefSpec = Readonly<{
  /** The tracks `track` references through this field. */
  refs(track: Track): readonly TrackRef[];
  /** `track` without its references to `removedId`. */
  drop(track: Track, removedId: string): Track;
}>;

const specs = new Map<string, TrackRefSpec>();

/** Registers a referencing field once; registering it again replaces it. */
export function registerTrackRefs(field: string, spec: TrackRefSpec): void {
  specs.set(field, spec);
  registerTrackRefDrop(field, spec.drop);
}

/** Every reference `track` holds, in field registration order. */
export function trackRefs(track: Track): readonly TrackRef[] {
  const refs: TrackRef[] = [];
  for (const spec of specs.values()) refs.push(...spec.refs(track));
  return refs;
}

/**
 * Finds a track by id, then by name slug (`Lead Vox` and `lead-vox` both
 * match). Returns undefined when nothing matches.
 */
export function resolveTrackRef(
  score: TrackScore,
  idOrSlug: string,
): Track | undefined {
  const byId = score.tracks.find((track) => track.id === idOrSlug);
  if (byId) return byId;
  const slug = trackSlug(idOrSlug);
  return score.tracks.find((track) => trackSlug(track.name) === slug);
}

/**
 * Track ids in render order: every audio source before the tracks that
 * read it, otherwise score order. References to missing tracks are ignored.
 * A cycle throws a ScoreValidationError that names it (`a -> b -> a`).
 */
export function routingOrder(score: TrackScore): readonly string[] {
  const ids = new Set(score.tracks.map((track) => track.id));
  const sources = new Map<string, string[]>();
  for (const track of score.tracks)
    sources.set(
      track.id,
      trackRefs(track)
        .filter((ref) => ref.kind === "audio" && ids.has(ref.trackId))
        .map((ref) => ref.trackId),
    );
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (id: string): void => {
    const seen = state.get(id);
    if (seen === "done") return;
    if (seen === "visiting") {
      const cycle = [...stack.slice(stack.indexOf(id)), id];
      throw new ScoreValidationError(
        `track routing has a cycle: ${cycle.join(" -> ")}`,
        "routing-cycle",
      );
    }
    state.set(id, "visiting");
    stack.push(id);
    for (const source of sources.get(id) ?? []) visit(source);
    stack.pop();
    state.set(id, "done");
    order.push(id);
  };
  for (const track of score.tracks) visit(track.id);
  return order;
}

/**
 * The notes a track's render depends on through notes edges, by referenced
 * track id (sorted, deduplicated), for its stem digest. Missing tracks and
 * self references contribute nothing.
 */
export function notesDigestInputs(
  score: TrackScore,
  trackId: string,
): readonly Readonly<{ trackId: string; notes: readonly Note[] }>[] {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return [];
  const ids = new Set(score.tracks.map((candidate) => candidate.id));
  const followed = [
    ...new Set(
      trackRefs(track)
        .filter(
          (ref) =>
            ref.kind === "notes" &&
            ref.trackId !== trackId &&
            ids.has(ref.trackId),
        )
        .map((ref) => ref.trackId),
    ),
  ].sort();
  return followed.map((id) => ({
    trackId: id,
    notes: score.notes.filter((note) => note.trackId === id),
  }));
}

/**
 * The vocoder's modulator (0.7): `vocoder.src` is an audio edge, so the
 * modulator renders first and removing it drops the `src` (the carrier then
 * plays dry until a new source is set).
 */
registerTrackRefs("vocoder", {
  refs: (track) =>
    track.vocoder?.src !== undefined
      ? [{ trackId: track.vocoder.src, kind: "audio" }]
      : [],
  drop: (track, removedId) => {
    if (track.vocoder?.src !== removedId) return track;
    const { src: _src, ...rest } = track.vocoder;
    return { ...track, vocoder: rest };
  },
});

// ---------------------------------------------------------------------------
// Registered reference fields (one block per lane).

// autotune: `Track.autotune.from` follows another track's notes.
registerTrackRefs("autotune.from", {
  refs: (track) =>
    track.autotune?.from !== undefined
      ? [{ trackId: track.autotune.from, kind: "notes" }]
      : [],
  drop: (track, removedId) => {
    if (track.autotune?.from !== removedId) return track;
    // Without its melody the track follows its own notes; `to` and the
    // preset stay as the user set them.
    const { from: _from, ...autotune } = track.autotune;
    return { ...track, autotune };
  },
});
