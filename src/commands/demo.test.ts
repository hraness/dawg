import { describe, expect, test } from "bun:test";
import { DEMOS } from "../../core/demos/index.ts";
import {
  applyDemoCommand,
  demoDuration,
  findDemo,
  parseDemoCommand,
  searchDemos,
} from "./demo.ts";
import { commandParses } from "./parses.ts";
import { createScore } from "../../core/score.ts";
import { commandCompletions } from "../tui/completion.ts";
import { demoMenuNodes } from "../tui/demo-menu.ts";
import { sampleLibraryNodes } from "../tui/sample-menu.ts";
import { BUNDLED_SAMPLES } from "../../core/bundled-samples.ts";

describe("demo song commands", () => {
  test("local parser accepts both spellings, bounded search and exact loading", () => {
    expect(parseDemoCommand("tempo 120")).toBeUndefined();
    expect(parseDemoCommand("/demos")).toEqual({
      type: "demo-list",
      query: "",
    });
    expect(parseDemoCommand("demo search dub techno")).toEqual({
      type: "demo-list",
      query: "dub techno",
    });
    expect(parseDemoCommand("demo load " + DEMOS[0]!.id)).toEqual({
      type: "demo-load",
      id: DEMOS[0]!.id,
    });
    expect(parseDemoCommand("demo " + "x".repeat(512))?.type).toBe("demo-bad");
    expect(parseDemoCommand("demo search")?.type).toBe("demo-bad");
    expect(commandParses("demo " + DEMOS[0]!.id, createScore())).toBe(true);
  });

  test("browsing is read-only and invalid IDs never load a near match", () => {
    const listed = applyDemoCommand({ type: "demo-list", query: "" });
    expect(listed.next).toBeUndefined();
    for (const demo of DEMOS) {
      expect(listed.message).toContain(demo.id);
      expect(findDemo(demo.title)).toEqual(demo);
      const info = applyDemoCommand({ type: "demo-info", id: demo.id });
      expect(info.next).toBeUndefined();
      expect(info.message).toContain("Mix notes");
      expect(demoDuration(demo)).toMatch(/^\d+:\d{2}$/u);
    }
    expect(applyDemoCommand({ type: "demo-load", id: "not-a-song" }).ok).toBe(
      false,
    );
    expect(searchDemos("zzzzzzzzzzzz")).toHaveLength(0);
    expect(searchDemos("techno").length).toBeGreaterThan(0);
  });

  test("loading yields one score edit and searchable shelf actions parse", () => {
    const result = applyDemoCommand({ type: "demo-load", id: DEMOS[0]!.id });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("demo.load");
    expect(result.next!.sections.length).toBeGreaterThan(3);
    const context = {
      score: createScore(),
      trackId: "lead",
      playing: false,
      grid: "1/16",
      grids: ["1/16"],
      clickOn: false,
      countInBars: 0,
    };
    for (const menu of [...demoMenuNodes(), ...sampleLibraryNodes()]) {
      if (menu.kind !== "menu") continue;
      for (const child of menu.build(context)) {
        if (child.kind === "action")
          expect(commandParses(child.command, context.score)).toBe(true);
      }
    }
  });

  test("typeahead preserves the intended operation and does not run it", () => {
    const source = (text: string) =>
      commandCompletions(text, { tracks: createScore().tracks, sections: [] });
    const demo = DEMOS[0]!;
    expect(
      source(`demo ${demo.title.slice(0, 3)}`).some(
        (row) => row.value === `demo ${demo.id}`,
      ),
    ).toBe(true);
    expect(
      source(`/demo info ${demo.id}`).some(
        (row) => row.value === `/demo info ${demo.id}`,
      ),
    ).toBe(true);
    const sample = BUNDLED_SAMPLES[0]!;
    expect(
      source(`/sample use ${sample.id}`).some(
        (row) => row.value === `/sample use ${sample.id}`,
      ),
    ).toBe(true);
    expect(
      source(`/sample preview ${sample.id}`).some(
        (row) => row.value === `/sample preview ${sample.id}`,
      ),
    ).toBe(true);
    expect(
      source(`sample chop ${sample.id}`).some(
        (row) => row.value === `sample chop ${sample.id} 4`,
      ),
    ).toBe(true);
  });
});
