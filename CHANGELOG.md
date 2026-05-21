# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Multi-pane rendering wired into `ChartEngine`.** Indicators with
  `placement: 'pane'` (RSI, MACD, Stochastic, ATR) now render in their own
  stacked sub-panes below the price pane, each with an independent Y-axis.
  The main price pane shrinks to make room; the time axis is shared at the
  bottom across all panes; the crosshair vertical line spans every pane.
  Previously these indicators were computed but silently never drawn.
  - New `Indicator.paneRange` getter (fixed Y-range, e.g. RSI/Stochastic
    `[0, 100]`) and `Indicator.referenceLines` getter (e.g. RSI 30/70,
    Stochastic 20/80). Default to auto-scale / none.
  - MACD `histogram` series renders as zero-anchored bars; other series
    render as lines.
  - `ChartEngine.paneLayout` getter exposes the pane stack.
- **Indicator compute memoization.** `Indicator.compute()` is now a
  memoizing wrapper around the subclass `_compute()`, keyed on the buffer's
  new `version` counter. Indicators recompute only when the data actually
  changes instead of on every render frame (pan, zoom, crosshair move).
- **`CandleBuffer.version`** — monotonic revision counter bumped on every
  mutation (`append`, `appendBatch`, `updateLast`, `prepend`, `clear`).
- **SSR guidance.** `OHLCVChart` throws a clear, actionable error when
  constructed without a `document` (SSR). README documents Next.js
  (`dynamic({ ssr: false })`) and Nuxt (`<client-only>`) usage.

### Changed

- **`@rekurt/ohlcv-core` is now a `peerDependency`** (not a regular
  dependency) of `@rekurt/ohlcv-react` and `@rekurt/ohlcv-vue`, preventing
  duplicate core copies / version mismatches in consumer bundles.

### Fixed

- **Indicator compute errors are reported, not swallowed.** `ChartEngine`
  now dispatches indicator-compute failures through `ErrorReporter` with
  `where: 'indicator'` instead of an empty `catch {}`, matching the
  project's "no silent catches" policy.

### Removed

- **`BinanceWsTransport`** and its types (`BinanceWsTransportOptions`,
  `IWebSocketLike`) were removed. It was an unverified skeleton (lost ticks
  on reconnect, no heartbeat, no history pagination) and shipping it as a
  public export implied production-readiness it did not have. Build resilient
  transports on the abstract `WebSocketTransport` base instead.

## [0.1.0] - 2026-04-11

First public release under the `@rekurt` npm scope. This release
consolidates all prior iteration work into a shippable package set.

### Added (M1 — wrapper API parity + distribution)

- **Monorepo scope renamed** from pre-release `@ohlcv/*` to
  `@rekurt/ohlcv-*`. All package names, imports, dependencies,
  and documentation updated. There is no upgrade path from 0.0.x
  — treat this as a fresh install.
- **React wrapper (`@rekurt/ohlcv-react`) reaches full API parity.**
  `<OHLCVChart>` exposes `chartType`, `indicators` (declarative
  config array), `idleCursor`, `onHover`, `onError`, and
  `onLoadMoreHistory` props. `forwardRef` / `useImperativeHandle`
  surface includes `goToLive`, `fitVisible`, `fitAll`,
  `prependHistory`, `updateLastCandle`, `saveLayoutState`,
  `saveFullState`, `loadState`, `startDrawing`, `getDrawings`,
  `loadDrawings`, `clearDrawings`, `toPNG`. `useOHLCVChart` hook
  extended to 1:1 parity with the component. Indicator
  reconciliation through `diffIndicatorConfigs` — reference-stable
  arrays no longer thrash the chart.
- **Vue wrapper (`@rekurt/ohlcv-vue`) reaches full API parity.**
  Reactive props match React, typed `emits` for all events, and
  `defineExpose` mirrors the React ref surface 1:1. `v-model:indicators`
  supported via the `update:indicators` emit for forward compatibility.
  `useOHLCVChart` composable extended to match component.
- **Chart state persistence**
  (`saveLayoutState` / `saveFullState` / `loadState`) with versioned
  JSON schema. `LayoutState` is URL-friendly (for share links),
  `FullState` includes the data window (for workspace persistence).
- **IndicatorConfig discriminated union + `createIndicator` factory
  + `indicatorId` stable hash + `diffIndicatorConfigs` pure function**
  so wrapper-driven code never constructs indicator classes by hand
  and reconciliation is zero-duplication between React and Vue.
- **`OHLCVChart.setIndicatorConfigs(configs)`** — declarative path
  used by wrappers; stores configs so `saveLayoutState` can round-trip
  them. The legacy `setIndicators(Indicator[])` still works for custom
  indicators but clears the internal config mirror.
- **Auto-managed drawing layer** — `OHLCVChart` constructs and owns
  a default `DrawingLayer`. New facade methods: `getDrawingLayer`,
  `startDrawing('trendline'|'hline')`, `getDrawings`, `loadDrawings`,
  `clearDrawings`.
- **Unified playground** (`examples/playground/`) with framework
  switcher (Vanilla TS / React / Vue), shared toolbar (theme,
  chartType, indicators), and **share URL** feature via
  base64-encoded `LayoutState` in `?state=` query param. Vite config
  aliases `@rekurt/ohlcv-*` at workspace `src/` directly to prevent
  the stale-dist pitfall that caused the preserveView regression.
- **ESLint flat config** (TypeScript + React + Vue rules) at root,
  `npm run lint` + `npm run lint:fix`, `--max-warnings 0` enforced.
- **GitHub Actions**: `ci.yml` runs lint + typecheck + tests + build
  on PRs and pushes to master (Node 20 + 22 matrix). `pages.yml`
  builds the playground + TypeDoc API reference and deploys them to
  GitHub Pages.
- **TypeDoc API reference** generated from core + react + vue
  entry points, hosted alongside the playground under `/api/`.
- **Three existing minimal examples** (`examples/core|react|vue/`)
  kept as self-contained repro scaffolds for issue reports.

### Fixed

- **`setData` `preserveView` option** — commit 46f8eea. Previously the
  framework wrappers re-dispatched `setData` on every `[data]` effect
  without `preserveView`, causing the core `else` branch to call
  `scrollToEnd()` and snap the viewport back to the live edge on
  every unrelated re-render (hover, indicator toggle, theme swap).
  Wrappers now always pass `preserveView: true` and core keeps
  `startIndex` / `candleWidth` / `autoFollow` across the reload.

### Added (iteration 2 — drawing tools, more indicators, data transforms, export)

- **Drawing tools MVP** (`@ohlcv/core/drawings`). Buffer-space anchored drawings that stick to the underlying candles on pan/zoom.
  - `Drawing` abstract base with `AnchorPoint = { index, price }`, point accumulation up to `requiredPoints`, and `toSnapshot` / `fromSnapshot` JSON round-trip for persistence.
  - `TrendLine` — two-point straight segment with chart-area clipping.
  - `HorizontalLine` — single-point full-width dashed line with a price pill on the right axis.
  - `DrawingLayer` — ordered collection with a single "active creation" slot (`startDrawing` / `addPoint` / `updateActiveLastPoint` / `cancelActive` / `remove` / `clear`), registry-based hydration from snapshots, and `render()` that draws completed drawings plus the in-progress one.
  - Selection, editing, undo, and richer primitives (rays, rectangles, Fibonacci) are intentionally deferred to a later iteration.
  - 26 unit tests.
- **Additional indicators** implementing the existing `Indicator` base class:
  - `MACD(fast=12, slow=26, signal=9)` — three aligned series (`macd`, `signal`, `histogram`). Placement: `'pane'`.
  - `Stochastic(kPeriod=14, dPeriod=3)` — `%K` and `%D` in [0, 100]. Placement: `'pane'`.
  - `ATR(period=14)` — Wilder-smoothed true-range volatility. Placement: `'pane'`.
  - `VWAP(anchor='session' | 'cumulative')` — volume-weighted average price with optional UTC-day session reset. Placement: `'overlay'`.
  - 29 new tests (MACD fast<slow invariant, Stochastic clamping + zero-range flat-window, ATR positivity on volatile data, VWAP session reset on UTC boundary, zero-volume guard, etc.).
- **Data transforms** (`@ohlcv/core/transforms`). Pure-function transforms that consume `Candle[]` and return `Candle[]` so consumers can feed the result into `OHLCVChart.setData()` unchanged.
  - `toHeikinAshi(candles)` — smoothed candles via standard `(o+h+l+c)/4` and `(prev.o+prev.c)/2` recurrence. Includes `advanceHeikinAshi(prevHA, rawCandle)` helper for incremental live-tick updates.
  - `toRenko(candles, brickSize)` — price-driven bricks with 2×brickSize reversal threshold. Timestamps carry over from the triggering source candle; volume is 0.
  - 19 new tests (uptrend smoothness, first-candle seeding, single-brick and multi-brick moves, reversal absorption, volume/timestamp invariants).
- **`ChartEngine.toPNG()`** — synchronous snapshot that composites the three canvas layers (chart / UI / crosshair) over the background color onto an offscreen canvas and returns a `data:image/png;base64,...` data URL. Suitable for download links, uploading to a backend, or `<img src>`. 2 new smoke tests.
- Test suite: **328 → 404** (+76 new tests, all green). Typecheck clean under strict mode.

### Added (iteration 1 — foundations through OSS-ready)

- **Pane abstraction** (`@ohlcv/core`). New `Pane` and `PaneLayout` classes provide a foundation for multi-pane charts. Each pane has its own `priceMin`/`priceMax`, independent linear or log Y-axis, and can be positioned in the vertical stack. Main price pane is always present; sub-panes for indicators (RSI, MACD) can be added via `PaneLayout.addPane()`. (Integration into `ChartEngine` is planned for the next release.)
- **Indicator infrastructure** (`@ohlcv/core/indicators`). Base `Indicator` class with `compute(buffer)` → `IndicatorSeries[]` contract, `placement: 'overlay' | 'pane'` flag, and stable `id` for caching. First batch of implementations:
  - `SMA(period)` — simple moving average
  - `EMA(period)` — exponential moving average with Wilder seeding
  - `BollingerBands(period, stdDev)` — three-series (upper/middle/lower)
  - `RSI(period)` — 14-period Wilder-smoothed Relative Strength Index
- **Alternative chart-type renderers**. `LineRenderer` (close-price line), `AreaRenderer` (line with gradient fill), `OHLCBarRenderer` (bar chart) as opt-in alternatives to `CandleRenderer`. All respect the existing layout + viewport contract and can be swapped in by consumers without touching `ChartEngine`.
- **Binance WebSocket transport**. `BinanceWsTransport` extends `WebSocketTransport` with concrete support for Binance public kline streams + REST history fetching. Includes URL construction, resolution mapping (`1H` → `1h`), message parsing, and automatic reconnection via `ExponentialBackoff`.
- **`ExponentialBackoff` utility**. Full-jitter exponential backoff policy with configurable `baseDelay` / `maxDelay` / injectable RNG. Used by `BinanceWsTransport` for reconnect and exposed publicly so consumers can build their own resilient transports.
- **`Pane` + `PaneLayout` public API**, new exports: `Pane`, `PaneLayout`, `PaneKind`, `YScale`.
- **Accessibility**:
  - Top canvas now has `role="img"` and an `aria-label` describing chart navigation keys so screen readers announce chart presence on focus.
  - Momentum scrolling after a pan gesture now respects `prefers-reduced-motion: reduce` and skips the decay animation.
  - New `theme: 'auto'` option resolves to light or dark based on `prefers-color-scheme`.
- **`ErrorReporter`** and `ChartConfig.onError` callback for structured error dispatch. Every transport/fetch error now reaches the consumer with `{ where, error, fatal }` instead of being silently swallowed.
- **Runtime validation**: `ValidationError`, `validateCandle`, `validateCandles` utilities. Checks shape, finite numbers, positive time, `h >= l`, `h >= max(o,c)`, `l <= min(o,c)`, `v >= 0`.
- **Test coverage**: ~250 new unit tests added across validation, data layer, rendering, interaction, indicators, chart types, backoff, Binance transport, and accessibility paths. Total test count: **80 → 328+**.
- **Strict TypeScript**: `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch` enabled across the monorepo.

### Fixed

- `ChartEngine.resize()` applied `ctx.scale(dpr, dpr)` twice (once inside `resizeHiDPICanvas`, once explicitly after). Since `getContext('2d')` returns the same context object, scale compounded to `dpr²`, making candles render at 4× on DPR=2 displays. Resize now relies on `resizeHiDPICanvas` alone.
- `Viewport.isAtEnd()` previously returned `true` for any `startIndex` past "edge minus padding", causing live updates to snap the viewport back to the anchor every tick when the user had panned into the empty future zone. Now requires an exact match (`abs(startIndex - anchor) < 0.5`).
- `PanZoomController._handleWheel` ignored `deltaX` entirely; trackpad horizontal swipes fell through to the zoom branch (`deltaY=0 → factor=1.1` always). Rewritten with axis priority and a bias (`|dx|*2 >= |dy|`) so real-world trackpad jitter is still classified as pan.
- `Vue` example's live loop did `data.value = [...data.value]` every tick, triggering the wrapper's `watch(data)` → `setData()` → `scrollToEnd()`. Rewritten to use the imperative `chartComponentRef.value.chart.updateLastCandle()` API, matching the React example.
- Three `catch {}` blocks in `DataFeed` and `PollingTransport` silently swallowed errors. All now dispatch through `ErrorReporter.report(where, error, fatal)`; defaults to `console.warn` if no handler is configured.
- `PollingTransport.defaultParser` did unchecked `data as { o: number[], ... }` casts. Now validates array shape and per-element number types, skipping malformed rows.

### Changed

- `ThemeMode` type now includes `'auto'` in addition to `'dark'` and `'light'`.
- Font strings, label heights, axis offsets, and other magic numbers extracted from renderer files into `constants.ts` as a single source of truth.

## Initial monorepo (2026-04)

- `@ohlcv/core`, `@ohlcv/react`, `@ohlcv/vue` scaffolding with candlestick rendering, volume sub-panel, crosshair, pan/zoom, keyboard shortcuts, and examples/{core,react,vue} workspace apps.
