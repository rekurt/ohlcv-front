# CLAUDE.md — OpenKline (core monorepo)

Guidance for AI agents (Claude Code and friends) working in this repository.

## What this repo is

**OpenKline** is a fast, framework-agnostic OHLCV charting engine. This repo
(`rekurt/openkline`) is the monorepo that ships the engine,
[`@rekurt/openkline-core`](./packages/core), plus the example apps. The React
and Vue wrappers live in their own repositories:

- [`rekurt/openkline-react`](https://github.com/rekurt/openkline-react) → `@rekurt/openkline-react`
- [`rekurt/openkline-vue`](https://github.com/rekurt/openkline-vue) → `@rekurt/openkline-vue`

> **Naming:** "OpenKline" is the product/brand. "OHLCV" is the financial data
> type (Open-High-Low-Close-Volume) and stays in domain symbols such as the
> `OHLCVChart` class, `useOHLCVChart`, `OHLCVChartRef`, and the `ohlcv()` test
> helper. Do **not** rename those — they describe the data, not the brand.

## Layout

```
packages/core/          @rekurt/openkline-core — the engine (zero runtime deps)
  src/
    OHLCVChart.ts        public facade / entry class
    rendering/           ChartEngine, layers, axes, legend, webgl/
    data/                CandleBuffer, CandleMerger, DataFeed, transports
    interaction/         Viewport, keyboard, pan/zoom, autoFollow
    indicators/          indicators + registry + createIndicator factory
    drawings/            buffer-anchored drawing tools + DrawingLayer
    transforms/          Heikin-Ashi, Renko
    series/ primitives/ markers/ profile/ compare/ alerts/ export/ i18n/
    state/               saveLayoutState / loadState serialization
    types.ts             shared types (Candle, IndicatorConfig, …)
examples/
  _shared/               @openkline-examples/shared — mock feed, symbols
  core/                  vanilla demo (port 5173)
  playground/            unified demo (port 5176)
docs/                    GUIDES, COMPARISON, PLUGINS, superpowers/ (design history)
```

## Commands

```bash
npm install             # install workspace deps
npm run dev:playground  # unified demo  → http://localhost:5176
npm run dev:core        # vanilla demo  → http://localhost:5173

npm run lint            # ESLint, --max-warnings 0  (must stay at 0)
npm run typecheck       # strict tsc across all tsconfigs
npm test                # vitest (run mode) — 440+ tests
npm run build           # tsup bundle for @rekurt/openkline-core
npm run docs            # TypeDoc → docs/api/
```

Before pushing, the green bar is: **lint + typecheck + test + build** all pass.

## Conventions

- **Business logic lives in the core.** The React/Vue wrappers are thin glue;
  never duplicate engine logic in a wrapper.
- **Indicators are config objects**, not classes, in user-facing APIs. Add new
  ones through the `IndicatorConfig` union + `createIndicator` factory +
  `registry.ts`, not by exposing constructors.
- **Strict TypeScript**, including `noUncheckedIndexedAccess`. No `any` escape
  hatches in new code.
- **No silent catches.** Route errors through `ErrorReporter` / the `onError`
  callback.
- **Drawings & indicators anchor in buffer space** so they stick to candles on
  pan/zoom.
- Match the surrounding file's style; keep comment density and naming idiomatic.

## Wrappers depend on a vendored core tarball

Until packages are published to npm, `openkline-react` and `openkline-vue`
vendor a packed build of this core at `vendor/rekurt-openkline-core.tgz`. If you
change the core's public API or build output, those repos must refresh the
tarball via their `npm run update:core` (which clones this repo, builds
`packages/core`, and re-packs). Keep `@rekurt/openkline-core`'s exports and
`package.json` name stable, or update both wrappers in lockstep.

## Don't

- Don't rename the `OHLCVChart` / `useOHLCVChart` API symbols (domain terms).
- Don't rewrite `docs/superpowers/*` or historical `CHANGELOG` entries — they
  are a design/decision record.
- Don't add runtime dependencies to `@rekurt/openkline-core`.
