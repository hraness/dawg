import { expect, test } from "bun:test";
import { addNote, createScore, updateTrack } from "../../core/score.ts";
import { coherentDraftRange, DraftAutoplay } from "./playback.ts";

test("autoplay waits for a two-part musical region, ignores mute/solo silence", () => {
  let score = createScore({
    bars: 4,
    tracks: [
      { id: "drums", instrument: "kit" },
      { id: "bass", instrument: "sine" },
    ],
  });
  expect(coherentDraftRange(score)).toBeUndefined();
  for (const trackId of ["drums", "bass"])
    for (const beat of [0, 4])
      score = addNote(score, {
        id: `${trackId}-${beat}`,
        trackId,
        startTick: beat * score.ticksPerBeat,
        durationTicks: 240,
        pitch: 36,
        velocity: 0.7,
      });
  expect(coherentDraftRange(score)).toEqual({
    from: 0,
    to: 8,
    trackIds: ["drums", "bass"],
  });
  expect(
    coherentDraftRange(updateTrack(score, "bass", { muted: true })),
  ).toBeUndefined();
  expect(
    coherentDraftRange(updateTrack(score, "drums", { solo: true })),
  ).toBeUndefined();
});

test("manual pause and seek win over delayed autoplay", () => {
  const policy = new DraftAutoplay();
  policy.begin();
  const ticket = policy.offer(false)!;
  expect(policy.current(ticket)).toBe(true);
  expect(policy.offer(false)).toBeUndefined();
  policy.humanControl();
  expect(policy.current(ticket)).toBe(false);
  policy.retry(ticket);
  expect(policy.offer(false)).toBeUndefined();
  policy.begin();
  expect(policy.offer(false)).toBeUndefined();
  expect(policy.mayStart()).toBe(false);
  policy.begin(true);
  const next = policy.offer(false)!;
  policy.end();
  expect(policy.current(next)).toBe(true);
  policy.humanControl();
  expect(policy.current(next)).toBe(false);
});

test("pause persists through later edit turns until Play or an explicit new song", () => {
  const policy = new DraftAutoplay();
  policy.begin();
  policy.humanControl("pause");
  policy.end();
  policy.begin();
  expect(policy.mayStart()).toBe(false);
  expect(policy.offer(false)).toBeUndefined();
  policy.humanControl("seek");
  policy.begin();
  expect(policy.mayStart()).toBe(false);
  policy.humanControl("play");
  policy.begin();
  expect(policy.mayStart()).toBe(true);
});

test("failed draft may retry; a playing song never gets restarted", () => {
  const policy = new DraftAutoplay();
  policy.begin();
  expect(policy.offer(true)).toBeUndefined();
  const ticket = policy.offer(false)!;
  policy.retry(ticket);
  expect(policy.offer(false)).toBeDefined();
  policy.begin();
  expect(policy.current(ticket)).toBe(false);
});
