import { readFile } from "node:fs/promises";
import house from "../../workflows/house-v1.json";
import { fail, type WorkflowId } from "./state.ts";

export type HouseProfile = Readonly<{
  id: string;
  version: string;
  bpm: Readonly<{ min: number; max: number }>;
  harmony: Readonly<{ mode: "major"; diatonic: true; modulation: false }>;
  voice: Readonly<{ engine: "kokoro-world"; id: "bf_emma"; language: "b" }>;
  register: Readonly<{
    verseMidi: readonly [number, number];
    chorusMedianMidi: readonly [number, number];
    p90MaxMidi: number;
  }>;
  arrangement: Readonly<{
    maxNotes: number;
    seconds: readonly [number, number];
    silentVocalShare: readonly [number, number];
  }>;
  quality: Readonly<{
    mixRecall: number;
    denseMixRecall: number;
    denseAboveBpm: number;
    mixSoloRetention: number;
  }>;
}>;

/** The only numeric house policy; all consumers and resource prose reference it. */
export const HOUSE_PROFILE: HouseProfile = Object.freeze({
  ...house,
  bpm: Object.freeze({ ...house.bpm }),
  harmony: Object.freeze({
    ...house.harmony,
    mode: "major",
    diatonic: true,
    modulation: false,
  }),
  voice: Object.freeze({
    engine: "kokoro-world",
    id: "bf_emma",
    language: "b",
  }),
  register: Object.freeze({
    ...house.register,
    verseMidi: Object.freeze([...house.register.verseMidi]) as readonly [
      number,
      number,
    ],
    chorusMedianMidi: Object.freeze([
      ...house.register.chorusMedianMidi,
    ]) as readonly [number, number],
  }),
  arrangement: Object.freeze({
    ...house.arrangement,
    seconds: Object.freeze([...house.arrangement.seconds]) as readonly [
      number,
      number,
    ],
    silentVocalShare: Object.freeze([
      ...house.arrangement.silentVocalShare,
    ]) as readonly [number, number],
  }),
  quality: Object.freeze({ ...house.quality }),
});

export type StageDefinition = Readonly<{
  id: string;
  title: string;
  dependsOn: readonly string[];
}>;
export type WorkflowDefinition = Readonly<{
  id: WorkflowId;
  version: string;
  title: string;
  instructions: string;
  resources: readonly string[];
  capabilities: readonly string[];
  stages: readonly StageDefinition[];
}>;

const stage = (
  id: string,
  title: string,
  ...dependsOn: string[]
): StageDefinition =>
  Object.freeze({ id, title, dependsOn: Object.freeze(dependsOn) });
const shared = [
  "references/house.md",
  "references/readiness.md",
  "references/source-use.md",
  "house-v1.json",
  "job.schema.json",
];

export const WORKFLOWS: readonly WorkflowDefinition[] = Object.freeze(
  [
    {
      id: "original-house",
      version: "1.0.0",
      title: "Write an original house song",
      instructions: "original-house/SKILL.md",
      resources: [
        ...shared,
        "references/vocals.md",
        "references/chart-format.md",
        "chart.schema.json",
        "examples/original.chart.json",
      ],
      capabilities: [
        "project.write.v1",
        "score.commit.v1",
        "vocal.stock.v1",
        "audio.render.v1",
        "audio.measure.v1",
      ],
      stages: [
        stage("plan", "Write the song"),
        stage("compose", "Compose a playable draft", "plan"),
        stage("vocals", "Sing original words", "compose"),
        stage("arrange", "Develop the arrangement", "compose"),
        stage("verify", "Check words and mix", "vocals", "arrange"),
        stage("export", "Export the accepted song", "verify"),
      ],
    },
    {
      id: "reference-study",
      version: "1.0.0",
      title: "Study a reference's production",
      instructions: "reference-study/SKILL.md",
      resources: [...shared, "references/reference-analysis.md"],
      capabilities: [
        "project.write.v1",
        "media.ingest.v1",
        "media.stems.v1",
        "media.analyze.v1",
        "reference.measure.v1",
      ],
      stages: [
        stage("ingest", "Import the reference"),
        stage("analyze", "Separate and analyze", "ingest"),
        stage("measure", "Measure production and form", "analyze"),
        stage("distill", "Distill reusable principles", "measure"),
      ],
    },
    {
      id: "recreate-source",
      version: "1.0.0",
      title: "Recreate a source as an editable private study",
      instructions: "recreate-source/SKILL.md",
      resources: [
        ...shared,
        "references/vocals.md",
        "references/reference-analysis.md",
      ],
      capabilities: [
        "project.write.v1",
        "score.commit.v1",
        "media.ingest.v1",
        "media.stems.v1",
        "media.analyze.v1",
        "reference.measure.v1",
        "reference.rebuild.v1",
        "vocal.stock.v1",
        "audio.render.v1",
        "audio.measure.v1",
      ],
      stages: [
        stage("ingest", "Import the source"),
        stage("analyze", "Separate and analyze", "ingest"),
        stage("map", "Fit timing and map the song", "analyze"),
        stage("rebuild", "Rebuild musical parts", "map"),
        stage("vocals", "Re-sing source words", "map"),
        stage("verify", "Compare the reconstruction", "rebuild", "vocals"),
        stage("export", "Export the private study", "verify"),
      ],
    },
  ].map((workflow) =>
    Object.freeze({
      ...workflow,
      resources: Object.freeze(workflow.resources),
      capabilities: Object.freeze(workflow.capabilities),
      stages: Object.freeze(workflow.stages),
    }),
  ) as WorkflowDefinition[],
);

export function getWorkflow(id: string): WorkflowDefinition {
  const workflow = WORKFLOWS.find((entry) => entry.id === id);
  if (!workflow) fail(`unknown workflow: ${id.slice(0, 80)}`);
  return workflow;
}

export function listWorkflows(): readonly WorkflowDefinition[] {
  return WORKFLOWS;
}

/** Package-relative resources only; neither cwd nor developer home paths participate. */
export async function readWorkflowResource(
  workflowId: string,
  resource?: string,
): Promise<string> {
  const workflow = getWorkflow(workflowId);
  const path = resource ?? workflow.instructions;
  if (path !== workflow.instructions && !workflow.resources.includes(path))
    fail("resource is not part of the selected workflow");
  const data = await readFile(
    new URL(`../../workflows/${path}`, import.meta.url),
  );
  if (data.byteLength > 32 * 1024)
    fail("workflow resource exceeds its byte limit");
  return data.toString("utf8");
}

/** Missing capabilities remain explicit; selecting a workflow never runs it. */
export function missingWorkflowCapabilities(
  workflowId: string,
  available: readonly string[],
): readonly string[] {
  const enabled = new Set(available);
  return getWorkflow(workflowId).capabilities.filter(
    (capability) => !enabled.has(capability),
  );
}
