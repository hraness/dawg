/**
 * One topic id opens the same subject in /help, /guide and /menu (design
 * §4, §8.2), and the window commands help advertises route. The ratchets
 * below are empty; an entry fails the suite once it closes.
 */
import { expect, test } from "bun:test";
import { accepts } from "./consistency-lib.ts";
import { TOPICS, TOPIC_ALIASES } from "../src/lang/glossary.ts";

const WORDS = [...TOPICS, ...Object.keys(TOPIC_ALIASES)];

/** Topic words `/menu` does not take. Empty. */
const KNOWN_MENU_TOPIC_GAPS: readonly string[] = [];

/** Window lines help advertises that do not route. Empty. */
const KNOWN_WINDOW_GAPS: readonly string[] = [];

const WINDOW_LINES = [
  "/model",
  "/model fast",
  "/model key",
  "model key",
  "/logout",
  "/auth --check",
  "/showme quiet",
  "/theme mono",
  "/view focus",
  "/motion off",
  "/resume",
  "/fork",
  "/rename demo",
  "/click on",
];

test("every topic id and alias opens /help and /guide", () => {
  for (const word of WORDS) {
    expect(accepts(`/help ${word}`), `/help ${word}`).toBe(true);
    expect(accepts(`/guide ${word}`), `/guide ${word}`).toBe(true);
  }
});

test("every topic id and alias opens /menu, or is a known gap", () => {
  const misses = WORDS.filter((word) => !accepts(`/menu ${word}`));
  expect(
    misses.filter((word) => !KNOWN_MENU_TOPIC_GAPS.includes(word)),
  ).toEqual([]);
  // The ratchet: a word that now opens must leave the gap list.
  expect(
    KNOWN_MENU_TOPIC_GAPS.filter((word) => !misses.includes(word)),
  ).toEqual([]);
});

test("the window commands help advertises route, or are known gaps", () => {
  const misses = WINDOW_LINES.filter((line) => !accepts(line));
  expect(misses.filter((line) => !KNOWN_WINDOW_GAPS.includes(line))).toEqual(
    [],
  );
  expect(KNOWN_WINDOW_GAPS.filter((line) => !misses.includes(line))).toEqual(
    [],
  );
});
