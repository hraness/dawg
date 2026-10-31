import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrackScore } from "../../core/score.ts";
import { applyDemoCommand, parseDemoCommand } from "./demo.ts";
import {
  findShelfStudy,
  listShelf,
  loadShelfStudy,
  shelfDir,
} from "./shelf.ts";

function study(shelf: string, name: string, meta?: object) {
  const dir = join(shelf, name);
  mkdirSync(join(dir, "tracks", "vocals", "samples"), { recursive: true });
  writeFileSync(join(dir, "dawg.json"), '{"format":"dawg.project/v1"}');
  writeFileSync(join(dir, "song.ts"), "export default {}");
  writeFileSync(join(dir, "tracks", "vocals", "samples", "v00.wav"), "take");
  if (meta) writeFileSync(join(dir, "shelf.json"), JSON.stringify(meta));
  return dir;
}

const score = () =>
  new TrackScore({
    tracks: [
      {
        id: "vocals",
        instrument: "sampler",
        sampler: {
          mode: "oneshot",
          voices: { v00: { src: "tracks/vocals/samples/v00.wav" } },
        },
      },
      {
        id: "kick",
        instrument: "sampler",
        sampler: { voices: { k: { src: "pack:drums/kick" } } },
      },
    ],
  } as never);
const evaluate = async () => ({ ok: true, score: score() }) as never;

test("the shelf lists project folders by title and skips everything else", () => {
  const shelf = mkdtempSync(join(tmpdir(), "dawg-shelf-"));
  study(shelf, "every-night", {
    title: "Every Night (study)",
    style: "clone",
  });
  study(shelf, "hi");
  mkdirSync(join(shelf, "notes"));
  writeFileSync(join(shelf, "readme.txt"), "x");
  study(shelf, "Upper");
  expect(listShelf(shelf).map((s) => [s.slug, s.title, s.style])).toEqual([
    ["every-night", "Every Night (study)", "clone"],
    ["hi", "hi", "local study"],
  ]);
  expect(findShelfStudy("local:hi", shelf)?.slug).toBe("hi");
  expect(listShelf(join(shelf, "missing"))).toEqual([]);
  expect(shelfDir({ DAWG_SHELF: shelf })).toBe(shelf);
  expect(shelfDir({ XDG_CONFIG_HOME: "/x" })).toBe("/x/dawg/shelf");
});

test("loading copies project samples under the track's shelf folder", async () => {
  const shelf = mkdtempSync(join(tmpdir(), "dawg-shelf-"));
  const work = mkdtempSync(join(tmpdir(), "dawg-work-"));
  study(shelf, "hi");
  const found = findShelfStudy("hi", shelf)!;
  const loaded = await loadShelfStudy(found, work, evaluate);
  const vocals = loaded.tracks.find((t) => t.id === "vocals")!;
  expect(vocals.sampler?.voices.v00?.src).toBe(
    "tracks/vocals/shelf/hi/samples/v00.wav",
  );
  expect(
    loaded.tracks.find((t) => t.id === "kick")!.sampler?.voices.k?.src,
  ).toBe("pack:drums/kick");
  const copied = join(work, "tracks/vocals/shelf/hi/samples/v00.wav");
  expect(readFileSync(copied, "utf8")).toBe("take");
  // Loading again over identical files is fine; different audio is refused.
  await loadShelfStudy(found, work, evaluate);
  writeFileSync(copied, "mine");
  await expect(loadShelfStudy(found, work, evaluate)).rejects.toThrow(
    "already exists with other audio",
  );
  expect(readFileSync(copied, "utf8")).toBe("mine");
});

test("demo list and info include local studies", () => {
  const shelf = mkdtempSync(join(tmpdir(), "dawg-shelf-"));
  study(shelf, "hi", { title: "Hi (study)" });
  const before = process.env.DAWG_SHELF;
  process.env.DAWG_SHELF = shelf;
  try {
    const list = applyDemoCommand(parseDemoCommand("demo list")!);
    expect(list.message).toContain("local:hi · Hi (study)");
    const info = applyDemoCommand(parseDemoCommand("demo info local:hi")!);
    expect(info.message).toContain("Hi (study) · local study");
    const load = applyDemoCommand(parseDemoCommand("demo local:hi")!);
    expect(load.study?.slug).toBe("hi");
    expect(load.next).toBeUndefined();
  } finally {
    if (before === undefined) delete process.env.DAWG_SHELF;
    else process.env.DAWG_SHELF = before;
  }
});
