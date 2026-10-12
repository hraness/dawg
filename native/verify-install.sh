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
  const { DEMOS, createDemo } = await load("core/demos/index.ts");
  const { BUNDLED_SAMPLES, bundledSampleRef } = await load("core/bundled-samples.ts");
  const { createScore } = await load("core/score.ts");
  const { readBundledSample } = await load("src/audio/bundled-samples.ts");
  const { PackStore } = await load("src/audio/packs.ts");
  const { SampleLibrary } = await load("src/audio/samples.ts");
  const workspace = process.env.DAWG_OFFLINE;
  await mkdir(workspace, { recursive: true });
  const packs = new PackStore({ dir: resolve(workspace, "packs"), offline: true, fetch: globalThis.fetch });
  const samples = new SampleLibrary({ projectRoot: workspace, packs });
  for (const sample of BUNDLED_SAMPLES) await readBundledSample(sample.id, sample.sha256);
  const shelf = createScore({ tracks: BUNDLED_SAMPLES.map((sample) => ({
    id: sample.id, name: sample.title, instrument: "sampler",
    sampler: { mode: "keyed", voices: { voice: bundledSampleRef(sample.id) } },
  })) });
  for (const [id, score] of [["sample shelf", shelf], ...DEMOS.map((demo) => [demo.id, createDemo(demo.id)])]) {
    const bank = await samples.load(score);
    if (bank.problems.length) throw new Error(`${id}: ${JSON.stringify(bank.problems)}`);
  }
  console.log(`offline install verified: ${DEMOS.length} demos and ${BUNDLED_SAMPLES.length} SHA-256 pinned samples`);
'
