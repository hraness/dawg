/** Read-only studio navigation. A pin belongs to the person, never the agent. */
export type StudioState = Readonly<{
  view: "overview" | "track";
  focusedTrackId?: string;
  writtenTrackId?: string;
  pinned: boolean;
  /** Set only while inspecting a horizontal range; absent follows the cursor. */
  firstBeat?: number;
}>;

export const initialStudioState: StudioState = Object.freeze({
  view: "overview",
  pinned: false,
});

export type StudioEvent =
  | Readonly<{ type: "overview" }>
  | Readonly<{ type: "agent-written"; trackId: string }>
  | Readonly<{ type: "focus"; trackId: string; pin?: boolean }>
  | Readonly<{ type: "pin" | "unpin" | "follow" }>
  | Readonly<{ type: "scroll"; firstBeat: number }>
  | Readonly<{ type: "tracks"; trackIds: readonly string[] }>;

export function reduceStudioState(
  state: StudioState,
  event: StudioEvent,
): StudioState {
  switch (event.type) {
    case "overview":
      return {
        ...state,
        view: "overview",
        pinned: false,
        firstBeat: undefined,
      };
    case "agent-written":
      if (!event.trackId) return state;
      if (state.pinned) return { ...state, writtenTrackId: event.trackId };
      return {
        ...state,
        view: "track",
        focusedTrackId: event.trackId,
        writtenTrackId: event.trackId,
        firstBeat:
          state.focusedTrackId === event.trackId ? state.firstBeat : undefined,
      };
    case "focus":
      if (!event.trackId) return state;
      return {
        ...state,
        view: "track",
        focusedTrackId: event.trackId,
        pinned: event.pin ?? true,
        firstBeat:
          state.focusedTrackId === event.trackId ? state.firstBeat : undefined,
      };
    case "pin":
      return state.view === "track" && state.focusedTrackId
        ? { ...state, pinned: true }
        : state;
    case "unpin":
      return {
        ...state,
        pinned: false,
        ...(state.writtenTrackId
          ? {
              view: "track",
              focusedTrackId: state.writtenTrackId,
              firstBeat:
                state.writtenTrackId === state.focusedTrackId
                  ? state.firstBeat
                  : undefined,
            }
          : {}),
      };
    case "scroll":
      return Number.isFinite(event.firstBeat)
        ? { ...state, firstBeat: Math.max(0, event.firstBeat) }
        : state;
    case "follow":
      return { ...state, firstBeat: undefined };
    case "tracks": {
      const present = new Set(event.trackIds);
      const writtenTrackId =
        state.writtenTrackId && present.has(state.writtenTrackId)
          ? state.writtenTrackId
          : undefined;
      if (state.focusedTrackId && present.has(state.focusedTrackId))
        return { ...state, writtenTrackId };
      return {
        view: writtenTrackId ? "track" : "overview",
        focusedTrackId: writtenTrackId,
        writtenTrackId,
        pinned: false,
      };
    }
  }
}
