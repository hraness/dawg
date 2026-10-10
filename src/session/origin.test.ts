import { describe, expect, test } from "bun:test";
import {
  OwnWrites,
  editedTrack,
  foreignEvents,
  otherWindowName,
} from "./origin.ts";
import { WRITTEN_REVISION } from "./port.ts";
import type { SessionEvent, SessionRecord } from "./store.ts";

const event = (revision: number, id: string, kind = "edit"): SessionEvent => ({
  id,
  revision,
  kind,
  payload: null,
  at: "2026-01-01T00:00:00.000Z",
});
const record = (events: SessionEvent[]): SessionRecord<null> =>
  ({
    sessionId: "s",
    revision: events.length,
    updatedAt: "2026-01-01T00:00:00.000Z",
    composition: null,
    events,
    meta: {},
  }) as unknown as SessionRecord<null>;

describe("sync origin", () => {
  test("own writes are not foreign; other windows' are", async () => {
    const own = new OwnWrites();
    await own.track(Promise.resolve(record([event(1, "a")])));
    const latest = record([event(1, "a"), event(2, "b")]);
    expect(foreignEvents(latest, 0, own).map((e) => e.id)).toEqual(["b"]);
    expect(foreignEvents(latest, 1, own).map((e) => e.id)).toEqual(["b"]);
    expect(foreignEvents(record([event(1, "a")]), 0, own)).toEqual([]);
  });

  test("a daemon record that already holds a later foreign write", async () => {
    // dawgd accepted this window's write as revision 1, but the client's
    // record has also taken in another window's revision 2.
    const own = new OwnWrites();
    const written = record([event(1, "mine"), event(2, "theirs")]);
    WRITTEN_REVISION.set(written, 1);
    await own.track(Promise.resolve(written));
    expect(foreignEvents(written, 0, own).map((e) => e.id)).toEqual(["theirs"]);
  });

  test("settled waits for an append in flight", async () => {
    const own = new OwnWrites();
    let finish!: (r: SessionRecord<null>) => void;
    const write = own.track(
      new Promise<SessionRecord<null>>((r) => (finish = r)),
    );
    let settled = false;
    const wait = own.settled().then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    finish(record([event(1, "mine")]));
    await write;
    await wait;
    expect(settled).toBe(true);
    expect(own.isOwn("mine")).toBe(true);
  });

  test("attach patches a port's appends once", async () => {
    const own = new OwnWrites();
    let n = 0;
    const port = {
      append: async () => record([event(++n, `e${n}`)]),
      appendOperations: async () => record([event(++n, `e${n}`)]),
    };
    own.attach(port as never);
    own.attach(port as never);
    await port.append();
    await port.appendOperations();
    expect(own.isOwn("e1")).toBe(true);
    expect(own.isOwn("e2")).toBe(true);
  });

  test("names the other window by its track, stable under reordering", () => {
    const list = [
      { clientId: "me", focusedTrackId: "bass" },
      { clientId: "b", focusedTrackId: "lead" },
      { clientId: "c", focusedTrackId: "pad" },
    ];
    const name = (id: string) => id.toUpperCase();
    // Seeded shuffles of the presence list never change the label.
    let x = 7;
    for (let round = 0; round < 50; round += 1) {
      const shuffled = [...list].sort(() => {
        x = (x * 1103515245 + 12345) % 2147483648;
        return x / 2147483648 - 0.5;
      });
      expect(
        otherWindowName(shuffled, "me", {
          editedTrackId: "lead",
          trackName: name,
        }),
      ).toBe("LEAD window");
    }
    expect(otherWindowName(list.slice(0, 2), "me")).toBe("lead window");
    // Before presence arrives the edited track names the window.
    expect(otherWindowName([], "me", { editedTrackId: "pad" })).toBe(
      "pad window",
    );
    expect(otherWindowName(list, "me")).toBe("another window");
    expect(otherWindowName([], "me")).toBe("another window");
  });

  test("editedTrack finds the one track a revision changed", () => {
    const tracks = [{ id: "a" }, { id: "b" }];
    const n = (trackId: string, pitch: number) => ({ trackId, pitch });
    expect(
      editedTrack(
        { tracks, notes: [n("a", 1)] },
        { tracks, notes: [n("a", 1), n("b", 2)] },
      ),
    ).toBe("b");
    expect(
      editedTrack(
        { tracks, notes: [] },
        { tracks, notes: [n("a", 1), n("b", 2)] },
      ),
    ).toBeUndefined();
  });
});
