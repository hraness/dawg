import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../core/score.ts";
import { WIND_PRESET_NAMES } from "../../core/winds.ts";
import { applyWindCommand, parseWindCommand } from "../commands/wind.ts";
import type { MenuContext, MenuNode } from "./menu.ts";
import { windParameterNodes, windsMenu } from "./wind-menu.ts";

function context(score: TrackScore): MenuContext {
  return {
    score,
    trackId: "w",
    playing: false,
    grid: "1/16",
    grids: ["1/16"],
    clickOn: false,
    countInBars: 1,
  };
}

/** Applies a typed `wind ...` command to track `w`; throws on failure. */
function run(score: TrackScore, command: string): TrackScore {
  const parsed = parseWindCommand(command);
  if (!parsed) throw new Error(`not a wind command: ${command}`);
  const result = applyWindCommand(score, "w", parsed);
  if (!result.ok || !result.next)
    throw new Error(`${command}: ${result.message}`);
  return result.next;
}

/** Every leaf under `nodes`, opening submenus. */
function leaves(nodes: readonly MenuNode[], ctx: MenuContext): MenuNode[] {
  return nodes.flatMap((node) =>
    node.kind === "menu" ? leaves(node.build(ctx), ctx) : [node],
  );
}

/** The commands a row can emit: each option, both ends and the reset. */
function commands(node: MenuNode): string[] {
  if (node.kind === "action") return [node.command];
  if (node.kind === "choice") return node.options.map(node.command);
  if (node.kind === "number")
    return [
      node.command(node.min ?? 0),
      node.command(node.max ?? 1),
      ...(node.reset ? [node.reset] : []),
    ];
  return [];
}

const base = createScore({
  bars: 1,
  tracks: [{ id: "w", name: "w", instrument: "piano" }],
});

describe("winds menu", () => {
  test("browse lists every preset once, and each row's command applies", () => {
    const ctx = context(base);
    const rows = leaves([windsMenu()], ctx);
    const picked = rows.map((row) =>
      row.kind === "action" ? row.command : "",
    );
    expect(picked.sort()).toEqual(
      WIND_PRESET_NAMES.map((name) => `wind ${name}`).sort(),
    );
    for (const command of picked) {
      const next = run(base, command);
      expect(next.tracks[0]!.instrument).toBe("wind");
    }
  });

  test("a non-wind track has no wind parameters", () => {
    expect(windParameterNodes(base.tracks[0]!)).toEqual([]);
  });

  test("every parameter row emits commands the typed grammar accepts", () => {
    const wind = run(base, `wind ${WIND_PRESET_NAMES[0]}`);
    const ctx = context(wind);
    const rows = leaves(windParameterNodes(wind.tracks[0]!), ctx);
    expect(rows.length).toBeGreaterThan(5);
    let applied = 0;
    for (const row of rows)
      for (const command of commands(row)) {
        run(wind, command);
        applied += 1;
      }
    expect(applied).toBeGreaterThan(rows.length);
    // No overrides yet, so no reset row.
    expect(rows.some((row) => row.label === "reset to preset")).toBe(false);
  });

  test("an override shows the reset row, and reset clears it", () => {
    const wind = run(base, `wind ${WIND_PRESET_NAMES[0]}`);
    const numeric = leaves(
      windParameterNodes(wind.tracks[0]!),
      context(wind),
    ).find((row) => row.kind === "number");
    if (numeric?.kind !== "number") throw new Error("no number row");
    const changed = run(wind, numeric.command(numeric.max ?? 1));
    const rows = windParameterNodes(changed.tracks[0]!);
    const reset = rows.find((row) => row.label === "reset to preset");
    if (reset?.kind !== "action") throw new Error("no reset row");
    expect(run(changed, reset.command).tracks[0]!.wind).toEqual(
      wind.tracks[0]!.wind,
    );
  });
});
