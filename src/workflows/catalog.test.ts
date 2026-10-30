import { describe, expect, test } from "bun:test";
import { posix } from "node:path";
import {
  getWorkflow,
  HOUSE_PROFILE,
  listWorkflows,
  missingWorkflowCapabilities,
  readWorkflowResource,
} from "./catalog.ts";

describe("portable workflow catalog", () => {
  test("selects exactly the requested stable workflow and reports missing capabilities", () => {
    expect(listWorkflows().map((workflow) => workflow.id)).toEqual([
      "original-house",
      "reference-study",
      "recreate-source",
    ]);
    expect(() => getWorkflow("some-other-workflow")).toThrow(
      "unknown workflow",
    );
    const workflow = getWorkflow("original-house");
    expect(
      missingWorkflowCapabilities(workflow.id, workflow.capabilities),
    ).toEqual([]);
    expect(missingWorkflowCapabilities(workflow.id, [])).toContain(
      "vocal.stock.v1",
    );
    expect(workflow.stages.map((stage) => stage.id)).toContain("vocals");
    expect(Object.isFrozen(workflow.stages)).toBe(true);
  });

  test("one house profile reconciles tempo, harmony, voice and register", () => {
    expect(HOUSE_PROFILE.bpm).toEqual({ min: 100, max: 180 });
    expect(HOUSE_PROFILE.harmony).toEqual({
      mode: "major",
      diatonic: true,
      modulation: false,
    });
    expect(HOUSE_PROFILE.voice.id).toBe("bf_emma");
    expect(HOUSE_PROFILE.register.verseMidi[1]).toBeLessThan(
      HOUSE_PROFILE.register.chorusMedianMidi[0],
    );
    expect(Object.isFrozen(HOUSE_PROFILE.register.verseMidi)).toBe(true);
  });

  test("all bundled resources and Markdown links close without private paths", async () => {
    for (const workflow of listWorkflows()) {
      for (const path of [workflow.instructions, ...workflow.resources]) {
        const body = await readWorkflowResource(workflow.id, path);
        expect(body.length).toBeGreaterThan(30);
        expect(body).not.toMatch(
          /\/Users\/|~\/|\.plans\/|vocal-resynthesis-20261029|Every Night|Hannah Diamond/,
        );
        if (!path.endsWith(".md")) {
          expect(() => JSON.parse(body)).not.toThrow();
          continue;
        }
        for (const match of body.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
          const target = posix.normalize(
            posix.join(posix.dirname(path), match[1]!),
          );
          expect([workflow.instructions, ...workflow.resources]).toContain(
            target,
          );
          expect(
            (await readWorkflowResource(workflow.id, target)).length,
          ).toBeGreaterThan(0);
        }
      }
    }
    await expect(
      readWorkflowResource("original-house", "../../package.json"),
    ).rejects.toThrow("not part");
  });
});
