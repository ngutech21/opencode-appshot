#!/usr/bin/env bash
# Builds a universal (arm64 + x86_64) appshot-helper into ./bin and ad-hoc signs it.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname)" != "Darwin" ]]; then
  echo "appshot-helper can only be built on macOS" >&2
  exit 1
fi

args=(-c release --arch arm64 --arch x86_64 --package-path native/appshot-helper)
swift build "${args[@]}"
# The output dir differs between Swift versions (.build/apple vs .build/out), so ask.
bin_path="$(swift build "${args[@]}" --show-bin-path)"
mkdir -p bin
cp "$bin_path/appshot-helper" bin/appshot-helper
codesign --force --sign - bin/appshot-helper
lipo -info bin/appshot-helper
