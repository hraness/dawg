import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Chart } from "../../core/distill/hyperpop/chart/format.ts";
import { decodeLoop } from "../../core/loop.ts";
import type { CommandRunner } from "../auth/runner.ts";
import { runMakeCommand, type MakeServices } from "../make.ts";
import {
  parseVocalBookSpec,
  VOCAL_MODEL,
  type VocalBookSpec,
} from "../vocals/index.ts";
import { expectedVocalFrames } from "../vocals/spec.ts";
import { readWorkflowResource } from "./catalog.ts";
import { WorkflowCoordinator } from "./coordinator.ts";
import { runOriginalSong } from "./original.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "dawg-original-"));
  roots.push(root);
  return {
    root,
    chart: JSON.parse(
      await readWorkflowResource(
        "original-house",
        "examples/original.chart.json",
      ),
    ) as Chart,
  };
}
const sink = () => {
  let text = "";
  return {
    write: (value: string) => {
      text += value;
    },
    get text() {
      return text;
    },
  };
};
function fakeVocal(before?: () => Promise<void>) {
  let calls = 0;
  const runner: CommandRunner = {
    which: () => undefined,
    async run(_command, args, options = {}) {
      calls++;
      await before?.();
      options.signal?.throwIfAborted();
      const spec = parseVocalBookSpec(
        JSON.parse(await readFile(args.at(-2)!, "utf8")),
      );
      const frames = expectedVocalFrames(spec);
      const wav = Buffer.alloc(44 + frames * 2);
      wav.write("RIFF");
      wav.writeUInt32LE(wav.length - 8, 4);
      wav.write("WAVEfmt ", 8);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(24000, 24);
      wav.writeUInt32LE(48000, 28);
      wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34);
      wav.write("data", 36);
      wav.writeUInt32LE(frames * 2, 40);
      for (let frame = 0; frame < frames; frame++)
        wav.writeInt16LE(
          Math.round(Math.sin((frame * 2 * Math.PI * 440) / 24000) * 8000),
          44 + frame * 2,
        );
      await writeFile(args.at(-1)!, wav);
      let cursor = 0;
      const slices = spec.parts.map(([name, beats]) => {
        const begin = cursor;
        cursor += Math.round((((beats + spec.lead) * 60) / spec.bpm) * 24000);
        return {
          name,
          begin: Number((begin / frames).toFixed(6)),
          end: Number((cursor / frames).toFixed(6)),
        };
      });
      return {
        code: 0,
        killed: false,
        stderr: "",
        stdout: JSON.stringify({
          seconds: Number((frames / 24000).toFixed(6)),
          slices,
          provenance: {
            python: "3.12.8",
            dependencies: {
              kokoro: "0.9.4",
              misaki: "0.9.4",
              pyworld: "0.3.5",
              numpy: "2.5.4",
              soundfile: "0.14.0",
              torch: "2.14.1",
              spacy: "3.8.7",
              en_core_web_sm: "3.8.0",
            },
            model: VOCAL_MODEL,
          },
        }),
      };
    },
  };
  return {
    runner,
    get calls() {
      return calls;
    },
    backend: { python: process.execPath, source: "configured" as const },
  };
}

describe("original house workflow", () => {
  test("abort between written stages cancels this execution's newly committed epoch", async () => {
    const { root, chart } = await fixture();
    const controller = new AbortController(),
      coordinator = new WorkflowCoordinator(root),
      backend = fakeVocal();
    await expect(
      runOriginalSong({
        workspace: root,
        chart,
        coordinator,
        vocal: backend,
        signal: controller.signal,
        onProgress: (line) => {
          if (line.startsWith("instrumental draft →"))
            controller.abort(
              new DOMException("stop between stages", "AbortError"),
            );
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const [job] = await coordinator.list();
    expect(job!.status).toBe("cancelled");
    expect(job!.stages.find((stage) => stage.id === "compose")?.status).toBe(
      "complete",
    );
    expect(job!.stages.find((stage) => stage.id === "vocals")?.status).toBe(
      "pending",
    );
    expect(job!.artifacts.map((artifact) => artifact.id)).toEqual([
      "chart",
      "instrumental",
    ]);
    expect(backend.calls).toBe(0);
    coordinator.dispose();
  });

  for (const interruption of ["cancel", "takeover"] as const)
    test(`a provider ignoring ${interruption} cannot poison or cancel a different resumed chart attempt`, async () => {
      const { root, chart } = await fixture();
      const oldOwner = new WorkflowCoordinator(root),
        successor = new WorkflowCoordinator(root);
      const job = await oldOwner.create({
        workflowId: "original-house",
        id: `late-${interruption}`,
      });
      let oldStarted!: () => void, deliverOld!: (chart: Chart) => void;
      const started = new Promise<void>((resolve) => {
        oldStarted = resolve;
      });
      const delayed = new Promise<Chart>((resolve) => {
        deliverOld = resolve;
      });
      const oldRun = runOriginalSong({
        workspace: root,
        jobId: job.id,
        coordinator: oldOwner,
        createChart: async () => {
          oldStarted();
          return delayed;
        },
      });
      const staleResult = oldRun.then(
        () => {
          throw new Error("stale provider was accepted");
        },
        (error: unknown) => error,
      );
      await started;
      if (interruption === "cancel") await oldOwner.cancel(job.id);
      await oldOwner.resume(job.id);
      let nextStarted!: () => void, deliverNext!: (chart: Chart) => void;
      const nextEntered = new Promise<void>((resolve) => {
        nextStarted = resolve;
      });
      const nextProvider = new Promise<Chart>((resolve) => {
        deliverNext = resolve;
      });
      const backend = fakeVocal(),
        progress: string[] = [];
      const newRun = runOriginalSong({
        workspace: root,
        jobId: job.id,
        coordinator: successor,
        createChart: async () => {
          nextStarted();
          return nextProvider;
        },
        vocal: backend,
        onProgress: (line) => progress.push(line),
      });
      await nextEntered;
      const running = await successor.inspect(job.id);
      expect(running.stages.find((stage) => stage.id === "plan")?.attempt).toBe(
        2,
      );
      await expect(successor.cancel(job.id, job.epoch)).rejects.toThrow(
        "stale cancellation",
      );
      deliverOld(chart);
      expect(await staleResult).toBeInstanceOf(Error);
      expect((await successor.inspect(job.id)).epoch).toBe(running.epoch);
      expect((await successor.inspect(job.id)).status).toBe("running");
      const stalePath = `songs/${job.id}/chart-e${job.epoch}-a1.json`;
      expect(await Bun.file(join(root, stalePath)).exists()).toBe(false);
      // Even a file from the narrow post-check/write race belongs only to the stale attempt.
      await mkdir(join(root, "songs", job.id), { recursive: true });
      const staleBytes = `${JSON.stringify(chart)}\n`;
      await writeFile(join(root, stalePath), staleBytes);
      const different = {
        ...chart,
        title: `New ${interruption} song`,
        bpm: 126,
      };
      deliverNext(different);
      const accepted = await newRun;
      expect(accepted.job.status).toBe("complete");
      expect(accepted.chartPath).toBe(
        `songs/${job.id}/chart-e${running.epoch}-a2.json`,
      );
      expect(
        JSON.parse(await readFile(join(root, accepted.chartPath), "utf8")),
      ).toEqual(different);
      expect(await readFile(join(root, stalePath), "utf8")).toBe(staleBytes);
      expect(
        progress.some((line) => line.includes(`--from ${accepted.chartPath}`)),
      ).toBe(true);
      expect(backend.calls).toBe(1);
      const replay = await runOriginalSong({
        workspace: root,
        chart: different,
        chartSource: accepted.chartPath,
        vocal: { backendOptions: { python: "/nonexistent-dawg-python" } },
      });
      expect(replay.job.id).toBe(job.id);
      expect(replay.chartPath).toBe(accepted.chartPath);
      expect(await readFile(join(root, accepted.chartPath), "utf8")).toBe(
        `${JSON.stringify(different)}\n`,
      );
      oldOwner.dispose();
      successor.dispose();
    });

  test("performer-invalid provider charts never become accepted plans", async () => {
    const { root, chart } = await fixture();
    const malformed: Chart = {
      ...chart,
      sections: chart.sections.map((section) => ({
        ...section,
        moves: [
          {
            move: "stutter",
            bar: 0,
            beat: 0,
            count: 1,
            step: 0.25,
            notes: "banana",
            word: "go",
          },
        ],
      })),
    };
    await expect(
      runOriginalSong({ workspace: root, createChart: async () => malformed }),
    ).rejects.toThrow("not a degree");
    const coordinator = new WorkflowCoordinator(root),
      [job] = await coordinator.list();
    expect(job!.artifacts).toHaveLength(0);
    expect(job!.stages.find((stage) => stage.id === "plan")?.status).toBe(
      "failed",
    );
    expect(
      await Bun.file(join(root, "songs", job!.id, "chart-e0-a1.json")).exists(),
    ).toBe(false);
    coordinator.dispose();
  });

  test("explicit job replay binds the admitted chart and configuration before completed shortcuts", async () => {
    const { root, chart } = await fixture();
    const backend = fakeVocal();
    await expect(
      runOriginalSong({
        workspace: root,
        chart,
        vocal: { backendOptions: { python: "/nonexistent-dawg-python" } },
      }),
    ).rejects.toThrow("DAWG_VOCAL_PYTHON");
    const coordinator = new WorkflowCoordinator(root);
    const [failed] = await coordinator.list();
    let authored = 0;
    const resume = {
      workspace: root,
      jobId: failed!.id,
      coordinator,
      createChart: async () => {
        authored++;
        throw new Error("accepted chart must not be rewritten");
      },
      vocal: backend,
    };
    await expect(
      runOriginalSong({
        ...resume,
        chart: { ...chart, title: "Different chart" },
      }),
    ).rejects.toThrow("supplied chart differs");
    expect((await coordinator.inspect(failed!.id)).epoch).toBe(failed!.epoch);
    const accepted = await runOriginalSong(resume);
    await expect(
      runOriginalSong({ ...resume, chart: { ...chart, bpm: 123 } }),
    ).rejects.toThrow("supplied chart differs");
    const replay = await runOriginalSong({
      ...resume,
      vocal: { backendOptions: { python: "/nonexistent-dawg-python" } },
    });
    expect(replay.score.toJSON()).toEqual(accepted.score.toJSON());
    expect(replay.job.id).toBe(failed!.id);
    expect(authored).toBe(0);
    expect(backend.calls).toBe(1);
    const other = await coordinator.create({
      workflowId: "original-house",
      id: "different-config",
    });
    const path = `songs/${other.id}/chart.json`,
      contents = `${JSON.stringify(chart)}\n`;
    await mkdir(join(root, "songs", other.id), { recursive: true });
    await writeFile(join(root, path), contents);
    const ticket = await coordinator.startStage(other.id, "plan");
    await coordinator.completeStage(ticket, {
      artifacts: [
        {
          id: "chart",
          path,
          kind: "analysis",
          bytes: Buffer.byteLength(contents),
          sha256: createHash("sha256").update(contents).digest("hex"),
          producer: {
            name: "original-song",
            version: "1.0.0",
            configHash: "0".repeat(64),
          },
        },
      ],
    });
    await expect(
      runOriginalSong({
        workspace: root,
        jobId: other.id,
        coordinator,
        chart,
        vocal: backend,
      }),
    ).rejects.toThrow("chart configuration differs");
    expect(backend.calls).toBe(1);
    coordinator.dispose();
  });

  test("stock replay and chart copies never overwrite accepted assets or unrelated user data", async () => {
    const { root, chart } = await fixture();
    const backend = fakeVocal();
    const accepted = await runOriginalSong({
      workspace: root,
      chart,
      vocal: backend,
    });
    const take = accepted.job.artifacts.find(
      (artifact) => artifact.id === "vocal-audio",
    )!;
    const book = accepted.job.artifacts.find(
      (artifact) => artifact.id === "vocal-book",
    )!;
    const originalWav = await readFile(join(root, take.path));
    const originalBook = await readFile(join(root, book.path));
    const replay = {
      workspace: root,
      chart,
      chartSource: accepted.chartPath,
      vocal: backend,
    };
    await expect(
      runOriginalSong({ ...replay, output: take.path }),
    ).rejects.toThrow(".track.json");
    await expect(
      runOriginalSong({ ...replay, chartOutput: book.path }),
    ).rejects.toThrow("accepted vocal");
    await expect(
      runOriginalSong({ ...replay, chartOutput: accepted.scorePath }),
    ).rejects.toThrow("admitted workflow artifact");
    await writeFile(join(root, "user.track.json"), "existing user data");
    await expect(
      runOriginalSong({ ...replay, output: "user.track.json" }),
    ).rejects.toThrow("checkpoint differs");
    expect(await readFile(join(root, "user.track.json"), "utf8")).toBe(
      "existing user data",
    );
    expect(await readFile(join(root, take.path))).toEqual(originalWav);
    expect(await readFile(join(root, book.path))).toEqual(originalBook);
    const copy = await runOriginalSong({
      ...replay,
      output: "copy.track.json",
    });
    const again = await runOriginalSong({
      ...replay,
      output: "copy.track.json",
    });
    expect(copy.score.toJSON()).toEqual(again.score.toJSON());
    expect(backend.calls).toBe(1);
  });

  test("a fake provider and stock backend preserve chart/draft before inference and reuse accepted song offline", async () => {
    const { root, chart } = await fixture();
    const coordinator = new WorkflowCoordinator(root);
    let writes = 0;
    const backend = fakeVocal(async () => {
      const [job] = await coordinator.list();
      expect(job?.stages.find((stage) => stage.id === "compose")?.status).toBe(
        "complete",
      );
      const plan = job!.artifacts.find((artifact) => artifact.id === "chart")!;
      const draft = job!.artifacts.find(
        (artifact) => artifact.id === "instrumental",
      )!;
      expect(JSON.parse(await readFile(join(root, plan.path), "utf8"))).toEqual(
        chart,
      );
      expect(
        decodeLoop(await readFile(join(root, draft.path), "utf8"))
          .tracks.filter((track) => track.instrument === "vocal")
          .every((track) => track.muted),
      ).toBe(true);
      expect(job!.audibleRevision).toBeNull();
    });
    const services: MakeServices = {
      coordinator,
      createChart: async () => {
        writes++;
        return chart;
      },
      vocal: backend,
    };
    const stdout = sink();
    const stderr = sink();
    const code = await runMakeCommand(
      ["make", "a new song about a porch light", "--out", "song.track.json"],
      root,
      stdout,
      stderr,
      undefined,
      undefined,
      services,
    );
    expect(code).toBe(0);
    expect(stderr.text).toBe("");
    expect(writes).toBe(1);
    expect(backend.calls).toBe(1);
    expect(stdout.text).toContain("instrumental draft");
    expect(stdout.text).toContain("words/tone review pending");
    const [job] = await coordinator.list();
    expect(job?.status).toBe("complete");
    const score = decodeLoop(
      await readFile(join(root, "song.track.json"), "utf8"),
    );
    expect(
      score.tracks.some(
        (track) =>
          track.id === "bvox" &&
          Object.values(track.sampler?.voices ?? {}).some((sample) =>
            sample.src.startsWith("tracks/vocals/"),
          ),
      ),
    ).toBe(true);
    const chartPath = job!.artifacts.find(
      (artifact) => artifact.id === "chart",
    )!.path;
    const replay = await runMakeCommand(
      ["make", "--from", chartPath, "--out", "replay.track.json"],
      root,
      sink(),
      sink(),
      undefined,
      undefined,
      {
        createChart: async () => {
          throw new Error("must not rewrite");
        },
        vocal: { backendOptions: { python: "/nonexistent-dawg-python" } },
      },
    );
    expect(replay).toBe(0);
    expect(await readFile(join(root, "replay.track.json"), "utf8")).toBe(
      await readFile(join(root, "song.track.json"), "utf8"),
    );
    coordinator.dispose();
  });

  test("missing model setup leaves saved authored inputs and --from resumes without a new chart call", async () => {
    const { root, chart } = await fixture();
    let authored = 0;
    const firstError = sink();
    expect(
      await runMakeCommand(
        ["make", "a song about a porch light"],
        root,
        sink(),
        firstError,
        undefined,
        undefined,
        {
          createChart: async () => {
            authored++;
            return chart;
          },
          vocal: { backendOptions: { python: "/nonexistent-dawg-python" } },
        },
      ),
    ).toBe(1);
    expect(firstError.text).toContain("DAWG_VOCAL_PYTHON");
    const coordinator = new WorkflowCoordinator(root);
    const [failed] = await coordinator.list();
    expect(failed?.status).toBe("failed");
    expect(failed?.stages.find((stage) => stage.id === "vocals")?.status).toBe(
      "failed",
    );
    const chartPath = failed!.artifacts.find(
      (artifact) => artifact.id === "chart",
    )!.path;
    const saved = await readFile(join(root, chartPath), "utf8");
    const backend = fakeVocal();
    const error = sink();
    expect(
      await runMakeCommand(
        ["make", "--from", chartPath, "--out", "finished.track.json"],
        root,
        sink(),
        error,
        undefined,
        undefined,
        {
          createChart: async () => {
            authored++;
            throw new Error("fresh authoring forbidden");
          },
          vocal: backend,
        },
      ),
    ).toBe(0);
    expect(error.text).toBe("");
    expect(authored).toBe(1);
    expect(backend.calls).toBe(1);
    expect(await readFile(join(root, chartPath), "utf8")).toBe(saved);
    const resumed = await coordinator.inspect(failed!.id);
    expect(resumed.stages.find((stage) => stage.id === "plan")?.attempt).toBe(
      1,
    );
    expect(resumed.stages.find((stage) => stage.id === "vocals")?.attempt).toBe(
      2,
    );
    coordinator.dispose();
  });

  test("explicit synth/instrumental chart paths stay offline and honestly labeled", async () => {
    const { root, chart } = await fixture();
    await writeFile(join(root, "chart.json"), JSON.stringify(chart));
    for (const flag of [["--voice", "synth"], ["--instrumental"]]) {
      const stdout = sink();
      expect(
        await runMakeCommand(
          [
            "make",
            "--from",
            "chart.json",
            ...flag,
            "--out",
            `${flag[0]!.slice(2)}.track.json`,
          ],
          root,
          stdout,
          sink(),
        ),
      ).toBe(0);
      expect(stdout.text).toContain("draft");
    }
    expect(await Bun.file(join(root, ".dawg/workflows/jobs")).exists()).toBe(
      false,
    );
    expect(
      await runMakeCommand(
        ["make", "--from", "chart.json", "--voice", "someone-else"],
        root,
        sink(),
        sink(),
      ),
    ).toBe(2);
  });

  test("cancel during fake stock generation preserves completed plan and instrumental checkpoint", async () => {
    const { root, chart } = await fixture();
    const abort = new AbortController();
    const backend = fakeVocal(async () => {
      abort.abort(new DOMException("stopped", "AbortError"));
    });
    await expect(
      runOriginalSong({
        workspace: root,
        chart,
        signal: abort.signal,
        vocal: backend,
      }),
    ).rejects.toMatchObject({ name: "VocalCancelledError" });
    const coordinator = new WorkflowCoordinator(root);
    const [job] = await coordinator.list();
    expect(job?.status).toBe("cancelled");
    expect(job?.artifacts.map((artifact) => artifact.id)).toEqual([
      "chart",
      "instrumental",
    ]);
    expect(job?.stages.find((stage) => stage.id === "compose")?.status).toBe(
      "complete",
    );
    coordinator.dispose();
  });
});
