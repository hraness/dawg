/** Complete, editable demo songs. Browsing is read-only; loading is one edit. */
import { createDemo, DEMOS, type DemoInfo } from "../../core/demos/index.ts";
import type { TrackScore } from "../../core/score.ts";
import { fuzzyScore } from "../../tui/search.ts";
import {
  findShelfStudy,
  listShelf,
  SHELF_PREFIX,
  shelfInfoLines,
  type ShelfStudy,
} from "./shelf.ts";

export type DemoCommand =
  | { type: "demo-list"; query: string }
  | { type: "demo-info"; id: string }
  | { type: "demo-load"; id: string }
  | { type: "demo-bad"; message: string };

export const DEMO_USAGE = "demo [list|search <words>|info <id>|<id>]";

export function parseDemoCommand(text: string): DemoCommand | undefined {
  const match = text.trim().match(/^\/?demos?(?:\s+(.*))?$/iu);
  if (!match) return undefined;
  const words = (match[1] ?? "").trim();
  if (text.length > 512) return { type: "demo-bad", message: DEMO_USAGE };
  if (!words || /^(list|ls|presets)$/iu.test(words))
    return { type: "demo-list", query: "" };
  const action = words.match(/^(search|info|load)\s+(.+)$/iu);
  if (action)
    return action[1]!.toLowerCase() === "search"
      ? { type: "demo-list", query: action[2]! }
      : {
          type: action[1]!.toLowerCase() === "info" ? "demo-info" : "demo-load",
          id: action[2]!,
        };
  if (/^(search|info|load)$/iu.test(words))
    return { type: "demo-bad", message: DEMO_USAGE };
  return { type: "demo-load", id: words };
}

export function findDemo(value: string): DemoInfo | undefined {
  const id = value.trim().toLowerCase().replace(/[ _]+/gu, "-");
  return DEMOS.find(
    (demo) =>
      demo.id === id || demo.title.toLowerCase().replace(/ /gu, "-") === id,
  );
}

export function searchDemos(query: string): readonly DemoInfo[] {
  if (!query.trim()) return DEMOS;
  return DEMOS.map((demo, index) => ({
    demo,
    index,
    rank: fuzzyScore(
      query,
      `${demo.title} ${demo.id}`,
      `${demo.style} ${demo.description} ${demo.features.join(" ")}`,
    ),
  }))
    .filter(({ rank }) => rank > 0)
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map(({ demo }) => demo);
}

export function demoDuration(demo: DemoInfo): string {
  const seconds = Math.round(demo.durationSeconds);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function demoInfoLines(demo: DemoInfo): string[] {
  return [
    `${demo.title} · ${demo.style} · ${demo.tempoBpm} BPM · ${demo.key} · ${demoDuration(demo)}`,
    demo.description,
    "",
    "Arrangement",
    ...demo.arrangement,
    "",
    `Explore · ${demo.features.join(" · ")}`,
    "",
    "Mix notes",
    ...demo.mixNotes,
    "",
    `demo ${demo.id} loads the song · Ctrl-Z restores the current song`,
    "Ctrl-T opens TAPE · , / . changes scene in TAPE · Space plays",
    "Original DAWG compositions and synthetic samples; every part is editable offline.",
  ];
}

export function applyDemoCommand(command: DemoCommand): {
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
  /** A local study to load: evaluating it and copying samples is async. */
  study?: ShelfStudy;
} {
  if (command.type === "demo-bad")
    return { ok: false, message: command.message };
  if (command.type === "demo-list") {
    const found = searchDemos(command.query);
    const query = command.query.trim().toLowerCase();
    const local = listShelf().filter(
      (study) =>
        !query ||
        `${study.slug} ${study.title} ${study.style}`
          .toLowerCase()
          .includes(query),
    );
    return {
      ok: true,
      message:
        found.length || local.length
          ? [
              "Demo songs · complete editable arrangements",
              ...found.map(
                (demo) =>
                  `${demo.id} · ${demo.title} · ${demo.style} · ${demoDuration(demo)}`,
              ),
              ...local.map(
                (study) =>
                  `${SHELF_PREFIX}${study.slug} · ${study.title} · ${study.style} · local`,
              ),
              "demo <id> loads · demo info <id> explains the arrangement",
            ].join("\n")
          : `No demo matches “${command.query}” · demo list`,
    };
  }
  const demo = findDemo(command.id);
  const study = demo ? undefined : findShelfStudy(command.id);
  if (study)
    return command.type === "demo-info"
      ? { ok: true, message: shelfInfoLines(study).join("\n") }
      : {
          ok: true,
          message: `${study.title} · local study · Space plays · Ctrl-Z restores`,
          study,
        };
  if (!demo)
    return { ok: false, message: `No demo “${command.id}” · demo list` };
  if (command.type === "demo-info")
    return { ok: true, message: demoInfoLines(demo).join("\n") };
  return {
    ok: true,
    message: `${demo.title} · ${demo.style} · Ctrl-T timeline · Space plays · Ctrl-Z restores`,
    next: createDemo(demo.id),
    kind: "demo.load",
    payload: { demoId: demo.id },
  };
}
