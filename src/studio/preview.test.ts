import { expect, test } from "bun:test";
import { equivalentPlaybackRevision, waitForAudibleRegion } from "./preview.ts";
import type { AudioPlaybackStatus } from "../session/protocol.ts";

const request = {
  ticket: { jobId: "song", epoch: 0, writtenRevision: 3, controlRevision: 0 },
  range: { from: 0, to: 8 },
  trackIds: ["bass"],
};
const ready: AudioPlaybackStatus = {
  pendingRevision: null,
  audibleRevision: 3,
  buffered: [{ fromBeat: 0, toBeat: 8 }],
  preparing: false,
  buffering: false,
};
test("transport-only log revisions retain the same PCM; score edits and missing history do not", () => {
  expect(
    equivalentPlaybackRevision(3, 4, [{ revision: 4, kind: "transport" }]),
  ).toBe(4);
  expect(
    equivalentPlaybackRevision(3, 4, [{ revision: 4, kind: "agent" }]),
  ).toBe(3);
  expect(
    equivalentPlaybackRevision(3, 5, [{ revision: 5, kind: "transport" }]),
  ).toBe(3);
  expect(equivalentPlaybackRevision(null, 4, [])).toBeNull();
});
test("only current PCM covering the whole region yields a receipt", async () => {
  const receipt = await waitForAudibleRegion({
    request,
    observe: () => ready,
    currentRevision: () => 3,
    controlsCurrent: () => true,
    renderedNotes: 8,
  });
  expect(receipt.writtenRevision).toBe(3);
  expect(receipt.missingAssets).toEqual([]);
  for (const status of [
    { ...ready, audibleRevision: 2 },
    { ...ready, buffered: [{ fromBeat: 0, toBeat: 4 }] },
    { ...ready, buffering: true },
  ])
    await expect(
      waitForAudibleRegion({
        request,
        observe: () => status,
        currentRevision: () => 3,
        controlsCurrent: () => true,
        renderedNotes: 8,
        timeoutMs: 0,
      }),
    ).rejects.toThrow("still preparing");
});
test("listener controls, stale scores, silence and cancellation reject late receipts", async () => {
  const base = {
    request,
    observe: () => ready,
    currentRevision: () => 3,
    controlsCurrent: () => true,
    renderedNotes: 8,
  };
  await expect(
    waitForAudibleRegion({ ...base, controlsCurrent: () => false }),
  ).rejects.toThrow("listener");
  await expect(
    waitForAudibleRegion({ ...base, currentRevision: () => 4 }),
  ).rejects.toThrow("score changed");
  await expect(
    waitForAudibleRegion({ ...base, renderedNotes: 0 }),
  ).rejects.toThrow("no sounding notes");
  const controller = new AbortController();
  const waiting = waitForAudibleRegion({
    ...base,
    observe: () => undefined,
    signal: controller.signal,
  });
  controller.abort(new Error("cancelled"));
  await expect(waiting).rejects.toThrow("cancelled");
});
