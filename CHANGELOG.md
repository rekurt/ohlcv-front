# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Markers API.** Candle-anchored point annotations (buy/sell arrows,
  event flags) via `chart.setMarkers` / `addMarker` / `removeMarker` /
  `clearMarkers` / `getMarkers`. Markers pin by `time` (robust to history
  loads and `maxCandles` eviction — no index bookkeeping), support
  `above`/`below`/`inline` placement and `arrowUp`/`arrowDown`/`circle`/
  `square`/`flag` glyphs with optional text. New `Marker` type,
  `MarkerRenderer`, and `markerY` helper exported from core; React and Vue
  ref surfaces expose the same methods. Drawn on the chart layer (panned
  with data, included in `toPNG`).
- **`maxCandles` memory cap.** New `ChartConfig.maxCandles` evicts the
  oldest candles (O(1) via `CandleBuffer.evictHead`, with in-place
  compaction so capacity stays bounded) once live updates push past the
  cap. The viewport and drawings shift in lockstep
  (`DrawingLayer.shiftIndices`) so they stay anchored to the same candles.
  Prepended history is never auto-evicted.
- **Drawing selection, deletion, and undo/redo.** Every drawing now
  implements `hitTest(x, y, layout, viewport, tolerance)` with geometry
  matching its rendered shape (segments, full-width/height lines, rays,
  rectangles, channels, fib levels). `DrawingLayer` gains `hitTest`,
  `selectAt`, `select`, `removeSelected`, `undo`/`redo` (`canUndo`/
  `canRedo`), and renders square handles on the selected drawing.
  `OHLCVChart` exposes `selectDrawingAt`, `selectDrawing`,
  `getSelectedDrawingId`, `deleteSelectedDrawing`, `undoDrawing`,
  `redoDrawing` — input wiring stays in the consumer, consistent with the
  render-only drawing-layer design.
- **Gap detection utilities.** `findGaps(buffer, intervalSeconds)` reports
  runs of missing candles (weekends, exchange close, dropped ticks) as
  `CandleGap[]`; `resolutionToSeconds(resolution)` maps a resolution string
  to its interval (null for calendar months). Detection only — consumers
  decide whether to backfill or draw session breaks.
- **Indicator compute memoization.** `Indicator.computeCached(buffer)`
  wraps `compute()` and caches the result keyed on the new
  `CandleBuffer.version` revision counter. The render loop now uses
  `computeCached`, so indicators recompute only when the data actually
  changes instead of on every render frame (pan, zoom, crosshair move).
- **`CandleBuffer.version`** — monotonic revision counter bumped on every
  mutation (`append`, `appendBatch`, `updateLast`, `prepend`, `clear`).

### Changed

- **`@rekurt/ohlcv-core` is now a `peerDependency`** (not a regular
  dependency) of `@rekurt/ohlcv-react` and `@rekurt/ohlcv-vue`, preventing
  duplicate core copies / version mismatches in consumer bundles.

### Changed

- **Crosshair moves within a single candle no longer redraw the UI layer.**
  `ChartEngine.setCrosshair` marks the UI layer (legend, price line, pill)
  dirty only when the snapped candle actually changes; sub-candle mouse
  moves repaint just the crosshair layer. Cuts per-move work on hover.

### Fixed

- **Indicator compute errors are reported, not swallowed.** `ChartEngine`
  now dispatches indicator-compute failures through `ErrorReporter` with
  `where: 'indicator'` instead of an empty `catch {}`, matching the
  project's "no silent catches" policy. New `ChartEngine.setErrorReporter`.

### Removed

- **`BinanceWsTransport`** and its types (`BinanceWsTransportOptions`,
  `IWebSocketLike`). It was an unverified skeleton (lost ticks on
  reconnect, no heartbeat, no history pagination); shipping it as a public
  export implied production-readiness it did not have. Build exchange
  adapters on the abstract `WebSocketTransport` base instead.

### Added (review-3 cycle — M2 hardening)

- **Indicator library expanded from 8 → 23.** Beyond the original
  SMA/EMA/BB/VWAP/RSI/MACD/Stochastic/ATR, the following are now
  built in and wired through `IndicatorConfig` + `createIndicator`
  + `indicatorId`:
  - Overlay: `WMA`, `HMA`, `Keltner`, `Donchian`, `PivotPoints`,
    `Ichimoku`, `Supertrend`, `ParabolicSAR`, plus anchored `VWAP`.
  - Sub-pane: `WilliamsR`, `OBV`, `ADX` (+DI/-DI), `CCI`, `MFI`,
    `StochRSI`, `ROC`.
  All use O(n) or amortized-O(1) algorithms (rolling sums,
  monotonic-deque window extrema, Wilder smoothing).
- **Drawing tools expanded to 9**: added `Rectangle`, `Ray`,
  `VerticalLine`, `FibRetracement`, `FibExtension`, `Channel`,
  `Arrow` alongside the original `TrendLine` / `HorizontalLine`.
  All buffer-space anchored and snapshot-serializable; the shared
  `DrawingTool` type drives `OHLCVChart.startDrawing` and both
  wrappers.
- **Heikin-Ashi is a first-class chart type** (`chartType:
  'heikinashi'`) — rendered directly from the raw buffer with a
  50-bar warmup lead-in, no manual data transform needed.
- **Y-axis drag-to-scale**: dragging the price-axis strip rescales
  the visible price range around the cursor; double-click there
  resets to auto-scale (`Viewport.scalePriceRangeBy` /
  `resetPriceScale`).
- **Two-finger touch gestures** now pan and pinch-zoom
  simultaneously (sliding both fingers pans; spreading/pinching
  zooms).

- **Multi-pane rendering** is now real: every indicator with
  `placement: 'pane'` (RSI, MACD, Stochastic, ATR, plus the new
  WilliamsR / OBV / ADX / CCI) renders in its own auto-sized
  vertical band with independent Y-axis, label, min/max bounds, and
  a dashed zero-line for ranges that straddle zero.
  `computeLayout(width, height, paneCount)` reserves
  `INDICATOR_PANE_HEIGHT` (80 px) per pane and clamps so the main
  candle area is never thinner than `MIN_MAIN_AREA_HEIGHT` (120 px).
- **4 new indicators**: `WilliamsR`, `OBV`, `ADX` (with `+DI`/`-DI`),
  `CCI`. Registered in the `IndicatorConfig` discriminated union
  (`'williamsr'`, `'obv'`, `'adx'`, `'cci'`) and wired through
  `createIndicator`, `indicatorId`, and the React/Vue wrappers'
  reconciliation path.
- **4 new drawing tools**: `Rectangle`, `Ray`, `VerticalLine`,
  `FibRetracement` (8 canonical levels with inline labels). All
  buffer-space anchored and snapshot-serializable. `OHLCVChart.startDrawing`
  widened to accept the new tools; the shared `DrawingTool` type
  is exported from core so React/Vue wrappers stay in sync.
- **Bollinger Bands O(n)**: rewrote the inner double-loop to use
  two rolling sums (`Σx`, `Σx²`) and the
  `σ² = E[x²] − (E[x])²` identity. ~20× faster at
  `n=100k, period=20` while preserving correctness on all 9
  existing tests.
- **Subpath exports**: `@rekurt/ohlcv-core/indicators` and
  `@rekurt/ohlcv-core/drawings` are now importable directly,
  enabling consumers to tree-shake unused subsystems.
- **State migrations scaffold**: `migrateState` + `migrations`
  registry + `CURRENT_STATE_VERSION` so future schema bumps are
  forward-compatible with shipped clients without changes in
  wrappers.
- **Governance**: `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md`,
  `.github/dependabot.yml`. Expanded `.gitignore` to cover env
  files, IDE configs, monorepo caches, and editor swap files.

### Changed

- **`CandleBuffer.prepend` is O(1) per candle** after the first
  growth instead of O(n) every time. The buffer now maintains a
  logical `_head` offset into the raw arrays; prepends shift
  `_head` left in-place when leftPad headroom is available, and
  reserve `max(incoming, currentLength)` of leftPad on growth so
  subsequent equal-sized history pages also hit the fast path.
  Eliminates the 6× Float64Array allocation per prepend that
  previously dominated TradingView-style infinite scroll.
- **Y-axis drag-to-scale** on the price-axis strip rescales the
  visible price range around the cursor (TradingView/Lightweight
  Charts parity). Double-click in the price axis resets to
  auto-scale; double-click in the main chart still fits visible.
  New `Viewport.scalePriceRangeBy(factor, anchorY)` and
  `resetPriceScale()` expose this programmatically.
- `useOHLCVChart` (React + Vue) now reacts to every option after
  mount — previously the headless hook ignored post-mount changes
  to `symbol`, `resolution`, `theme`, `chartType`, `indicators`,
  `idleCursor`, and `transport`. Vue version accepts
  `MaybeRefOrGetter<T>` for reactive options. Callbacks
  (`onHover`, `onCandleClick`, `onError`, `onVisibleRangeChange`,
  `onLoadMoreHistory`) flow through trampoline refs so identity
  changes don't recreate the chart.
- Rendering: pixel-snap text baselines and label backgrounds in
  PriceAxis, TimeAxis, Crosshair, Legend, GoToLive — text now
  rasterizes sharply at DPR=1 and label rects don't fringe.
- `CandleBuffer.append` / `appendBatch` / `updateLast` / `prepend`
  now reject non-finite OHLCVT fields at the public API boundary
  with a clear `RangeError`. Prevents silent NaN propagation into
  `priceToY` and indicator computation.

### Fixed

- README: removed an over-promise about pane log-scale being live
  in 0.1.0; it now correctly describes when the main candle and
  sub-pane integration each became real.
- README: added an honest "unverified skeleton" note next to
  `BinanceWsTransport` so consumers do not copy-paste it into
  production code.
- `vitest.config.ts` was silently skipping `*.test.tsx` files; the
  React wrapper tests were never running in CI. Re-included.

### Fixed (PR #1 review + CI)

- CI reordered to build before typecheck — the wrapper tsconfigs
  resolve `@rekurt/ohlcv-core` to its built `dist/`, so typecheck
  must follow the build in a fresh `npm ci` environment. (Both
  Node 20 and 22 jobs were red on `master` since commit 2f322f4.)
- React `useOHLCVChart` no longer fires a duplicate `switchSymbol`
  on mount (avoids a redundant transport fetch + buffer reset).
- Vue `useOHLCVChart` callback watchers are registered once at
  composable scope instead of leaking a new set per transport
  recreation.
- `CandleBuffer.appendBatch` / `prepend` validate the full incoming
  range before mutating, so a thrown validation leaves the buffer
  untouched (atomic ingestion).
- Time axis + crosshair time label anchor to `paneAreaBottom` so
  they render in the reserved axis strip, not the first sub-pane,
  when pane indicators are active.
- `DataFeed.disconnect()` bumps the connect version so in-flight
  history fetches can't leak into a freshly-cleared buffer;
  subscribe-time + per-tick errors are now reported via
  `ErrorReporter` instead of silently rejecting.

### Tests

- 461 → 610 (+149) across this cycle, covering: callback identity
  preservation, BB O(n) correctness, all 15 new indicators, all 7
  new drawings + snapshot round-trip, IndicatorPaneRenderer,
  sub-pane layout reservation, state migrations, CandleBuffer
  numeric guards + atomicity + O(1) prepend fast-path,
  Viewport.scalePriceRangeBy + resetPriceScale, two-finger touch
  gestures, Heikin-Ashi rendering, DataFeed race/error handling,
  and the React + Vue headless hook reactivity contracts.

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
