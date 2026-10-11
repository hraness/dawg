import { describe, expect, test } from "bun:test";
import { emptyScore, type TrackScore } from "../../core/score.ts";
import { captureContext } from "./context.ts";
import { contextSource, gestureSelection, type HistoryHost } from "./wire.ts";

function band(): TrackScore {
  let score = emptyScore().withTracks([
    { id: "bass", instrument: "bass" },
    { id: "keys", instrument: "piano" },
  ]);
  const bar = score.ticksPerBeat * 4;
  for (let index = 0; index < 8; index += 1)
    score = score.addNote({
      id: `n${index}`,
      trackId: index % 2 === 0 ? "bass" : "keys",
      startTick: index * (bar / 2),
      durationTicks: 96,
      pitch: 40 + index,
      velocity: 0.7,
    });
  return score;
}

function host(over: Partial<HistoryHost> = {}): HistoryHost {
  const score = band().withLoop({ startBar: 1, bars: 2 });
  return {
    workspace: "/nowhere",
    sessionId: () => "s1",
    revision: () => 7,
    score: () => score,
    clientId: () => "c1",
    actorId: () => undefined,
    presence: () => undefined,
    focusedTrack: () => "bass",
    playheadBeat: () => 5,
    playing: () => false,
    focusedParam: () => undefined,
    patchNode: () => undefined,
    screen: () => "home",
    ascii: () => false,
    ...over,
  };
}

describe("a comment captures the selection and patch focus", () => {
  test("the selection is the gesture range over the focused track", () => {
    const looped = band().withLoop({ startBar: 1, bars: 2 });
    expect(gestureSelection(looped, "bass", 0)).toEqual({
      trackId: "bass",
      fromBeat: 4,
      toBeat: 12,
      notes: 2,
    });
    // No loop: the playhead's bar.
    expect(gestureSelection(band(), "keys", 13)).toEqual({
      trackId: "keys",
      fromBeat: 12,
      toBeat: 16,
      notes: 1,
    });
    expect(gestureSelection(band(), "nope", 0)).toBeUndefined();
  });

  test("captured context carries selection, patch node and param", () => {
    const context = captureContext(
      contextSource(
        host({
          screen: () => "patch",
          patchNode: () => "osc",
          focusedParam: () => "osc.wave",
        }),
      ),
    );
    expect(context.selection).toEqual({
      trackId: "bass",
      fromBeat: 4,
      toBeat: 12,
      notes: 2,
    });
    expect(context.focus?.node).toBe("osc");
    expect(context.focus?.param).toBe("osc.wave");
  });
});
