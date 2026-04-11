# M1 Foundations — Full wrapper API parity + first public release (0.1.0)

**Status**: Design approved, awaiting plan
**Date**: 2026-04-11
**Milestone**: M1 of 6 (roadmap to TradingView-class OSS library)

## Context

The repository already has a strong core (`@ohlcv/core`): 406 tests, strict
tsconfig, eight indicators (SMA, EMA, BB, RSI, MACD, Stochastic, ATR,
VWAP), four chart types (candles, line, area, ohlc), two drawing tools
(TrendLine, HorizontalLine), two data transforms (Heikin Ashi, Renko),
BinanceWsTransport, ErrorReporter, runtime validation. The Pane
abstraction class exists but is not yet wired into ChartEngine.

The weak link is **distribution**: the React and Vue wrappers expose only
~10% of core's public surface (symbol, resolution, transport, data,
theme, priceFormat, volumeFormat, onCandleClick, onVisibleRangeChange),
`version: 0.0.1` has never been published to npm, there is no CHANGELOG,
no CI, no hosted playground, no TypeDoc site. The just-committed
preserveView fix (46f8eea) revealed that the package `dist/` bundles
drift silently from `src/` — a symptom of missing release discipline.

The goal of M1 is not to add new core features. It is to bring the
distribution story up to the quality bar of the existing core and put a
publishable 0.1.0 into npm so the wider world can start using the
library and filing issues. Every milestone beyond M1 assumes M1 is
done — you cannot iterate on feature parity if nothing is shipped.

This is **milestone 1 of 6** in a roadmap toward a TradingView-class
open-source trading chart library. The roadmap is reproduced below for
navigation, but only M1 is designed in detail here. Each subsequent
milestone gets its own brainstorm → design → plan → implement cycle.

## Roadmap (6 milestones, each a separate brainstorm cycle)

| # | Version | Goal (distribution + features in parallel) |
|---|---|---|
| **M1** | **0.1.0** | **Full wrapper API parity + first public release.** Declarative props + imperative ref/expose for everything core exposes. `saveLayoutState` / `saveFullState` / `loadState`. npm publish under `@rekurt/ohlcv-*`. CI (lint + typecheck + test + build). TypeDoc API site. Unified playground on GitHub Pages. CHANGELOG + CONTRIBUTING. **No new indicators, chart types, drawing tools, data transforms, or transports** — only the plumbing (state serialization + indicator registry) required to wire wrappers to what core already has. |
| M2 | 0.2.0 | Multi-pane integration (Pane wired into ChartEngine, RSI/MACD in sub-panes). Log/percent Y scale. Fibonacci retracement drawing tool. Changesets-driven release workflow. |
| M3 | 0.3.0 | +6 indicators (Ichimoku, ZigZag, Pivot Points, ADX, CCI, Volume Profile). +5 drawings (rectangle, ellipse, ray, text label, vertical line). |
| M4 | 0.4.0 | Alerts engine (price/indicator cross). Replay mode. Compare mode (symbol overlay). |
| M5 | 0.5.0 | Workspaces — multi-chart 2×2 grid + workspace templates + workspace persistence. `<OHLCVWorkspace>` composite component. |
| M6 | 1.0.0 | Kagi / Point&Figure / Range bars. Timezone + session breaks. Full i18n. Full a11y (screen reader + visible focus). Performance pass. Stable 1.0. |

## M1 Scope

### In scope

1. Monorepo scope rename `@ohlcv/*` → `@rekurt/ohlcv-*`.
2. `@rekurt/ohlcv-core`: `ChartState` schema, `saveLayoutState`,
   `saveFullState`, `loadState`, `IndicatorConfig` discriminated union,
   `createIndicator` factory, `diffIndicatorConfigs` pure function,
   `getIndicators`, `getDrawingLayer`, `startDrawing`, `getDrawings`,
   `loadDrawings`.
3. `@rekurt/ohlcv-react`: full declarative props (including
   `indicators?: IndicatorConfig[]`), full imperative `ref` API, expanded
   `useOHLCVChart` hook to parity with component.
4. `@rekurt/ohlcv-vue`: reactive props (including `v-model:indicators`
   support), full emits, full `defineExpose`, expanded `useOHLCVChart`
   composable to parity.
5. New `examples/playground/` — unified demo with framework switcher,
   share-URL feature backed by `saveLayoutState`.
6. `.github/workflows/ci.yml` — lint + typecheck + test + build on PRs
   and pushes.
7. `.github/workflows/pages.yml` — builds playground + TypeDoc to
   `gh-pages` on `main` push.
8. ESLint configuration (TS + React + Vue) + `npm run lint` script.
9. TypeDoc setup in root `typedoc.json`.
10. Root `README.md` refresh (new package names, quickstarts, badges,
    links to playground and TypeDoc).
11. `CHANGELOG.md` manual 0.1.0 entry in Keep-a-Changelog format.
12. `CONTRIBUTING.md` with dev setup and PR conventions.
13. Manual publish of `@rekurt/ohlcv-core`, `@rekurt/ohlcv-react`,
    `@rekurt/ohlcv-vue` version 0.1.0 to npm.

### Out of scope (pushed to M2+)

- Any new indicators, chart types, drawing tools, data transforms, or
  transports.
- Multi-pane integration (Pane abstraction stays unwired).
- Log / percent / indexed Y scale.
- Alerts, replay, compare mode, multi-chart workspaces.
- Changesets + automated release workflow. The 0.1.0 release is manual
  `npm publish`; automation lands in M2.
- Removing the three existing framework-specific examples. They stay as
  minimal-repro scaffolds for issue reports alongside the new unified
  playground.
- Writing a Pane unit test or touching ChartEngine internals.

## Decomposition principle

Core vs wrappers vs infra — strict dependency direction:

- All business logic lives in `@rekurt/ohlcv-core`: state serialization,
  indicator factory, reconciliation diff, drawing lifecycle. Core has
  zero framework dependencies.
- `@rekurt/ohlcv-react` and `@rekurt/ohlcv-vue` are thin adapters. They
  translate props/reactivity into core imperative calls and core events
  into React callbacks / Vue emits. They contain no business logic. If
  a future `@rekurt/ohlcv-svelte` wrapper is added, it imports the same
  reconciliation from core and writes ~200 lines of adapter glue.
- Infrastructure (playground, TypeDoc, CI, CHANGELOG) is outside the
  published packages — it lives at repo root or under `examples/` and
  `docs/`.

## Architecture

```
packages/
├─ core/                         @rekurt/ohlcv-core
│  └─ src/
│     ├─ OHLCVChart.ts           + saveLayoutState / saveFullState / loadState
│     │                          + getIndicators / getDrawingLayer / startDrawing
│     ├─ state/                  NEW: serialization
│     │  ├─ ChartState.ts        LayoutState / FullState interfaces
│     │  ├─ saveState.ts         collector (pure function)
│     │  └─ loadState.ts         restorer + version validator
│     └─ indicators/
│        └─ registry.ts          NEW: IndicatorConfig union + createIndicator +
│                                diffIndicatorConfigs + indicatorId
│
├─ react/                        @rekurt/ohlcv-react
│  └─ src/
│     ├─ OHLCVChart.tsx          full props / forwardRef / useImperativeHandle
│     └─ useOHLCVChart.ts        headless hook to API parity
│
└─ vue/                          @rekurt/ohlcv-vue
   └─ src/
      ├─ OHLCVChart.ts           reactive props / emits / defineExpose
      └─ useOHLCVChart.ts        composable to API parity

examples/
├─ core/                         existing, minimal repro scaffold
├─ react/                        existing, minimal repro scaffold
├─ vue/                          existing, minimal repro scaffold
└─ playground/                   NEW unified demo w/ framework switcher
                                 + share-URL (saveLayoutState → base64 → ?state=)

docs/
├─ api/                          generated by TypeDoc (not checked in)
├─ CHANGELOG.md                  manual 0.1.0 entry
├─ CONTRIBUTING.md
└─ superpowers/specs/            this document

.github/workflows/
├─ ci.yml                        NEW: lint + typecheck + test + build
└─ pages.yml                     NEW: build playground + TypeDoc → gh-pages

typedoc.json                     NEW at root
.eslintrc.cjs / eslint.config.js NEW at root
```

## Component design

### 1. `ChartState` schema (`packages/core/src/state/ChartState.ts`)

```ts
export interface LayoutState {
  version: 1;
  symbol: string;
  resolution: string;
  chartType: ChartType;
  theme: ThemeMode | ThemeColors;
  viewport: {
    startIndex: number;
    candleWidth: number;
    autoFollow: boolean;
  };
  indicators: IndicatorConfig[];
  drawings: DrawingSnapshot[];
}

export interface FullState extends LayoutState {
  data: Candle[];
}

export type ChartState = LayoutState | FullState;

export function isFullState(s: ChartState): s is FullState {
  return Array.isArray((s as FullState).data);
}
```

Rationale for the split: `LayoutState` is URL-friendly (few KB JSON,
base64 fits in a query param). `FullState` is for persistence and bug
reproduction (typically 100 KB – 1 MB depending on buffer length).
`loadState` accepts either and discriminates on the presence of `data`.
`version: 1` is a schema version for future migrations.

### 2. Indicator registry (`packages/core/src/indicators/registry.ts`)

```ts
export type IndicatorConfig =
  | { type: 'sma'; period: number }
  | { type: 'ema'; period: number }
  | { type: 'bb';  period: number; stdDev: number }
  | { type: 'rsi'; period: number }
  | { type: 'macd'; fast: number; slow: number; signal: number }
  | { type: 'stoch'; kPeriod: number; dPeriod: number }
  | { type: 'atr'; period: number }
  | { type: 'vwap'; anchor: VWAPAnchor };

export function createIndicator(cfg: IndicatorConfig): Indicator;
export function indicatorId(cfg: IndicatorConfig): string;
export function diffIndicatorConfigs(
  prev: IndicatorConfig[],
  next: IndicatorConfig[],
): { changed: boolean; added: string[]; removed: string[]; kept: string[] };
```

The factory is the single path by which users create indicators in
wrapper-driven code. Users never write `new SMA(20)` in React/Vue
components — they write `{ type: 'sma', period: 20 }`. The `indicatorId`
function maps `{type:'sma',period:20}` to a stable string `"sma:20"` so
two equal configs diff as "kept". `diffIndicatorConfigs` is a pure
function (no core state reads) consumed by both wrappers — this is how
we guarantee zero logic duplication between React and Vue.

### 3. `OHLCVChart` additions (`packages/core/src/OHLCVChart.ts`)

New public methods (preserving existing API):

```ts
class OHLCVChart {
  // existing methods ...

  saveLayoutState(): LayoutState;
  saveFullState(): FullState;
  loadState(state: LayoutState | FullState): void;

  getIndicators(): readonly Indicator[];
  getDrawingLayer(): DrawingLayer | null;

  startDrawing(tool: 'trendline' | 'hline'): void;
  getDrawings(): DrawingSnapshot[];
  loadDrawings(snapshots: DrawingSnapshot[]): void;
}
```

`loadState` restore order is critical:

```
1. Validate state.version === 1 — else throw ValidationError
2. If isFullState(state): setData(state.data)  (else: preserve current buffer)
3. setChartType(state.chartType)
4. setTheme(state.theme)
5. setIndicators(state.indicators.map(createIndicator))
6. loadDrawings(state.drawings)
7. viewport.candleWidth = state.viewport.candleWidth
8. viewport.setLayout(viewport.layout)  // recalc visibleCount
9. viewport.startIndex = state.viewport.startIndex
10. viewport.autoFollow = state.viewport.autoFollow
11. engine.requestRender()
```

Wrong order symptoms: restoring `viewport.startIndex` before `setData`
makes the clamp snap to `[0, 0]`; restoring `chartType` after
`setIndicators` can trigger double-rendering; skipping `setLayout`
leaves a stale `visibleCount`.

### 4. `@rekurt/ohlcv-react` — `<OHLCVChart>` component

```tsx
interface OHLCVChartProps {
  // Identity
  symbol: string;
  resolution: string;
  // Data
  transport?: DataTransport;
  data?: Candle[];
  // Display
  theme?: ThemeMode | ThemeColors;
  chartType?: ChartType;
  locale?: string;
  priceFormat?: (price: number) => string;
  volumeFormat?: (volume: number) => string;
  idleCursor?: string | null;
  // Declarative feature array (reconciled via indicatorId)
  indicators?: IndicatorConfig[];
  // Callbacks
  onHover?: (info: HoverInfo | null) => void;
  onCandleClick?: (candle: Candle, index: number) => void;
  onVisibleRangeChange?: (from: number, to: number) => void;
  onError?: (err: ChartError) => void;
  onLoadMoreHistory?: (buffer: CandleBuffer) => void | Promise<void>;
  // Styling
  className?: string;
  style?: React.CSSProperties;
}

interface OHLCVChartRef {
  readonly chart: OHLCVChart | null;
  // Navigation
  goToLive(): void;
  fitVisible(): void;
  fitAll(): void;
  // Data manipulation
  prependHistory(olderCandles: Candle[]): void;
  updateLastCandle(candle: Candle): void;
  // State persistence
  saveLayoutState(): LayoutState | null;
  saveFullState(): FullState | null;
  loadState(state: LayoutState | FullState): void;
  // Drawings (workflow state machine, not declarative data)
  startDrawing(tool: 'trendline' | 'hline'): void;
  getDrawings(): DrawingSnapshot[];
  loadDrawings(snapshots: DrawingSnapshot[]): void;
  clearDrawings(): void;
  // Export
  toPNG(): string | null;
}

export const OHLCVChart = forwardRef<OHLCVChartRef, OHLCVChartProps>(...);
```

`indicators` is the one declarative feature array. Drawings are
intentionally imperative because they are an interactive workflow (click
to start, click to place anchor, click to complete, drag to move) —
round-tripping every click through React state would be both wasteful
and awkward.

Wrapper reconciliation pattern for `indicators`:

```tsx
const prevIndicatorsRef = useRef<IndicatorConfig[]>([]);
useEffect(() => {
  if (!chartRef.current) return;
  const next = props.indicators ?? [];
  const diff = diffIndicatorConfigs(prevIndicatorsRef.current, next);
  if (diff.changed) {
    chartRef.current.setIndicators(next.map(createIndicator));
  }
  prevIndicatorsRef.current = next;
}, [props.indicators]);
```

This re-creates instances only when the config array actually differs
by `indicatorId`. A hover-driven re-render that passes the same
reference through `useMemo` does nothing.

### 5. `@rekurt/ohlcv-react` — `useOHLCVChart` headless hook

Returns `{ containerRef, chart, ...imperativeMethods }` plus accepts
every prop the component accepts, for devs who do not want a `<div>`
wrapper component and prefer to build their own layout around the
canvas container.

### 6. `@rekurt/ohlcv-vue` — `<OHLCVChart>` component

```ts
const props = defineProps<{
  symbol: string;
  resolution: string;
  transport?: DataTransport;
  data?: Candle[];
  theme?: ThemeMode | ThemeColors;
  chartType?: ChartType;
  locale?: string;
  priceFormat?: (price: number) => string;
  volumeFormat?: (volume: number) => string;
  idleCursor?: string | null;
  indicators?: IndicatorConfig[];
}>();

const emit = defineEmits<{
  hover: [info: HoverInfo | null];
  'candle-click': [candle: Candle, index: number];
  'visible-range-change': [from: number, to: number];
  error: [err: ChartError];
  'load-more-history': [buffer: CandleBuffer];
  'update:indicators': [list: IndicatorConfig[]];  // enables v-model:indicators
}>();

defineExpose({
  get chart() { return chartRef.value; },
  goToLive, fitVisible, fitAll,
  prependHistory, updateLastCandle,
  saveLayoutState, saveFullState, loadState,
  startDrawing, getDrawings, loadDrawings, clearDrawings,
  toPNG,
});
```

Reconciliation:

```ts
watch(
  () => props.indicators,
  (next, prev) => {
    if (!chartRef.value) return;
    const diff = diffIndicatorConfigs(prev ?? [], next ?? []);
    if (diff.changed) {
      chartRef.value.setIndicators((next ?? []).map(createIndicator));
    }
  },
);
```

`update:indicators` is wired up but never emitted by the component in
M1 — it exists so users can adopt `v-model:indicators="myList"` today
and have it continue to work in future milestones when the chart may
auto-remove an indicator (e.g. due to a compute error).

### 7. Playground (`examples/playground/`)

New Vite + React app (chosen because it is the bigger of the two
frameworks and hosting both React and Vue in one page requires picking
one as the outer shell). Tabs:

- **Core** — vanilla TS demo (imports `@rekurt/ohlcv-core`, builds
  directly, no framework wrapper)
- **React** — `<OHLCVChart>` usage from `@rekurt/ohlcv-react`
- **Vue** — `<OHLCVChart>` from `@rekurt/ohlcv-vue`, mounted into a
  portal `<div>` inside the React-hosted page

Shared toolbar across tabs: theme, chartType, indicators picker,
drawing tools, clear, export PNG, **share this chart**.

"Share this chart" flow:
1. `chart.saveLayoutState()` → JSON
2. `btoa(JSON.stringify(state))` → base64
3. `navigator.clipboard.writeText(location.origin + '/playground/?state=' + b64)`
4. On page load: parse `?state=`, `atob`, `JSON.parse`, `chart.loadState(parsed)`

Bundle budget: ≤ 500 KB gzipped for the playground (React + Vue
interop + core + 3 wrappers, tree-shaken via Vite).

### 8. CI — `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [master]
  pull_request:
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: npm run build:examples
```

### 9. GitHub Pages — `.github/workflows/pages.yml`

Builds `examples/playground/` + runs TypeDoc, publishes `dist/` and
`docs/api/` together to `gh-pages` branch. Triggered on push to
`master`. Uses the GitHub Pages action.

URL layout:
- `https://rekurt.github.io/ohlcv-front/` → playground index
- `https://rekurt.github.io/ohlcv-front/api/` → TypeDoc API reference
- `https://rekurt.github.io/ohlcv-front/?state=<base64>` → playground
  preloaded with a saved chart layout

### 10. ESLint configuration

Flat config `eslint.config.js` at root:

- `@typescript-eslint/*` with the strict preset
- `eslint-plugin-react` + `eslint-plugin-react-hooks` for `packages/react`
  and `examples/react` + `examples/playground`
- `eslint-plugin-vue` for `packages/vue` and `examples/vue`
- Override: allow `no-console` in `examples/**`, forbid in `packages/**`
- `npm run lint` runs eslint on `packages/` and `examples/`
- `npm run lint:fix` for auto-fix

All existing lint violations are fixed as part of M1 task list, not
deferred — CI would reject subsequent PRs otherwise.

### 11. TypeDoc — `typedoc.json`

```json
{
  "entryPointStrategy": "packages",
  "entryPoints": ["packages/core", "packages/react", "packages/vue"],
  "out": "docs/api",
  "readme": "README.md",
  "name": "@rekurt/ohlcv",
  "includeVersion": true,
  "excludePrivate": true,
  "excludeInternal": true,
  "navigation": { "includeCategories": true }
}
```

Run with `npm run docs` — outputs static HTML into `docs/api/`.
`docs/api/` is gitignored; it is generated by the Pages workflow.

### 12. CHANGELOG.md (Keep-a-Changelog format, manual for 0.1.0)

```md
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-TBD

### Added
- First public release of @rekurt/ohlcv-core, @rekurt/ohlcv-react, @rekurt/ohlcv-vue.
- Core rendering (3-layer canvas, hi-DPI, dirty-flag RAF), TypedArray-backed
  CandleBuffer, keyboard shortcuts, Go-to-live pill, drag/wheel/touch pan+zoom
  with momentum and prefers-reduced-motion, auto-follow state machine.
- Eight indicators: SMA, EMA, Bollinger Bands, RSI, MACD, Stochastic, ATR, VWAP.
- Four chart types: candles, line, area, OHLC bars.
- Two data transforms: Heikin Ashi, Renko.
- Two drawing tools: trend line, horizontal line.
- BinanceWsTransport with exponential backoff reconnect.
- Runtime Candle validation, structured ChartError dispatch.
- IndicatorConfig discriminated union + createIndicator factory for wrapper reconciliation.
- LayoutState / FullState / loadState chart persistence with shareable URL support.
- React wrapper: declarative props including indicators, full imperative ref API,
  useOHLCVChart hook.
- Vue wrapper: reactive props including v-model:indicators, full emits, defineExpose,
  useOHLCVChart composable.
- Unified playground on GitHub Pages with framework switcher and share-URL.
- TypeDoc API reference on GitHub Pages.
- CI (lint + typecheck + test + build) on every PR.

[0.1.0]: https://github.com/rekurt/ohlcv-front/releases/tag/v0.1.0
```

### 13. CONTRIBUTING.md

Short file covering: prerequisites (Node 20+), install steps
(`npm install`), running tests (`npm test`), typecheck
(`npm run typecheck`), lint (`npm run lint`), local dev servers
(`npm run dev:core/react/vue/playground`), how to regenerate TypeDoc
(`npm run docs`), commit message convention (Conventional Commits).

### 14. Root README refresh

- Replace `@ohlcv/*` with `@rekurt/ohlcv-*` in the package table.
- Add real quickstart snippets for React and Vue (install + minimum
  working code), not just monorepo dev instructions.
- Add badges: npm version (shield.io), test status (GitHub Actions),
  license, bundle size (bundlephobia).
- Add links to hosted playground and TypeDoc API reference.
- Keep the existing feature list but update counts to match what's
  shipped in 0.1.0.

## Data flow

**Declarative props (React useEffect / Vue watch)**
```
user code state → props → wrapper diff → core imperative method → ChartEngine.render
```

**Imperative ref / expose**
```
user code → ref.method() → wrapper → core method → ChartEngine.render
```

**Events (core → user code)**
```
core callback → wrapper (React: call onFoo prop; Vue: emit 'foo')
              → user code handler
```

**State persistence**
```
save: ref.saveLayoutState() → core reads buffer/viewport/engine → JSON
load: ref.loadState(json) → validate → core restores in order → engine.render
```

## Error handling

Preserve the existing contract — `onError` callback in `ChartConfig` and
`ErrorReporter` fallback to `console.warn`. New error paths added in M1:

- `loadState` — throws `ValidationError` on `state.version !== 1` or
  missing required fields. Wrappers forward this as `onError` payload
  (React prop) / `error` emit (Vue).
- `createIndicator` — throws on unknown `config.type` (TypeScript
  catches this at compile time for literal configs, but runtime
  validation is still needed for JSON-loaded state).

## Testing strategy

**New unit tests in core**:
- `state/saveState.test.ts` — saveLayoutState / saveFullState round-trip
  contract on 6 chart states (empty, data-only, with indicators, with
  drawings, after pan, after theme switch).
- `state/loadState.test.ts` — loadState restores identical state for 8
  inputs; rejects wrong version; rejects missing required fields;
  accepts LayoutState without data, accepts FullState with data.
- `indicators/registry.test.ts` — createIndicator factory returns right
  class for each config type; indicatorId is stable for equal configs;
  diffIndicatorConfigs returns correct added/removed/kept for 10 pair
  cases.

**New integration tests in core**:
- `OHLCVChart.test.ts` — `saveFullState → loadState(otherChart)`
  produces identical viewport and indicator set on a second chart
  instance.

**New tests in React wrapper**:
- `OHLCVChart.reconcile.test.tsx` — indicators array change triggers
  setIndicators once; reference-equal array does not trigger.
- `OHLCVChart.props.test.tsx` — chartType/theme/data prop changes call
  the right core method.
- `OHLCVChart.ref.test.tsx` — imperative ref methods work; saveState /
  loadState round-trip through ref.
- `useOHLCVChart.test.tsx` — headless hook parity check.

**New tests in Vue wrapper**:
- `OHLCVChart.reactivity.test.ts` — reactive props trigger right core
  calls.
- `OHLCVChart.emits.test.ts` — events fire as expected.
- `OHLCVChart.expose.test.ts` — defineExpose methods work.
- `OHLCVChart.vmodel.test.ts` — `v-model:indicators` two-way binding
  syntax wires up without errors (even though chart never emits
  update:indicators in M1).

**Playground**:
- No automated tests in M1 (manual smoke test in real Chrome before
  release). Playwright coverage is a future milestone.

Test count estimate: 406 current → ~470 post-M1 (~60 new tests).

## Success criteria

1. `npm install @rekurt/ohlcv-core` / `-react` / `-vue` works from a
   fresh directory and produces a working chart with ~20 lines of user
   code for each wrapper.
2. Every public method on `OHLCVChart` is exposed through both React ref
   and Vue defineExpose with matching signatures.
3. `saveLayoutState() → JSON → base64 → URL → loadState()` round-trips
   produce a visually identical chart (manual visual diff in real
   Chrome).
4. `npm run lint && npm run typecheck && npm test && npm run build`
   all green.
5. CI workflow runs on every PR and blocks merges on failures.
6. `https://rekurt.github.io/ohlcv-front/` serves the playground.
7. `https://rekurt.github.io/ohlcv-front/api/` serves TypeDoc output.
8. `npm view @rekurt/ohlcv-core` returns `version: 0.1.0` with correct
   metadata (repository, license, keywords).
9. README quickstart snippets for both wrappers work verbatim when
   pasted into a fresh project.
10. The preserveView regression test from commit 46f8eea still passes
    alongside the new M1 tests.

## Risks and open questions

**Vite workspace dist drift** — the preserveView bug (46f8eea) proved
that examples serve stale `dist/` because workspace linking resolves to
the package's `main`/`module` entry. The playground will hit the same
trap unless we add `resolve.alias` in the playground Vite config to
point `@rekurt/ohlcv-*` at `packages/*/src/index.ts` during development.
Decision: **do add the alias** — this gives HMR on src changes without
rebuilding dist. Production builds still consume `dist/`.

**npm publish of `@rekurt` scope** — `@rekurt` is a user scope tied to
the GitHub username, not an org. Publishing requires
`npm publish --access public`. The M1 release steps document this
explicitly so the first publish doesn't fail with a permission error.

**Bundle size budget** — the playground runs both React and Vue in one
page, which roughly doubles the framework footprint. If the gzipped
bundle exceeds 500 KB we should defer the unified playground to M2 and
ship 0.1.0 with three separate playground subroutes instead. Budget is
monitored via `vite build --reporter verbose` in the release checklist.

**Existing dist lint errors** — the pre-M1 codebase has never been
lint'ed. Running ESLint fresh is likely to surface dozens of style
violations (unused imports, `any` types, missing `await`s). Fixing
these is part of M1 task list, but the estimate depends on how many
there are. If the count exceeds ~200 we re-evaluate adding lint to CI
and consider deferring the lint rule set (not the tooling) to M2.

**Playground Vue-in-React hosting** — mounting Vue 3 inside a
React-owned DOM tree requires portal pattern (React renders an empty
`<div>`, a `useEffect` calls `createApp(VueComponent).mount(el)`). This
is a 20-line helper, but if it leaks memory or fails in Strict Mode
double-mount it becomes a rabbit hole. Fallback: render Vue tab as a
separate `<iframe>` pointing at a tiny Vue-only page. Decision in
plan phase.

**`examples/playground/` vs renaming an existing example** — an
alternative is turning `examples/react/` into the playground and
deleting `examples/core/` + `examples/vue/`. Rejected: the three
minimal examples are valuable as bug-report reproduction scaffolds,
and conflating them with the playground makes both roles worse.

## Dependencies and sequencing inside M1

Rough task dependency graph (for the subsequent plan phase):

```
rename @ohlcv/* → @rekurt/ohlcv-*  (blocks everything)
 ├→ core state/ + registry         (blocks wrapper reconcile)
 │   ├→ react wrapper full API
 │   │   └→ react wrapper tests
 │   └→ vue wrapper full API
 │       └→ vue wrapper tests
 ├→ ESLint setup + lint fixes      (blocks CI)
 ├→ README refresh
 └→ CHANGELOG + CONTRIBUTING
      └→ CI workflow
          └→ Pages workflow
              └→ playground
                  └→ TypeDoc
                      └→ manual 0.1.0 publish
```

Top-of-the-graph work (rename, core additions) must land first so the
wrappers can depend on the new types. Tests come alongside each piece.
Infra (CI, Pages) lands after code stabilizes so CI is green on first
run. Publish is last.

## Out of scope reminders

These belong to M2 or later and are **not** M1 work even though they
may seem "small":

- Any new indicator, chart type, drawing tool, or data transform.
- Multi-pane (Pane class is written but not wired).
- Log scale or percent scale toggle.
- Changesets or automated release workflow.
- Removing the three existing minimal examples.
- Alerts, replay, compare mode, workspaces.
- Adding lint rules beyond the strict preset.
- A plugin system for user-defined indicators.
- Performance benchmarks (postponed until M6 performance pass).
