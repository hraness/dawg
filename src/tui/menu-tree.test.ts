/**
 * The ctrl-k tree as a whole (design §4a, §7 B1-B8, §8.4): walk every
 * section for six kinds of track and check that each row's command parses,
 * labels fit, sibling labels share the sentence-case rule, and every
 * `/menu <id>` opens something.
 */
import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../core/score.ts";
import { parseCalibrationCommand } from "../commands/calibration.ts";
import { commandParses } from "../commands/parses.ts";
import { parseStyleCommand } from "../commands/style.ts";
import {
  LABEL_WIDTH,
  MENU_SECTIONS,
  MENU_TOPICS,
  MENU_USAGE,
  EditMenu,
  menuPath,
  menuSectionPath,
  rootNodes,
  type MenuContext,
  type MenuNode,
} from "./menu.ts";

const INSTRUMENTS = ["saw", "piano", "kit", "organ", "vocal", "strings"];

function score(instrument: string): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 8,
    tracks: [
      { id: "lead", name: "lead", instrument },
      { id: "bass", name: "bass", instrument: "bass" },
    ],
    notes: [],
  });
}

function context(instrument: string): MenuContext {
  return {
    score: score(instrument),
    trackId: "lead",
    playing: false,
    grid: "1/16",
    grids: ["1/8", "1/16"],
    clickOn: false,
    countInBars: 1,
    showMe: "on",
  };
}

type Row = { path: string; node: MenuNode; siblings: readonly MenuNode[] };

/** Every row reachable from the root, `depth` menus deep. */
function walk(ctx: MenuContext, depth = 5): Row[] {
  const rows: Row[] = [];
  const visit = (nodes: readonly MenuNode[], path: string, left: number) => {
    for (const node of nodes) {
      const at = path ? `${path} › ${node.label}` : node.label;
      rows.push({ path: at, node, siblings: nodes });
      if (node.kind === "menu" && left > 0)
        visit(node.build(ctx), at, left - 1);
    }
  };
  visit(rootNodes(ctx), "", depth);
  return rows;
}

/** Every command a row can emit: each option of a choice, both toggles. */
function rowCommands(node: MenuNode): string[] {
  switch (node.kind) {
    case "number":
      return [node.command(node.value ?? node.start ?? node.min)];
    case "toggle":
      return [node.command(true), node.command(false)];
    case "choice":
      return node.options
        .filter((option) => option !== "—")
        .map((option) => node.command(option));
    case "action":
      return [node.command];
    default:
      return [];
  }
}

/**
 * Window commands src/main.ts runs itself (no song parser): they open a
 * screen or change this window. Pinned here so a new one is a choice.
 */
const WINDOW =
  /^\/(?:help|guide|menu|play|model|showme|sessions|resume|rename|fork|euclid|grid|count-in|click|chords|track|tracks|try|instrument|export|import|kit|pattern)(?:\s|$)/;

function parses(command: string, value: TrackScore): boolean {
  return (
    commandParses(command, value) ||
    parseStyleCommand(command) !== undefined ||
    parseCalibrationCommand(command) !== undefined ||
    WINDOW.test(command)
  );
}

/** A label's name, before its two-space detail or `(alias)` note. */
function labelName(label: string): string {
  return label.split(/\s{2,}| \(/)[0]!;
}

/** Proper names keep their capitals in a lower-case list. */
const PROPER =
  /^(?:ZzFX|Strudel|Wurlitzer|Rhodes|Cuban|Hammond|Vox|[A-G][#b]?\d?\b)/;

function isValueRow(node: MenuNode): boolean {
  return /^(?:number|toggle|choice|point)$/.test(node.kind);
}

describe("the ctrl-k tree", () => {
  for (const instrument of INSTRUMENTS) {
    test(`${instrument}: every row's command parses`, () => {
      const ctx = context(instrument);
      const broken: string[] = [];
      for (const { path, node } of walk(ctx))
        for (const command of rowCommands(node))
          if (!parses(command, ctx.score)) broken.push(`${path}: ${command}`);
      expect(broken).toEqual([]);
    });

    test(`${instrument}: value labels fit LABEL_WIDTH`, () => {
      const ctx = context(instrument);
      const wide = walk(ctx)
        .filter(({ node }) => isValueRow(node))
        .filter(({ node }) => labelName(node.label).length > LABEL_WIDTH)
        .map(({ path }) => path);
      expect(wide).toEqual([]);
    });

    test(`${instrument}: sibling labels share one case rule`, () => {
      const ctx = context(instrument);
      const mixed: string[] = [];
      const seen = new Set<readonly MenuNode[]>();
      for (const { path, siblings } of walk(ctx, 3)) {
        if (!path.includes(" › ") || seen.has(siblings)) continue;
        // Style names are titles from the taxonomy (src/styles), kept as is.
        if (path.startsWith("Arrange › style › ")) continue;
        seen.add(siblings);
        const names = siblings
          .filter((node) => node.kind === "menu" || isValueRow(node))
          .map((node) => labelName(node.label))
          .filter((name) => !PROPER.test(name));
        const upper = names.filter((name) => /^[A-Z][a-z]/.test(name));
        if (upper.length > 0 && upper.length < names.length)
          mixed.push(`${path.replace(/ › [^›]*$/, "")}: ${upper.join(", ")}`);
      }
      expect(mixed).toEqual([]);
    });
  }

  test("root labels are sentence case and in the §4a order", () => {
    const labels = rootNodes(context("saw")).map((node) => node.label);
    expect(labels).toEqual([
      "Sound",
      "Voice",
      "Effects",
      "Rhythm",
      "Chords and key",
      "Mix",
      "Arrange",
      "Project",
    ]);
  });

  test("the ten topics lead MENU_SECTIONS and every id opens", () => {
    expect(MENU_TOPICS).toEqual([
      "sound",
      "voice",
      "effects",
      "rhythm",
      "chords",
      "mix",
      "arrange",
      "project",
      "keys",
      "agent",
    ]);
    for (const id of [...MENU_SECTIONS, "fx", "master", "models"]) {
      const menu = new EditMenu();
      const ctx = context("saw");
      menu.show(ctx, id);
      expect(menu.open).toBe(true);
      expect(menu.section).toBeDefined();
    }
  });

  test("/menu opens any row by name; the usage names the roots", () => {
    const ctx = context("piano");
    expect(menuSectionPath(ctx, "tuning")).toEqual(["chords", "tuning"]);
    expect(menuSectionPath(ctx, "reverb")).toEqual(["effects", "reverb"]);
    expect(menuSectionPath(ctx, "nonsense")).toBeUndefined();
    expect(MENU_USAGE).toBe(
      "usage: /menu [sound|voice|effects|rhythm|chords|mix|arrange|project|keys|agent] or any row name",
    );
  });

  test("menuPath renders live labels", () => {
    expect(menuPath("tuning")).toBe("Ctrl-K › Chords and key › tuning");
    expect(menuPath("agent")).toBe("Ctrl-K › Project › agent");
    expect(menuPath("voice")).toBe("Ctrl-K › Voice");
    expect(menuPath("performance")).toBe("Ctrl-K › Sound › performance");
    expect(menuPath("nonsense")).toBeUndefined();
  });

  test("Project › agent offers model, show me and model key", () => {
    const ctx = context("saw");
    const agent = walk(ctx, 3)
      .filter(({ path }) => path.startsWith("Project › agent › "))
      .map(({ node }) => node.label);
    expect(agent).toEqual(
      expect.arrayContaining(["model", "show me", "model key"]),
    );
    expect(agent).not.toContain("login");
  });
});
