# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
