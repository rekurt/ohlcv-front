# @rekurt/ohlcv

[![CI](https://github.com/rekurt/ohlcv-front/actions/workflows/ci.yml/badge.svg)](https://github.com/rekurt/ohlcv-front/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

A fast, framework-agnostic OHLCV chart library for the web. Canvas-based
rendering, TypedArray buffers, explicit auto-follow state machine,
keyboard-first UX, pluggable indicators and transports, and idiomatic
React and Vue wrappers with full API parity.

- 🎮 **Playground**: https://rekurt.github.io/ohlcv-front/
- 📖 **API reference**: https://rekurt.github.io/ohlcv-front/api/
- 📝 **Changelog**: [CHANGELOG.md](./CHANGELOG.md)

## Packages

| Package | Purpose |
| --- | --- |
| [`@rekurt/ohlcv-core`](./packages/core) | Framework-agnostic rendering + data + interaction (no React/Vue) |
| [`@rekurt/ohlcv-react`](./packages/react) | React 18+/19 wrapper — `<OHLCVChart>` component + `useOHLCVChart` hook |
| [`@rekurt/ohlcv-vue`](./packages/vue) | Vue 3 wrapper — `<OHLCVChart>` component + `useOHLCVChart` composable |

## Install

```bash
# Vanilla TypeScript / bring-your-own framework
npm install @rekurt/ohlcv-core

# React
npm install @rekurt/ohlcv-core @rekurt/ohlcv-react

# Vue 3
npm install @rekurt/ohlcv-core @rekurt/ohlcv-vue
```

## Quick start (development of this monorepo)

```bash
npm install
npm run dev:playground  # unified demo → http://localhost:5176
# or individual framework demos:
npm run dev:core        # → http://localhost:5173
npm run dev:react       # → http://localhost:5174
npm run dev:vue         # → http://localhost:5175

npm run lint            # ESLint (TS + React + Vue), --max-warnings 0
npm run typecheck       # strict tsc across all tsconfigs
npm test                # vitest — 440+ tests
npm run build           # tsup bundles for all three packages
npm run docs            # TypeDoc → docs/api/
```

## What's in the core library

**Rendering** (`@rekurt/ohlcv-core`):
- Candlesticks, volume bars, grid, price axis, time axis, crosshair with snap-to-candle, current price label, legend, "Go to live" pill
- Alternative chart types: line, area (with gradient), OHLC bars
- Hi-DPI canvas with three-layer split (chart / UI / interaction) for cheap crosshair redraws
- `Pane` + `PaneLayout` abstraction for multi-pane charts with independent Y-axes (linear or log)
- Theme system: dark, light, or `'auto'` following `prefers-color-scheme`

**Data layer**:
- `CandleBuffer` — O(1) `append`/`updateLast`, O(n) `prepend`, backing `Float64Array`
- `CandleMerger` — RAF-coalesced realtime tick merging
- `DataFeed` — stale-response protection via version counter
- `PollingTransport` — HTTP polling with custom parser
- `WebSocketTransport` — abstract base for WS adapters
- `BinanceWsTransport` — concrete WS adapter for Binance klines (skeleton)
- `ExponentialBackoff` — jittered reconnect policy
- `validateCandle` / `validateCandles` — runtime shape & invariant checks
- `ErrorReporter` + `onError` callback — structured error dispatch, no silent catches

**Interaction**:
- Mouse drag pan with momentum (respects `prefers-reduced-motion`)
- Wheel handling with axis priority: trackpad horizontal → pan, vertical → smooth zoom, shift+wheel → pan
- Touch: single-finger pan, two-finger pinch-zoom
- `KeyboardController`: ← → pan, ↑ ↓ / + - zoom, Home / End / 0 / F navigation
- `autoFollow` state machine: live updates track the right edge unless the user pans away
- Double-click: fit visible

**Indicators** (`@rekurt/ohlcv-core/indicators`):
- `SMA`, `EMA`, `BollingerBands` (overlay on main pane)
- `RSI` (sub-pane, placement: `'pane'`)
- Base class `Indicator` + `IndicatorSeries` — add your own by subclassing

## Minimal usage (vanilla)

```ts
import { OHLCVChart, SMA } from '@rekurt/ohlcv-core';

const chart = new OHLCVChart({
  container: document.getElementById('chart')!,
  symbol: 'BTC/USDT',
  resolution: '1H',
  theme: 'auto',
  onError: (err) => console.error('[chart]', err),
});

chart.setData(historicalCandles);

// Optional: compute an indicator for your own overlay renderer
const sma = new SMA(20);
const [{ values }] = sma.compute(chart.getBuffer());

// Live mode
setInterval(() => {
  chart.updateLastCandle(latestCandle);
}, 500);
```

## React

```tsx
import { useRef, useState, useMemo } from 'react';
import {
  OHLCVChart,
  type OHLCVChartRef,
} from '@rekurt/ohlcv-react';
import type { Candle, IndicatorConfig } from '@rekurt/ohlcv-core';

export function App({ candles }: { candles: Candle[] }) {
  const chartRef = useRef<OHLCVChartRef>(null);
  const [symbol, setSymbol] = useState('BTC/USDT');
  const [resolution, setResolution] = useState('1H');

  // Indicators are a plain config array — no `new SMA(20)` in user code.
  // The wrapper runs them through createIndicator() + diffIndicatorConfigs()
  // so the reference stays stable across hover-driven re-renders.
  const indicators = useMemo<IndicatorConfig[]>(
    () => [
      { type: 'sma', period: 20 },
      { type: 'ema', period: 50 },
      { type: 'bb', period: 20, stdDev: 2 },
    ],
    [],
  );

  return (
    <div style={{ width: '100%', height: '600px' }}>
      <OHLCVChart
        ref={chartRef}
        symbol={symbol}
        resolution={resolution}
        data={candles}
        theme="auto"
        chartType="candles"
        indicators={indicators}
        onHover={(info) => console.log('hovered', info?.index)}
        onError={(err) => console.error('[chart]', err)}
      />
      <button onClick={() => chartRef.current?.goToLive()}>Go live</button>
      <button onClick={() => {
        const state = chartRef.current?.saveLayoutState();
        if (state) navigator.clipboard.writeText(btoa(JSON.stringify(state)));
      }}>
        Share
      </button>
    </div>
  );
}
```

## Vue 3

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { OHLCVChart } from '@rekurt/ohlcv-vue';
import type { Candle, IndicatorConfig } from '@rekurt/ohlcv-core';

defineProps<{ candles: Candle[] }>();

const chartRef = ref<InstanceType<typeof OHLCVChart>>();
const indicators = ref<IndicatorConfig[]>([
  { type: 'sma', period: 20 },
  { type: 'rsi', period: 14 },
]);

function goLive() {
  chartRef.value?.goToLive();
}
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
      @error="(err) => console.error('[chart]', err)"
    />
    <button @click="goLive">Go live</button>
  </div>
</template>
```

## Status

0.1.0 is the first public release. Core primitives are stable and
well-tested (440+ unit tests, strict TypeScript including
`noUncheckedIndexedAccess`, 0 lint warnings in CI). The M1 roadmap
milestone focuses on wrapper API parity and distribution — upcoming
milestones add multi-pane integration, more indicators and drawing
tools, alerts, replay mode, compare mode, workspaces, and
internationalization. See [CHANGELOG.md](./CHANGELOG.md) and the
[M1 design doc](./docs/superpowers/specs/2026-04-11-ohlcv-m1-foundations-design.md).

## License

MIT
