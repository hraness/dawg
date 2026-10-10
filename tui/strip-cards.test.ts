import { expect, test } from "bun:test";
import type { ActivityCard } from "./activity.ts";
import { cardText, ONCE_ROTATE_MS, stripCards } from "./app.ts";

const card = (id: number, text: string, once = false): ActivityCard => ({
  id,
  text,
  tone: "info",
  atMs: 0,
  ...(once ? { once: true } : {}),
});

test("one-time notes that cannot fit together take turns, each whole", () => {
  const notes = [
    card(1, "/model key adds an agent · optional", true),
    card(2, "created .dawg/ · add it to .gitignore", true),
  ];
  // 78 columns: the 80-column strip's room.
  const seen = new Set<string>();
  for (let now = 0; now < ONCE_ROTATE_MS * 4; now += 250) {
    const shown = stripCards(notes, 78 - 45, now, true);
    expect(shown.length).toBe(1);
    seen.add(cardText(shown[0]!, true));
  }
  expect([...seen].sort()).toEqual(notes.map((n) => cardText(n, true)).sort());
  // With room for both, both show.
  expect(stripCards(notes, 200, 0, true)).toHaveLength(2);
});

test("a receipt always stays; only one-time notes rotate", () => {
  const cards = [
    card(3, "added · C3 at 0"),
    card(1, "/model key adds an agent · optional", true),
    card(2, "created .dawg/ · add it to .gitignore", true),
  ];
  for (let now = 0; now < ONCE_ROTATE_MS * 3; now += 500) {
    const shown = stripCards(cards, 60, now, true);
    expect(shown[0]!.id).toBe(3);
    expect(shown).toHaveLength(2);
  }
});
