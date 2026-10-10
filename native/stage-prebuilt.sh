#!/bin/sh
# Turn the downloaded CI artifacts (native/prebuilt/sink-<platform>/) into the
# shipped layout (native/prebuilt/<platform>/) and write manifest.json, which
# fails unless all four platforms are present. Used by release.yml and Check.
set -eu
dir="${1:-native/prebuilt}"
for artifact in "${dir}"/sink-*; do
  [ -d "${artifact}" ] || continue
  rm -rf "${dir}/${artifact##*/sink-}"
  mv "${artifact}" "${dir}/${artifact##*/sink-}"
done
bun native/manifest.ts "${dir}" --all
cat "${dir}/manifest.json"
