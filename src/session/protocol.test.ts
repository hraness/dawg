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
