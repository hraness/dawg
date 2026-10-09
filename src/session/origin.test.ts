import { describe, expect, test } from "bun:test";
import { OwnWrites, foreignEvents, otherWindowName } from "./origin.ts";
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

  test("names the other window", () => {
    const list = [{ clientId: "me" }, { clientId: "you" }];
    expect(otherWindowName(list, "me")).toBe("window 2");
    expect(otherWindowName([{ clientId: "you" }], "me")).toBe("window 2");
    expect(otherWindowName([...list, { clientId: "x" }], "me")).toBe(
      "another window",
    );
    expect(otherWindowName([], "me")).toBe("another window");
  });
});
