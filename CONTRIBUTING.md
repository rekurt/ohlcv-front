# Contributing to @rekurt/ohlcv

Thanks for your interest! This project is a TypeScript monorepo with
three published packages (`@rekurt/ohlcv-core`, `-react`, `-vue`) plus
example apps and a unified playground.

## Prerequisites

- Node.js 20 or newer
- npm 10+

## One-time setup

```bash
git clone https://github.com/rekurt/ohlcv-front.git
cd ohlcv-front
npm install
```

`npm install` links the three `packages/*` into each other and into the
example apps via npm workspaces — you do not need to build before running
the dev servers.

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev:playground` | Unified demo at http://localhost:5176 (recommended for interactive work) |
| `npm run dev:core` | Vanilla TS example at http://localhost:5173 |
| `npm run dev:react` | React example at http://localhost:5174 |
| `npm run dev:vue` | Vue example at http://localhost:5175 |
| `npm test` | Run vitest test suite once (~450 tests) |
| `npm run test:watch` | Vitest watch mode |
| `npm run typecheck` | Strict TypeScript check across all six tsconfigs |
| `npm run lint` | ESLint (TS + React + Vue) — must be 0 warnings |
| `npm run lint:fix` | Auto-fix what ESLint can |
| `npm run build` | Build all three `packages/*` via tsup |
| `npm run build:examples` | Build the example apps (playground included) |
| `npm run docs` | Generate TypeDoc HTML into `docs/api/` |

## Project layout

```
packages/
├─ core/      @rekurt/ohlcv-core   — framework-agnostic rendering + data + interaction
├─ react/     @rekurt/ohlcv-react  — React 18+/19 wrapper
└─ vue/       @rekurt/ohlcv-vue    — Vue 3 wrapper
examples/
├─ core/          vanilla TS demo (minimal, used for bug repros)
├─ react/         React demo (minimal, used for bug repros)
├─ vue/           Vue demo (minimal, used for bug repros)
├─ playground/    unified demo with framework switcher + share URL
└─ _shared/       mock data feed + symbol/resolution fixtures
```

The three minimal examples are intentionally small and self-contained —
they are the first thing to reach for when writing a bug reproduction.
The unified playground is where new features land for visual inspection.

## Architectural rule

**Business logic lives in `@rekurt/ohlcv-core`.** The React and Vue
wrappers are thin adapters that translate props/reactivity into core
imperative calls. If you find yourself writing a `for` loop, an `if`
tree, or a diff function inside a wrapper, stop — move it into core as
a pure function and import it from both wrappers. This is how
`diffIndicatorConfigs` lives in core and is consumed identically by
React and Vue.

## Adding a new feature

1. **Start with a failing test.** Tests live next to the code they
   cover — e.g. `packages/core/src/state/saveLoadState.test.ts`
   alongside `packages/core/src/state/*`.
2. **Land the smallest possible change** that makes the test pass.
3. **Run the full check locally** before pushing:
   ```bash
   npm run lint && npm run typecheck && npm test && npm run build
   ```
4. **CI re-runs all of the above** on Node 20 and 22. Pages are
   re-published on every push to `master`.

## Commit conventions

This repo uses [Conventional Commits](https://www.conventionalcommits.org/):

- `feat(core): add saveLayoutState`
- `fix(react): preserve view on prop-driven data updates`
- `refactor: rename @ohlcv/* → @rekurt/ohlcv-*`
- `docs: M1 implementation plan`
- `chore: add ESLint flat config`
- `ci: add Pages workflow`
- `test(core): cover loadState validation error paths`

Scope (`core`, `react`, `vue`, `playground`, etc.) is encouraged but not
required for cross-cutting changes.

## Reporting bugs

- Use the three minimal `examples/{core,react,vue}` scaffolds as the
  base of your repro. Strip out everything that is not required to
  trigger the bug.
- Include: package name + version, browser, OS, and the output of
  `npm run lint && npm run typecheck`.
- If the bug is visual, attach a screenshot and a chart `LayoutState`
  from `chart.saveLayoutState()` (copy the `?state=` URL from the
  playground).

## Publishing

The 0.1.0 release is published manually. From `master`:

```bash
npm run lint && npm run typecheck && npm test && npm run build
npm version 0.1.0 --workspaces --no-git-tag-version
git commit -am "chore: release 0.1.0"
git tag v0.1.0
git push --follow-tags
cd packages/core   && npm publish --access public
cd ../react        && npm publish --access public
cd ../vue          && npm publish --access public
```

Later milestones will move publishing into a GitHub Actions release
workflow driven by changesets.
