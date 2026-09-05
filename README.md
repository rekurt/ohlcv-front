<div align="center">

# OpenKline

### A fast, framework-agnostic OHLCV charting engine for the web

Canvas-rendered candlesticks, TypedArray data buffers, an explicit auto-follow
state machine, keyboard-first UX, and pluggable indicators, drawings &
transports — with first-class **React** and **Vue** wrappers at full API parity.

[![CI](https://github.com/rekurt/openkline/actions/workflows/ci.yml/badge.svg)](https://github.com/rekurt/openkline/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](./tsconfig.base.json)
[![Tests](https://img.shields.io/badge/tests-440%2B-22c55e.svg)](#quality-bar)
[![Bundle](https://img.shields.io/badge/core-zero%20deps-8b5cf6.svg)](#why-openkline)

[**Live Playground**](https://rekurt.github.io/openkline/) ·
[**API Reference**](https://rekurt.github.io/openkline/api/) ·
[**Guides**](./docs/GUIDES.md) ·
[**Comparison**](./docs/COMPARISON.md) ·
[**Changelog**](./CHANGELOG.md) ·
[**All projects by rekurt**](https://rekurt.github.io/projects/)

</div>

---

## Table of contents

- [Why OpenKline](#why-openkline)
- [Packages](#packages)
- [Install](#install)
- [Quick start](#quick-start)
  - [Vanilla TypeScript](#vanilla-typescript)
  - [React](#react)
  - [Vue 3](#vue-3)
- [What's in the box](#whats-in-the-box)
- [Architecture](#architecture)
- [Develop this monorepo](#develop-this-monorepo)
- [Quality bar](#quality-bar)
- [Roadmap](#roadmap)
- [License](#license)

---

## Why OpenKline

| | |
| --- | --- |
| ⚡ **Built for throughput** | TypedArray (`Float64Array`) candle buffers, O(1) append/update, RAF-coalesced tick merging, and a three-layer canvas split so a moving crosshair never repaints the chart. |
| 🧩 **Framework-agnostic core** | All rendering, data and interaction logic lives in `@rekurt/openkline-core` with **zero runtime dependencies**. React and Vue are thin, idiomatic wrappers — not reimplementations. |
| 🎯 **Full API parity** | The same declarative props and imperative methods across vanilla, React and Vue. Indicators are plain config objects; chart state round-trips through `saveLayoutState` / `loadState`. |
| ⌨️ **Keyboard-first & accessible** | Pan, zoom and navigate without a mouse. Honors `prefers-reduced-motion` and `prefers-color-scheme`. |
| 📈 **Batteries included** | 25+ indicators, 10 drawing tools, alerts, compare mode, volume profile, Heikin-Ashi & Renko transforms, SVG/PNG export, and an `'auto'` dark/light theme. |
| 🔒 **Strict & tested** | Strict TypeScript (incl. `noUncheckedIndexedAccess`), 0 lint warnings in CI, and 440+ unit tests covering rendering math, indicators and state. |

---

## Packages

| Package | Repository | What it is |
| --- | --- | --- |
| [`@rekurt/openkline-core`](./packages/core) | **this repo** | Framework-agnostic rendering + data + interaction (no React/Vue). |
| `@rekurt/openkline-react` | [rekurt/openkline-react](https://github.com/rekurt/openkline-react) | React 18+/19 wrapper — `<OHLCVChart>` component + `useOHLCVChart` hook. |
| `@rekurt/openkline-vue` | [rekurt/openkline-vue](https://github.com/rekurt/openkline-vue) | Vue 3 wrapper — `<OHLCVChart>` component + `useOHLCVChart` composable. |

> The React and Vue wrappers were extracted from this monorepo into their own
> repositories — each ships its own demo app, tests and CI.

---

## Install

```bash
# Vanilla TypeScript / bring-your-own framework
npm install @rekurt/openkline-core

# React
npm install @rekurt/openkline-core @rekurt/openkline-react

# Vue 3
npm install @rekurt/openkline-core @rekurt/openkline-vue
```

> **Pre-release note:** until the packages are published to npm, the wrapper
> repos vendor a built core tarball so `npm install` works out of the box. See
> each wrapper's README for `npm run update:core`.

---

## Quick start

### Vanilla TypeScript

```ts
import { OHLCVChart } from '@rekurt/openkline-core';

const chart = new OHLCVChart({
  container: document.getElementById('chart')!,
  symbol: 'BTC/USDT',
  resolution: '1H',
  theme: 'auto',
  onError: (err) => console.error('[openkline]', err),
});

chart.setData(historicalCandles);

// Declarative indicators via config objects — the same path the React and
// Vue wrappers use. `saveLayoutState` round-trips these configs.
chart.setIndicatorConfigs([
  { type: 'sma', period: 20 },
  { type: 'ema', period: 50 },
  { type: 'bb', period: 20, stdDev: 2 },
]);

// Live mode
setInterval(() => chart.updateLastCandle(latestCandle), 500);

// Shareable chart state — save to a query param, load from one
const share = btoa(JSON.stringify(chart.saveLayoutState()));
chart.loadState(JSON.parse(atob(share)));
```

### React

> Lives in [rekurt/openkline-react](https://github.com/rekurt/openkline-react).

```tsx
import { useRef, useMemo } from 'react';
import { OHLCVChart, type OHLCVChartRef } from '@rekurt/openkline-react';
import type { Candle, IndicatorConfig } from '@rekurt/openkline-core';

export function App({ candles }: { candles: Candle[] }) {
  const chartRef = useRef<OHLCVChartRef>(null);

  // Indicators are a plain config array — no `new SMA(20)` in user code.
  const indicators = useMemo<IndicatorConfig[]>(
    () => [
      { type: 'sma', period: 20 },
      { type: 'ema', period: 50 },
      { type: 'bb', period: 20, stdDev: 2 },
    ],
    [],
  );

  return (
    <div style={{ width: '100%', height: 600 }}>
      <OHLCVChart
        ref={chartRef}
        symbol="BTC/USDT"
        resolution="1H"
        data={candles}
        theme="auto"
        chartType="candles"
        indicators={indicators}
        onHover={(info) => console.log('hovered', info?.index)}
        onError={(err) => console.error('[openkline]', err)}
      />
      <button onClick={() => chartRef.current?.goToLive()}>Go live</button>
    </div>
  );
}
```

### Vue 3

> Lives in [rekurt/openkline-vue](https://github.com/rekurt/openkline-vue).

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { OHLCVChart } from '@rekurt/openkline-vue';
import type { Candle, IndicatorConfig } from '@rekurt/openkline-core';

defineProps<{ candles: Candle[] }>();

const chartRef = ref<InstanceType<typeof OHLCVChart>>();
const indicators = ref<IndicatorConfig[]>([
  { type: 'sma', period: 20 },
  { type: 'rsi', period: 14 },
]);
</script>

<template>
  <div style="width: 100%; height: 600px">
    <OHLCVChart
      ref="chartRef"
      symbol="BTC/USDT"
      resolution="1H"
      :data="candles"
      theme="auto"
      chart-type="candles"
      v-model:indicators="indicators"
      @hover="(info) => console.log('hovered', info?.index)"
      @error="(err) => console.error('[openkline]', err)"
    />
    <button @click="chartRef?.goToLive()">Go live</button>
  </div>
</template>
```

---

## What's in the box

<details open>
<summary><strong>Rendering</strong></summary>

- Candlesticks, volume bars, grid, price/time axes, crosshair with
  snap-to-candle, current-price label, legend, and a "Go to live" pill.
- Chart types: candles, **line**, **area** (with gradient), **OHLC bars**, and
  first-class **Heikin-Ashi** (`chartType: 'heikinashi'` — no manual transform).
- Hi-DPI canvas with a **three-layer split** (chart / UI / interaction) for
  cheap crosshair redraws.
- **Multi-pane** rendering: sub-pane indicators (RSI, MACD, Stochastic, ATR,
  WilliamsR, OBV, ADX, CCI) render in auto-sized vertical bands with independent
  Y-axes, labels and zero-lines.
- Theme system: `dark`, `light`, or `'auto'` following `prefers-color-scheme`.
</details>

<details>
<summary><strong>Data layer</strong></summary>

- `CandleBuffer` — O(1) `append`/`updateLast`, O(n) `prepend`, backed by `Float64Array`.
- `CandleMerger` — RAF-coalesced realtime tick merging.
- `DataFeed` — stale-response protection via a version counter.
- `PollingTransport` (HTTP) and `WebSocketTransport` (abstract base for WS adapters).
- `ExponentialBackoff` — jittered reconnect policy.
- `validateCandle` / `validateCandles` — runtime shape & invariant checks.
- `ErrorReporter` + `onError` — structured error dispatch, no silent catches.
</details>

<details>
<summary><strong>Interaction</strong></summary>

- Mouse drag pan with momentum (respects `prefers-reduced-motion`).
- Wheel handling with axis priority: trackpad horizontal → pan, vertical →
  smooth zoom, shift+wheel → pan.
- Touch: single-finger pan, two-finger pinch-zoom.
- `KeyboardController`: ← → pan, ↑ ↓ / + - zoom, Home / End / 0 / F navigation.
- `autoFollow` state machine: live updates track the right edge unless the user
  pans away. Double-click: fit visible.
</details>

<details>
<summary><strong>Indicators &amp; drawings</strong></summary>

- **Overlay:** `SMA`, `EMA`, `WMA`, `HMA`, `BollingerBands`, `Keltner`,
  `Donchian`, `VWAP`, `PivotPoints`, `Ichimoku`, `Supertrend`, `ParabolicSAR`,
  `ZigZag`.
- **Sub-pane:** `RSI`, `MACD`, `Stochastic`, `ATR`, `WilliamsR`, `OBV`, `ADX`,
  `CCI`, `MFI`, `StochRSI`, `ROC`.
- `IndicatorConfig` discriminated union + `createIndicator` factory — user code
  passes config objects; the core reconciles them.
- **Drawing tools:** `TrendLine`, `HorizontalLine`, `VerticalLine`, `Ray`,
  `Rectangle`, `FibRetracement`, `FibExtension`, `Channel`, `Arrow` — all
  anchored in buffer space so they stick to candles on pan/zoom. Subclass
  `Indicator` or `Drawing` to add your own.
</details>

---

## Architecture

```
openkline (this monorepo)
└─ packages/core   @rekurt/openkline-core   framework-agnostic engine (zero deps)
   ├─ rendering    ChartEngine, layers, axes, legend, WebGL candle renderer
   ├─ data         CandleBuffer, CandleMerger, DataFeed, transports
   ├─ interaction  Viewport, KeyboardController, autoFollow state machine
   ├─ indicators   25+ indicators + registry + createIndicator factory
   ├─ drawings     buffer-anchored drawing tools + DrawingLayer
   ├─ transforms   Heikin-Ashi, Renko
   └─ export       toSVG, PNG

rekurt/openkline-react   @rekurt/openkline-react   thin React wrapper
rekurt/openkline-vue     @rekurt/openkline-vue     thin Vue 3 wrapper
```

The wrappers own only framework glue (lifecycle, refs, reactivity). Every pixel
and every number comes from the core, which is why parity is "for free."

---

## Develop this monorepo

```bash
npm install
npm run dev:playground  # unified demo → http://localhost:5176
npm run dev:core        # vanilla demo → http://localhost:5173

npm run lint            # ESLint, --max-warnings 0
npm run typecheck       # strict tsc across all tsconfigs
npm test                # vitest — 440+ tests
npm run build           # tsup bundle for @rekurt/openkline-core
npm run docs            # TypeDoc → docs/api/
```

For the React and Vue wrapper demos, see
[rekurt/openkline-react](https://github.com/rekurt/openkline-react) and
[rekurt/openkline-vue](https://github.com/rekurt/openkline-vue).

See [CONTRIBUTING.md](./CONTRIBUTING.md) for branch, commit and review
conventions, and [CLAUDE.md](./CLAUDE.md) for how AI agents should work here.

---

## Quality bar

- **440+ unit tests** (vitest) over rendering math, indicators, transforms and state.
- **Strict TypeScript**, including `noUncheckedIndexedAccess`.
- **0 lint warnings** in CI (`--max-warnings 0`).
- **Zero runtime dependencies** in the core package.

---

## Roadmap

`0.1.0` is the first public release: the core primitives are stable and
well-tested. Upcoming milestones add deeper multi-pane integration, more
indicators and drawing tools, alerts, replay mode, compare mode, workspaces and
internationalization. See the [CHANGELOG](./CHANGELOG.md) and the
[M1 design doc](./docs/superpowers/specs/2026-04-11-ohlcv-m1-foundations-design.md).

---

## License

[MIT](./LICENSE) © OpenKline contributors
