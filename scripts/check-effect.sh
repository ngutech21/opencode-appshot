#!/usr/bin/env bash
# effect must resolve to exactly one version, the one @opencode/plugin
# depends on. A second copy breaks the Ipc schemas at runtime.
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck disable=SC2016 # the JavaScript is meant to stay unexpanded
pnpm why effect --json | node -e '
  const fs = require("fs")
  const versions = [...new Set(JSON.parse(fs.readFileSync(0, "utf8")).map((e) => e.version))]
  const sdk = JSON.parse(fs.readFileSync("node_modules/@opencode/plugin/package.json", "utf8"))
  const own = JSON.parse(fs.readFileSync("package.json", "utf8")).devDependencies.effect
  const wanted = sdk.dependencies.effect
  const errors = []
  if (versions.length !== 1) errors.push(`found ${versions.length} versions of effect: ${versions.join(", ")}`)
  if (own !== wanted) errors.push(`package.json pins effect ${own}, but @opencode/plugin ${sdk.version} depends on ${wanted}`)
  if (errors.length) {
    for (const e of errors) console.error(`error: ${e}`)
    console.error("Update effect together with @opencode/plugin (see AGENTS.md).")
    process.exit(1)
  }
  console.log(`effect ${versions[0]}, matching @opencode/plugin ${sdk.version}`)
'
