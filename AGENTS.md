# AGENTS.md

Guidance for AI coding agents (and humans) working on **opencode-appshot**, an OpenCode Desktop
GUI plugin that attaches a screenshot and the Accessibility text of any macOS window to the composer.

## Layout

| Path | What it is |
|------|------------|
| `src/gui.tsx` | Plugin entry (`Plugin.define`): `setup` runs in every window (pill, `/appshot`), `main` runs in Electron's main process |
| `src/contract.ts` | `Ipc` contract between window and main, with `effect` Schemas |
| `src/helper.ts` | Main-process code that spawns the Swift helper and writes captures |
| `native/appshot-helper/` | Swift CLI: `list`, `permissions`, `capture` (prints JSON) |
| `scripts/build-helper.sh` | Builds the universal helper into `bin/` (macOS only) |
| `.github/workflows/ci.yml` | Typecheck/bundle on Linux, build helper + pack on macOS |

## Commands

Use **pnpm** (version pinned in `package.json` → `packageManager`). Do not use npm or yarn.

```sh
pnpm install          # --frozen-lockfile in CI
pnpm typecheck
pnpm build:gui        # works on any OS
pnpm build            # helper + bundle, macOS only
```

Run `pnpm typecheck && pnpm build:gui` before every commit that touches `src/`.

## Rules that are easy to break

- **`effect` is pinned to the exact version `@opencode/plugin` depends on.** Never bump it on its own;
  update it together with the SDK and verify with `pnpm why effect` (one version only).
- **Node built-ins are imported lazily** (`await import("node:…")`) in `src/helper.ts`. The host evaluates
  the whole bundle in the renderer too, so top-level Node imports must not be added.
- **Composer file parts must be workspace paths.** Captures go to `<project>/.opencode/appshots/`.
- **Ipc ids must start with the plugin id**, which is the package name (`opencode-appshot`).
- The GUI plugin API is **experimental**: check `node_modules/@opencode/plugin/dist/gui/*.d.ts` for the
  real shapes before using an API. Don't rely on memory.
- The helper's stdout is a JSON contract with `src/helper.ts`. Change both sides together.
- **Pin every GitHub Action to a full commit SHA**, with the exact version as a trailing comment:
  `uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`. Never use a tag or
  branch. Dependabot updates the SHA and the comment together. Tool versions that an action
  downloads get pinned too, for example actionlint's `version:`.
- CI runs actionlint, with shellcheck on `run:` blocks. Check workflows locally with `actionlint` before pushing.

## Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/) and write the subject in the
**imperative mood**: "add", "fix", "remove". Don't write "added", "fixes" or "removing".

```
<type>(<optional scope>): <imperative summary, lowercase, no period, ≤ 72 chars>

<optional body: what and why, wrapped at 72 chars>

<optional footers, e.g. BREAKING CHANGE: …, Co-Authored-By: …>
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build` (deps, packaging, build scripts),
`ci`, `chore`, `revert`.

**Scopes** (optional): `gui`, `helper`, `ipc`, `ci`, `deps`.

**Intentional commits:**
- Each commit holds one logical change. Don't mix a refactor with a feature, or formatting with a fix.
- Every commit should build and typecheck on its own.
- The body explains *why* when the diff doesn't make it obvious.
- Breaking changes to the Ipc contract or the helper's JSON get a `!` (`feat(ipc)!: …`) and a
  `BREAKING CHANGE:` footer.

Examples:

```
feat(gui): add thumbnail previews to the window picker
fix(helper): match AX windows by frame before title
build(deps): bump @opencode/plugin to 2.5.0 and effect to 4.2.0
ci: cache the Swift build directory
docs: explain Screen Recording permission in README
```

Don't rewrite published history on `master`. Fix mistakes with a new commit.
