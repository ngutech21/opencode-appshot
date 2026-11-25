#!/usr/bin/env bash
# Checks the built helper: universal binary, and JSON output in the shape
# src/helper.ts expects. Runners come with TCC pre-granted, so this only
# checks the shape of `permissions`, not the values.
set -euo pipefail

helper="${1:-bin/appshot-helper}"

file "$helper"
lipo "$helper" -verify_arch arm64 x86_64

"$helper" permissions | tee /dev/stderr | node -e '
  const p = JSON.parse(require("fs").readFileSync(0, "utf8"));
  if (typeof p.screenRecording !== "boolean" || typeof p.accessibility !== "boolean") process.exit(1);
'
"$helper" list | node -e 'if (!Array.isArray(JSON.parse(require("fs").readFileSync(0, "utf8")))) process.exit(1)'
