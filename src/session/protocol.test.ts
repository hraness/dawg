import { describe, expect, test } from "bun:test";
import {
  DEFAULT_QUANTUM,
  negotiateProtocol,
  parseClientMessage,
  parseServerMessage,
  ProtocolError,
  toLocalTransport,
} from "./protocol.ts";

const ACTOR = `a_${"c".repeat(22)}`;

describe("protocol revisions", () => {
  test("negotiates the highest shared revision", () => {
    expect(negotiateProtocol()).toBe(1);
    expect(negotiateProtocol(1, 1)).toBe(1);
    expect(negotiateProtocol(1, 9)).toBe(2);
    expect(negotiateProtocol(2, 2)).toBe(2);
    expect(negotiateProtocol(3, 4)).toBeUndefined();
  });

  test("hello carries the version range, caps and actor", () => {
    const hello = parseClientMessage(
      JSON.stringify({
        v: 1,
        type: "hello",
        pid: 1,
        label: "pane",
        clientId: "c1",
        focusedTrackId: null,
        vMin: 1,
        vMax: 2,
        caps: ["actor", "seq"],
        actorId: ACTOR,
      }),
    );
    expect(hello).toMatchObject({ vMin: 1, vMax: 2, actorId: ACTOR });
    expect(() =>
      parseClientMessage(
        JSON.stringify({
          v: 1,
          type: "hello",
          pid: 1,
          label: "pane",
          clientId: "c1",
          focusedTrackId: null,
          actorId: "ben",
        }),
      ),
    ).toThrow(ProtocolError);
  });

  test("unknown server message types are a distinct, skippable error", () => {
    try {
      parseServerMessage(JSON.stringify({ v: 1, type: "cursor", x: 1 }));
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolError);
      expect((error as ProtocolError).code).toBe("unknown-type");
    }
  });

  test("transport frames without quantum default to a bar of 4", () => {
    const message = parseServerMessage(
      JSON.stringify({
        v: 1,
        type: "transport",
        seq: 1,
        playing: true,
        beat: 2,
        bpm: 120,
        atMs: 1000,
      }),
    );
    if (message.type !== "transport") throw new Error("wrong type");
    expect(message.quantum).toBe(DEFAULT_QUANTUM);
  });

  test("a clock offset rebases the transport anchor onto the local clock", () => {
    const state = {
      seq: 1,
      playing: true,
      beat: 0,
      bpm: 120,
      atMs: 10_000,
      quantum: 4,
    };
    expect(toLocalTransport(state, 0)).toBe(state);
    expect(toLocalTransport(state, 250).atMs).toBe(9_750);
  });
});

describe("pane and live frames", () => {
  test("view frames keep known fields and drop junk", () => {
    const view = parseClientMessage(
      JSON.stringify({
        v: 1,
        type: "view",
        screen: "tape",
        param: "filter",
        recording: "overdub",
        playing: true,
        pinned: true,
        follow: "B",
        junk: 1,
      }),
    );
    expect(view).toEqual({
      v: 1,
      type: "view",
      screen: "tape",
      param: "filter",
      recording: "overdub",
      playing: true,
      pinned: true,
      follow: "B",
    });
    expect(
      parseClientMessage(
        JSON.stringify({ v: 1, type: "view", screen: "NOPE!", follow: "bb" }),
      ),
    ).toEqual({ v: 1, type: "view" });
  });

  test("presence entries round-trip pane letters and view fields", () => {
    const frame = parseServerMessage(
      JSON.stringify({
        v: 1,
        type: "presence",
        clients: [
          {
            clientId: "c1",
            actorId: ACTOR,
            pid: 2,
            label: "dawg",
            focusedTrackId: "bass",
            pane: "B",
            screen: "play",
            recording: "replace",
          },
        ],
      }),
    );
    expect(frame).toEqual({
      v: 1,
      type: "presence",
      clients: [
        {
          clientId: "c1",
          actorId: ACTOR,
          pid: 2,
          label: "dawg",
          focusedTrackId: "bass",
          pane: "B",
          screen: "play",
          recording: "replace",
        },
      ],
    });
  });

  test("live notes carry beat and authority atMs, and are bounded", () => {
    const note = {
      v: 1,
      type: "live",
      action: "on",
      voice: 3,
      trackId: "bass",
      pitch: 40,
      velocity: 0.8,
      seconds: 0.5,
      beat: 12.5,
      atMs: 1_700_000_000_000,
    };
    expect(parseClientMessage(JSON.stringify(note))).toEqual(note as never);
    for (const bad of [
      { pitch: 200 },
      { velocity: 2 },
      { beat: "x" },
      { atMs: -1 },
      { trackId: "../x" },
    ])
      expect(() =>
        parseClientMessage(JSON.stringify({ ...note, ...bad })),
      ).toThrow(ProtocolError);
    expect(
      parseClientMessage(
        JSON.stringify({
          v: 1,
          type: "live",
          action: "click",
          on: false,
          volume: 0.4,
          countIn: {
            startAtMs: 1,
            startBeat: 8,
            beats: 4,
            barBeats: 4,
            clickBeats: 1,
            bpm: 120,
          },
        }),
      ),
    ).toMatchObject({ action: "click", countIn: { beats: 4 } });
    expect(
      parseServerMessage(
        JSON.stringify({
          v: 1,
          type: "liveStatus",
          id: "r1",
          canMonitor: true,
          sampleRate: 48000,
          leadMs: 15,
          note: "native",
        }),
      ),
    ).toMatchObject({ type: "liveStatus", leadMs: 15 });
  });
});
