import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import type { ClickBus } from "../audio/engine.ts";
import type { LiveNotePcm } from "../audio/live.ts";
import { LiveHost, type LiveSink } from "./live-host.ts";

class FakeSink implements LiveSink {
  public readonly sampleRate = 8_000;
  public readonly canMonitor = true;
  public leadMs = 60;
  public readonly playLeadMs = 15;
  public monitors: boolean[] = [];
  public on = new Map<number, LiveNotePcm>();
  public offs: number[] = [];
  public click: ClickBus | undefined;
  public clickSets = 0;
  public async monitor(on: boolean) {
    this.monitors.push(on);
  }
  public setLeadMs(ms: number | undefined) {
    this.leadMs = ms ?? 60;
  }
  public noteOn(id: number, note: LiveNotePcm) {
    this.on.set(id, note);
    return 0;
  }
  public noteOff(id: number) {
    this.offs.push(id);
  }
  public setClick(click: ClickBus | undefined) {
    this.click = click;
    this.clickSets += 1;
  }
}

function host(sink = new FakeSink(), playing = true) {
  const score = createScore({
    tracks: [
      { id: "bass", name: "bass", instrument: "sine" },
      { id: "drums", name: "drums", instrument: "sine" },
    ],
  });
  return {
    sink,
    live: new LiveHost({
      sink,
      score: () => score,
      transportBeatAt: (ms) => (playing ? ms / 500 : undefined),
      toMonotonic: (ms) => ms,
    }),
  };
}

const note = (voice: number, trackId: string) =>
  ({
    v: 1,
    type: "live",
    action: "on",
    voice,
    trackId,
    pitch: 48,
    velocity: 0.8,
    seconds: 0.1,
    beat: 0,
    atMs: 0,
  }) as const;

describe("LiveHost", () => {
  test("one engine monitor for any number of panes", async () => {
    const { sink, live } = host();
    await live.handle("a", {
      v: 1,
      type: "live",
      action: "monitor",
      id: "1",
      on: true,
    });
    await live.handle("b", {
      v: 1,
      type: "live",
      action: "monitor",
      id: "2",
      on: true,
    });
    expect(sink.monitors).toEqual([true]);
    expect(sink.leadMs).toBe(15);
    await live.handle("a", {
      v: 1,
      type: "live",
      action: "monitor",
      id: "3",
      on: false,
    });
    expect(sink.monitors).toEqual([true]);
    await live.drop("b");
    expect(sink.monitors).toEqual([true, false]);
    expect(sink.leadMs).toBe(60);
  });

  test("voice ids are namespaced per pane", async () => {
    const { sink, live } = host();
    await live.handle("a", note(1, "bass"));
    await live.handle("b", note(1, "drums"));
    expect(sink.on.size).toBe(2);
    await live.handle("a", {
      v: 1,
      type: "live",
      action: "off",
      voice: 1,
      atMs: 0,
    });
    expect(sink.offs).toHaveLength(1);
    await live.drop("b");
    expect(sink.offs).toHaveLength(2);
    // A note on a track the score lacks makes no sound.
    await live.handle("a", note(2, "ghost"));
    expect(sink.on.size).toBe(2);
  });

  test("one click while any pane wants it", async () => {
    const { sink, live } = host();
    const click = (on: boolean) =>
      ({ v: 1, type: "live", action: "click", on, volume: 0.5 }) as const;
    await live.handle("a", click(true));
    await live.handle("b", click(true));
    expect(sink.click).toBeDefined();
    await live.handle("a", click(false));
    expect(sink.click).toBeDefined();
    expect(sink.click!.beatAt(1000)).toBe(2);
    await live.handle("b", click(false));
    expect(sink.click).toBeUndefined();
  });

  test("a count-in clicks before the transport takes over", async () => {
    const { sink, live } = host(new FakeSink(), false);
    await live.handle("a", {
      v: 1,
      type: "live",
      action: "click",
      on: false,
      volume: 0.5,
      countIn: {
        startAtMs: 1000,
        startBeat: 8,
        beats: 4,
        barBeats: 4,
        clickBeats: 1,
        bpm: 120,
      },
    });
    expect(sink.click!.beatAt(1000)).toBe(4);
    expect(sink.click!.beatAt(2000)).toBe(6);
    // Past the count-in, with the click off, it falls silent.
    expect(sink.click!.beatAt(4000)).toBeUndefined();
  });
});
