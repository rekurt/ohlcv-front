# @rekurt/ohlcv-vue

[![CI](https://github.com/rekurt/ohlcv-vue/actions/workflows/ci.yml/badge.svg)](https://github.com/rekurt/ohlcv-vue/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

Vue 3 wrapper for [`@rekurt/ohlcv-core`](https://github.com/rekurt/ohlcv-front) —
a fast, framework-agnostic OHLCV candlestick chart library. This package
provides an idiomatic `<OHLCVChart>` component and a `useOHLCVChart`
composable with full API parity with the core.

Related repositories:

- [`rekurt/ohlcv-front`](https://github.com/rekurt/ohlcv-front) — `@rekurt/ohlcv-core`: rendering, data layer, interaction, indicators, drawings
- [`rekurt/ohlcv-react`](https://github.com/rekurt/ohlcv-react) — React 18+/19 wrapper

## Install

```bash
npm install @rekurt/ohlcv-core @rekurt/ohlcv-vue
```

> **Note**: until the packages are published to npm, this repo vendors a
> built core tarball in `vendor/rekurt-ohlcv-core.tgz` so that
> `npm install` works out of the box. Refresh it with `npm run update:core`.

## Usage

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

The `useOHLCVChart` composable is exported for callers that want to manage
the chart instance imperatively instead of through the component.

## Development

```bash
npm install          # installs deps incl. the vendored core tarball
npm run build        # tsup → dist/ (esm + cjs + d.ts)
npm test             # vitest (jsdom)
npm run lint         # ESLint, --max-warnings 0
npm run typecheck    # strict tsc (run after build — example needs dist/)
npm run dev:example  # vite demo app → http://localhost:5175
npm run update:core  # refresh vendor/rekurt-ohlcv-core.tgz from the monorepo
```

The `example/` workspace is a full-featured Vite demo (drawing tools,
indicators, live simulation, Heikin-Ashi/Renko transforms, PNG export).

## License

MIT
