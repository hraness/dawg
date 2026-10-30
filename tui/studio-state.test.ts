import { describe, expect, test } from "bun:test";
import {
  initialStudioState,
  reduceStudioState,
  type StudioState,
} from "./studio-state.ts";

describe("studio observer navigation", () => {
  test("overview initially follows the track the agent writes", () => {
    expect(initialStudioState.view).toBe("overview");
    const state = reduceStudioState(initialStudioState, {
      type: "agent-written",
      trackId: "bass",
    });
    expect(state).toMatchObject({
      view: "track",
      focusedTrackId: "bass",
      writtenTrackId: "bass",
      pinned: false,
    });
    expect(initialStudioState.view).toBe("overview");
  });

  test("manual inspection pins focus across agent writes; unpin returns to the latest written track", () => {
    let state = reduceStudioState(initialStudioState, {
      type: "focus",
      trackId: "voice",
    });
    state = reduceStudioState(state, {
      type: "agent-written",
      trackId: "bass",
    });
    state = reduceStudioState(state, {
      type: "agent-written",
      trackId: "drums",
    });
    expect(state).toMatchObject({
      focusedTrackId: "voice",
      writtenTrackId: "drums",
      pinned: true,
    });
    state = reduceStudioState(state, { type: "unpin" });
    expect(state).toMatchObject({
      view: "track",
      focusedTrackId: "drums",
      pinned: false,
    });
  });

  test("horizontal inspection is separate from track pinning and follows explicitly", () => {
    let state = reduceStudioState(initialStudioState, {
      type: "focus",
      trackId: "voice",
    });
    state = reduceStudioState(state, { type: "scroll", firstBeat: 80 });
    state = reduceStudioState(state, {
      type: "agent-written",
      trackId: "voice",
    });
    expect(state.firstBeat).toBe(80);
    state = reduceStudioState(state, { type: "follow" });
    expect(state.firstBeat).toBeUndefined();
    expect(state.pinned).toBe(true);
  });

  test("a new followed track resets the old horizontal range", () => {
    const state: StudioState = {
      view: "track",
      focusedTrackId: "bass",
      pinned: false,
      firstBeat: 80,
    };
    expect(
      reduceStudioState(state, { type: "agent-written", trackId: "drums" })
        .firstBeat,
    ).toBeUndefined();
    expect(
      reduceStudioState(state, { type: "agent-written", trackId: "bass" })
        .firstBeat,
    ).toBe(80);
  });

  test("removing a pinned track falls back to a surviving written track or overview", () => {
    const state: StudioState = {
      view: "track",
      focusedTrackId: "voice",
      writtenTrackId: "bass",
      pinned: true,
      firstBeat: 24,
    };
    expect(
      reduceStudioState(state, { type: "tracks", trackIds: ["bass"] }),
    ).toEqual({
      view: "track",
      focusedTrackId: "bass",
      writtenTrackId: "bass",
      pinned: false,
    });
    expect(
      reduceStudioState(state, { type: "tracks", trackIds: [] }),
    ).toMatchObject({ view: "overview", pinned: false });
    expect(
      reduceStudioState(state, { type: "tracks", trackIds: ["voice"] }),
    ).toMatchObject({
      focusedTrackId: "voice",
      pinned: true,
      firstBeat: 24,
      writtenTrackId: undefined,
    });
  });

  test("overview and invalid scroll requests have bounded predictable behavior", () => {
    const state = reduceStudioState(initialStudioState, {
      type: "focus",
      trackId: "bass",
    });
    expect(reduceStudioState(state, { type: "overview" })).toMatchObject({
      view: "overview",
      pinned: false,
      firstBeat: undefined,
    });
    expect(
      reduceStudioState(state, { type: "scroll", firstBeat: -5 }).firstBeat,
    ).toBe(0);
    expect(
      reduceStudioState(state, { type: "scroll", firstBeat: Infinity }),
    ).toBe(state);
    expect(reduceStudioState(initialStudioState, { type: "pin" })).toBe(
      initialStudioState,
    );
    expect(
      reduceStudioState(state, { type: "agent-written", trackId: "" }),
    ).toBe(state);
  });
});
