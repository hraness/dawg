import { afterEach, expect, test } from "bun:test";
import { idSalt, newId, setIdSalt } from "./ids.ts";
import { SCORE_LIMITS } from "./score.ts";

afterEach(() => setIdSalt(""));

test("newId keeps a readable prefix and a random suffix", () => {
  const a = newId("bass");
  const b = newId("bass");
  expect(a).toMatch(/^bass-[a-z2-7]{8}$/);
  expect(a).not.toBe(b);
});

test("newId is salted by the actor so two actors never share a stream", () => {
  setIdSalt("a_qwertyuiopasdfghjklzxc");
  expect(idSalt()).toBe("qwe");
  expect(newId("lead")).toMatch(/^lead-qwe[a-z2-7]{8}$/);
});

test("newId stays within the score id limit and keeps the random part", () => {
  const id = newId("x".repeat(200));
  expect(id.length).toBeLessThanOrEqual(SCORE_LIMITS.maxIdLength);
  expect(id).toMatch(/-[a-z2-7]{8}$/);
  expect(newId("")).toMatch(/^[a-z2-7]{8}$/);
});

test("ten thousand ids do not collide", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 10_000; i += 1) seen.add(newId("n"));
  expect(seen.size).toBe(10_000);
});
