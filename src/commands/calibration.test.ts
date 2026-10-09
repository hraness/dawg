import { describe, expect, test } from "bun:test";
import {
  applyScoreOperation,
  CALIBRATION_LATEST,
  createScore,
} from "../../core/score.ts";
import { printSong } from "../../core/sdk/print.ts";
import { AGENT_TOOLS, type ScorePlan } from "../agent/tools.ts";
import { EditMenu, type MenuContext } from "../tui/menu.ts";
import {
  applyCalibrationCommand,
  parseCalibrationCommand,
} from "./calibration.ts";
import { USAGE } from "./help.ts";

const base = createScore({
  tracks: [{ id: "keys", name: "keys", instrument: "piano" }],
});

function run(text: string, score = base) {
  const command = parseCalibrationCommand(text);
  expect(command).toBeDefined();
  return applyCalibrationCommand(score, command!);
}

describe("/calibration", () => {
  test("parses every spelling and refuses the rest", () => {
    expect(parseCalibrationCommand("tuning 12")).toBeUndefined();
    expect(run("calibration").message).toContain("0 (legacy)");
    expect(run("/calibration latest").next?.calibration).toBe(
      CALIBRATION_LATEST,
    );
    expect(run("calibration 1").next?.calibration).toBe(1);
    for (const off of [
      "calibration 0",
      "calibration off",
      "calibration legacy",
    ])
      expect(run(off, run("calibration 1").next!).next?.calibration).toBe(
        undefined,
      );
    for (const bad of [
      "calibration 2",
      "calibration -1",
      "calibration x",
      "calibration 1 2",
    ])
      expect(run(bad).ok).toBe(false);
    expect(USAGE.calibration).toContain("calibration");
  });

  test("the menu row runs the same command", () => {
    const ctx: MenuContext = {
      score: base,
      trackId: "keys",
      playing: false,
      grid: "1/16",
      grids: ["1/16"],
      clickOn: false,
      countInBars: 1,
    };
    const menu = new EditMenu();
    menu.show(ctx, "project");
    const rows = menu.view(ctx).items;
    const target = rows.findIndex((row) => row.label.startsWith("calibration"));
    expect(target).toBeGreaterThanOrEqual(0);
    for (let i = menu.view(ctx).index; i < target; i += 1)
      menu.key("\u001b[B", ctx);
    expect(menu.key("\u001b[C", ctx)).toEqual({
      type: "run",
      command: "/calibration 1",
    });
  });

  test("the agent tool plans the same operation, and print syncs it", () => {
    const tool = AGENT_TOOLS.find((t) => t.name === "set_calibration")!;
    const ctx = {
      score: base,
      focusedTrackId: "keys",
      revision: 1,
      newNoteId: (id: string, i: number) => `${id}-${i}`,
    };
    const plan = tool.plan({ calibration: 1 }, ctx) as ScorePlan;
    let next = base;
    for (const op of plan.operations) next = applyScoreOperation(next, op);
    expect(next.toJSON()).toEqual(run("calibration 1").next!.toJSON());
    expect(printSong(next)).toContain("calibration: 1");
    expect(() => tool.plan({ calibration: 9 }, ctx)).toThrow();
    expect(() => tool.plan({ calibration: 0.5 }, ctx)).toThrow();
  });
});
