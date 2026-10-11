import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  frameDelay,
  paintFrames,
  type FramesFile,
} from "../app/screens/frames";
import { loadScreen, screensDirectory } from "../app/screens/screen";

/**
 * The home page's screens move: each replays the frames dawg drew while it
 * was captured. These tests fail if a screen goes still again.
 */
const page = readFileSync(join(import.meta.dir, "../app/page.tsx"), "utf8");
const animated = [
  ...page.matchAll(/<Screen\s+id="([a-z0-9-]+)"\s+animate/gu),
  ...page.matchAll(/screen: "([a-z0-9-]+)"/gu),
].map((m) => m[1]!);

function frames(id: string): FramesFile {
  return JSON.parse(
    readFileSync(join(screensDirectory, "frames", `${id}.json`), "utf8"),
  ) as FramesFile;
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/gu, "")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}

describe("animated screens", () => {
  test("the hero and four pillars animate", () => {
    expect(new Set(animated)).toEqual(
      new Set(["hero", "play-mode", "knobs", "patch", "showme"]),
    );
    expect(page).toContain("animate\n");
  });

  for (const id of new Set(animated)) {
    test(`${id} has frames that change the picture`, () => {
      expect(existsSync(join(screensDirectory, "frames", `${id}.json`))).toBe(
        true,
      );
      const painted = paintFrames(frames(id));
      expect(painted.length).toBeGreaterThanOrEqual(3);
      // Most frames differ from each other; a few repeat while dawg waits.
      const distinct = new Set(painted.map((f) => f.rows.join(""))).size;
      expect(distinct).toBeGreaterThanOrEqual(3);
      expect(distinct * 2).toBeGreaterThanOrEqual(painted.length);
    });

    test(`${id} ends on the committed still`, () => {
      const painted = paintFrames(frames(id));
      const last = painted.at(-1)!.rows.map((row) => text(row).trimEnd());
      const still = loadScreen(id).lines.map((row) =>
        row
          .map(([chars]) => chars)
          .join("")
          .trimEnd(),
      );
      expect(last).toEqual(still);
    });
  }

  test("frames keep a readable pace and hold the last one", () => {
    const painted = paintFrames(frames("showme"));
    expect(frameDelay(painted, 0, 90, 3200)).toBeGreaterThanOrEqual(90);
    expect(frameDelay(painted, painted.length - 1, 90, 3200)).toBe(3200);
  });

  test("the player honors reduced motion and pauses offscreen", () => {
    const player = readFileSync(
      join(import.meta.dir, "../app/screens/screen-player.tsx"),
      "utf8",
    );
    expect(player).toContain("prefers-reduced-motion: reduce");
    expect(player).toContain("IntersectionObserver");
    expect(player).toContain("visibilitychange");
  });
});
