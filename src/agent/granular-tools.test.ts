import { describe, expect, test } from "bun:test";

import {
  applyScoreOperation,
  createScore,
  type TrackScore,
} from "../../core/score.ts";
import { granular, track } from "../../core/sdk/v1.ts";
import {
  applyGranularCommand,
  parseGranularCommand,
} from "../commands/granular.ts";
import { granularBrowseNodes } from "../tui/granular-menu.ts";
import { AGENT_TOOLS, type ToolContext } from "./tools.ts";

const tool = (name: string) => AGENT_TOOLS.find((t) => t.name === name)!;

const score = createScore({
  tracks: [
    { id: "pad", instrument: "pad" },
    { id: "kit", instrument: "kit", kit: "syn909" },
  ],
  notes: [],
} as never);

function context(value: TrackScore): ToolContext {
  return {
    score: value,
    focusedTrackId: "pad",
    revision: 1,
    newNoteId: (trackId, index) => `${trackId}-${index}`,
  };
}

function viaTool(args: Record<string, unknown>): TrackScore {
  const plan = tool("set_granular").plan(args, context(score));
  if (plan.kind !== "score") throw new Error("not a score plan");
  return plan.operations.reduce(applyScoreOperation, score);
}

function viaCommand(text: string): TrackScore {
  const result = applyGranularCommand(
    score,
    "pad",
    parseGranularCommand(text)!,
  );
  if (!result.ok || !result.next) throw new Error(result.message);
  return result.next;
}

const stored = (value: TrackScore) => {
  const pad = value.tracks.find((t) => t.id === "pad")!;
  return { instrument: pad.instrument, granular: pad.granular };
};

describe("set_granular", () => {
  test("four ways give the same track: command, menu, tool, SDK", () => {
    const command = stored(viaCommand("grain cloud"));
    const menuCommand = granularBrowseNodes().find((node) =>
      node.label.startsWith("cloud"),
    );
    expect(menuCommand).toMatchObject({ command: "grain cloud" });
    const tool = stored(viaTool({ preset: "cloud" }));
    const sdk = track({
      name: "pad",
      instrument: granular("cloud"),
      notes: [],
    }) as unknown as { instrument: string; granular: unknown };
    // The prompt and the tool turn an existing pad track granular, so they
    // remember `from` for `grain off`; the SDK builds a fresh track.
    expect(command).toEqual({
      instrument: "granular",
      granular: { preset: "cloud", from: "pad" },
    });
    expect(tool).toEqual(command);
    expect({ instrument: sdk.instrument, granular: sdk.granular }).toEqual({
      instrument: "granular",
      granular: { preset: "cloud" },
    });
  });

  test("params, unset, reset and off", () => {
    const set = stored(
      viaTool({ preset: "swarm", params: { scan: 0.2, freeze: true } }),
    );
    expect(set.granular).toEqual({
      preset: "swarm",
      scan: 0.2,
      freeze: true,
      from: "pad",
    });
    const off = stored(viaTool({ off: true }));
    expect(off.instrument).toBe("pad");
  });

  test("refuses drum tracks and bad values with a clear message", () => {
    expect(() =>
      tool("set_granular").plan(
        { trackId: "kit", preset: "cloud" },
        context(score),
      ),
    ).toThrow(/drum/);
    expect(() =>
      tool("set_granular").plan({ params: { grain: 99 } }, context(score)),
    ).toThrow();
  });
});
