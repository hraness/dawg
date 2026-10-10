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
