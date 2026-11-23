#!/usr/bin/env bash
# Builds a universal (arm64 + x86_64) appshot-helper into ./bin and ad-hoc signs it.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname)" != "Darwin" ]]; then
  echo "appshot-helper can only be built on macOS" >&2
  exit 1
fi

swift build -c release --arch arm64 --arch x86_64 --package-path native/appshot-helper
mkdir -p bin
cp native/appshot-helper/.build/apple/Products/Release/appshot-helper bin/appshot-helper
codesign --force --sign - bin/appshot-helper
lipo -info bin/appshot-helper
