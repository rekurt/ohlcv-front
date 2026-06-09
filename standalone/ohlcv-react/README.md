# @rekurt/ohlcv-react

[![CI](https://github.com/rekurt/ohlcv-react/actions/workflows/ci.yml/badge.svg)](https://github.com/rekurt/ohlcv-react/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

React 18+/19 wrapper for [`@rekurt/ohlcv-core`](https://github.com/rekurt/ohlcv-front) —
a fast, framework-agnostic OHLCV candlestick chart library. This package
provides an idiomatic `<OHLCVChart>` component and a `useOHLCVChart` hook
with full API parity with the core.

Related repositories:

- [`rekurt/ohlcv-front`](https://github.com/rekurt/ohlcv-front) — `@rekurt/ohlcv-core`: rendering, data layer, interaction, indicators, drawings
- [`rekurt/ohlcv-vue`](https://github.com/rekurt/ohlcv-vue) — Vue 3 wrapper

## Install

```bash
npm install @rekurt/ohlcv-core @rekurt/ohlcv-react
```

> **Note**: until the packages are published to npm, this repo vendors a
> built core tarball in `vendor/rekurt-ohlcv-core.tgz` so that
> `npm install` works out of the box. Refresh it with `npm run update:core`.

## Usage

```tsx
import { useRef, useState, useMemo } from 'react';
import { OHLCVChart, type OHLCVChartRef } from '@rekurt/ohlcv-react';
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
    </div>
  );
}
```

## Development

```bash
npm install          # installs deps incl. the vendored core tarball
npm run build        # tsup → dist/ (esm + cjs + d.ts)
npm test             # vitest (jsdom)
npm run lint         # ESLint, --max-warnings 0
npm run typecheck    # strict tsc (run after build — example needs dist/)
npm run dev:example  # vite demo app → http://localhost:5174
npm run update:core  # refresh vendor/rekurt-ohlcv-core.tgz from the monorepo
```

The `example/` workspace is a full-featured Vite demo (drawing tools,
indicators, live simulation, Heikin-Ashi/Renko transforms, PNG export).

## License

MIT
