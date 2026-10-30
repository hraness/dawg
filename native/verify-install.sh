#!/bin/sh
# Install a packed dawg tarball into a temporary BUN_INSTALL and require that
# it runs and that `dawg doctor --json` reports the native sink for this
# platform verified (sha256 against the manifest) and loaded. Used by
# release.yml and Check. Usage: native/verify-install.sh <tarball>
set -eu
tarball="$1"
prefix="$(mktemp -d)"
trap 'rm -rf "${prefix}"' EXIT
BUN_INSTALL="${prefix}" bun add -g "${tarball}"
"${prefix}/bin/dawg" --help >/dev/null
"${prefix}/bin/dawg" doctor --json >"${prefix}/doctor.json"
cat "${prefix}/doctor.json"
DOCTOR="${prefix}/doctor.json" bun -e '
  const report = await Bun.file(process.env.DOCTOR).json();
  if (!report.native.loaded) {
    console.error(`native sink not loaded: ${report.native.reason}`);
    process.exit(1);
  }
  console.log(`native sink ${report.native.target} verified and loaded`);
'
# Resolve modules through the installed executable, never through this checkout.
# Missing allowlisted source or sample assets must fail PR and release packaging.
DAWG_BIN="${prefix}/bin/dawg" DAWG_OFFLINE="${prefix}/offline" bun -e '
  const { realpath, mkdir } = await import("node:fs/promises");
  const { dirname, resolve } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const main = await realpath(process.env.DAWG_BIN);
  const root = pathToFileURL(resolve(dirname(main), "..") + "/");
  const load = (path) => import(new URL(path, root).href);
  globalThis.fetch = async () => { throw new Error("offline install attempted network access"); };
  const { probeNativeDSP, DSP_TARGETS } = await load("src/audio/native-dsp.ts");
  const dsp = probeNativeDSP();
  if (DSP_TARGETS.includes(`${process.platform}-${process.arch}`) && !dsp.ok)
    throw new Error(`installed native DSP unavailable: ${dsp.reason}`);
  if (dsp.ok) { dsp.close(); console.log(`native DSP ${dsp.detail}`); }
  else console.log(`native DSP uses JavaScript: ${dsp.reason}`);
  const { DEMOS, createDemo } = await load("core/demos/index.ts");
  const { BUNDLED_SAMPLES, bundledSampleRef } = await load("core/bundled-samples.ts");
  const { createScore } = await load("core/score.ts");
  const { AudioCompute } = await load("src/audio/compute.ts");
  const { readBundledSample } = await load("src/audio/bundled-samples.ts");
  const { PackStore } = await load("src/audio/packs.ts");
  const { SampleLibrary } = await load("src/audio/samples.ts");
  const workspace = process.env.DAWG_OFFLINE;
  await mkdir(workspace, { recursive: true });
  const packs = new PackStore({ dir: resolve(workspace, "packs"), offline: true, fetch: globalThis.fetch });
  const samples = new SampleLibrary({ projectRoot: workspace, packs });
  const { listWorkflows, readWorkflowResource } = await load("src/workflows/index.ts");
  for (const workflow of listWorkflows()) {
    for (const resource of [workflow.instructions, ...workflow.resources]) {
      const body = await readWorkflowResource(workflow.id, resource);
      if (!body.trim()) throw new Error(`empty installed workflow resource: ${resource}`);
    }
  }
  const { VOCAL_HELPER, VOCAL_REQUIREMENTS, vocalHelperIdentity } = await load("src/vocals/index.ts");
  const { access } = await import("node:fs/promises");
  await access(VOCAL_HELPER);
  await access(VOCAL_REQUIREMENTS);
  await vocalHelperIdentity();
  await access(new URL("src/reference/python/reference.py", root));
  await access(new URL("src/reference/python/requirements.txt", root));
  console.log("installed workflow resources and optional vocal/reference helper closure verified");
  for (const sample of BUNDLED_SAMPLES) await readBundledSample(sample.id, sample.sha256);
  const shelf = createScore({ tracks: BUNDLED_SAMPLES.map((sample) => ({
    id: sample.id, name: sample.title, instrument: "sampler",
    sampler: { mode: "keyed", voices: { voice: bundledSampleRef(sample.id) } },
  })) });
  for (const [id, score] of [["sample shelf", shelf], ...DEMOS.map((demo) => [demo.id, createDemo(demo.id)])]) {
    const bank = await samples.load(score);
    if (bank.problems.length) throw new Error(`${id}: ${JSON.stringify(bank.problems)}`);
  }
  // Exercise the installed worker URL and its runtime import graph, not only
  // source imports. A short synthesized note needs no device or external pack.
  const compute = new AudioCompute(AbortSignal.timeout(15_000));
  try {
    const score = createScore({ tempoBpm: 120, bars: 1,
      tracks: [{ id: "bass", name: "Bass", instrument: "bass" }],
      notes: [{ id: "n", trackId: "bass", pitch: 48,
        startTick: 0, durationTicks: 480, velocity: 0.6 }],
    });
    const rendered = await compute.export(score, undefined, 8000, true, true);
    if (!(rendered.wav instanceof Uint8Array) || rendered.wav.length <= 44 ||
        new TextDecoder().decode(rendered.wav.subarray(0, 4)) !== "RIFF")
      throw new Error("installed compute worker produced no WAV");
    const pcm = await compute.chop.decodeWavBytes(rendered.wav);
    const peak = await compute.chop.peak(pcm);
    const quieter = await compute.chop.gain(pcm, -6);
    const quieterPeak = await compute.chop.peak(quieter);
    if (!(peak > 0.001) || !Number.isFinite(peak) || !Number.isFinite(quieterPeak) ||
        Math.abs(quieterPeak / peak - 10 ** (-6 / 20)) > 0.00001)
      throw new Error("installed compute worker export/chop audio check failed");
    console.log(`installed compute worker verified: ${rendered.frames} frames, export/decode/gain/peak`);
  } finally { compute.dispose(); }
  console.log(`offline install verified: ${DEMOS.length} demos and ${BUNDLED_SAMPLES.length} SHA-256 pinned samples`);
'
