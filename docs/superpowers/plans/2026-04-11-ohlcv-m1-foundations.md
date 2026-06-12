# M1 Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@rekurt/openkline-core`, `@rekurt/openkline-react`, `@rekurt/openkline-vue` v0.1.0 with full wrapper API parity, chart state persistence, unified playground, CI, and TypeDoc.

**Architecture:** Core owns all business logic (state serialization, indicator registry, diff reconciliation). React/Vue wrappers are thin adapters that translate props/reactivity into core imperative calls. Infrastructure (CI, Pages, docs) lives outside published packages.

**Tech Stack:** TypeScript 5.8, tsup (core/wrappers), Vite (examples), Vitest, jsdom, React 19, Vue 3, npm workspaces, TypeDoc, ESLint (flat config), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-04-11-ohlcv-m1-foundations-design.md`

---

## Task 1: Monorepo rename `@ohlcv/*` → `@rekurt/ohlcv-*`

**Files to modify:**
- `packages/core/package.json` (name)
- `packages/react/package.json` (name + dependency)
- `packages/vue/package.json` (name + dependency)
- `packages/react/src/OHLCVChart.tsx` (import)
- `packages/react/src/useOHLCVChart.ts` (import)
- `packages/vue/src/OHLCVChart.ts` (import)
- `packages/vue/src/useOHLCVChart.ts` (import)
- `examples/core/package.json` + `src/main.ts`
- `examples/react/package.json` + `src/App.tsx` + `src/main.tsx`
- `examples/vue/package.json` + `src/App.vue` + `src/main.ts`
- `examples/_shared/package.json` (if present)
- `README.md`

- [ ] **Step 1: Update all package.json name + dependency fields**
- [ ] **Step 2: Update all TypeScript imports via find/replace**
- [ ] **Step 3: Update root README.md package table**
- [ ] **Step 4: Run `npm install` to update workspace links**
- [ ] **Step 5: Run `npm run build && npm run typecheck && npm test` — all green**
- [ ] **Step 6: Commit — `refactor: rename @ohlcv/* → @rekurt/ohlcv-*`**

---

## Task 2: Core — `state/ChartState.ts` + tests (TDD)

**Files:**
- Create: `packages/core/src/state/ChartState.ts`
- Create: `packages/core/src/state/ChartState.test.ts`

- [ ] **Step 1: Write type assertions test**

```ts
import { describe, it, expect } from 'vitest';
import { isFullState, type LayoutState, type FullState } from './ChartState';

describe('ChartState type guards', () => {
  it('isFullState returns true when data array present', () => {
    const full: FullState = {
      version: 1, symbol: 'BTC', resolution: '1H',
      chartType: 'candles', theme: 'dark',
      viewport: { startIndex: 0, candleWidth: 8, autoFollow: true },
      indicators: [], drawings: [],
      data: [{ o: 1, h: 2, l: 0, c: 1.5, v: 10, t: 100 }],
    };
    expect(isFullState(full)).toBe(true);
  });

  it('isFullState returns false for LayoutState', () => {
    const layout: LayoutState = {
      version: 1, symbol: 'BTC', resolution: '1H',
      chartType: 'candles', theme: 'dark',
      viewport: { startIndex: 0, candleWidth: 8, autoFollow: true },
      indicators: [], drawings: [],
    };
    expect(isFullState(layout)).toBe(false);
  });
});
```

- [ ] **Step 2: Write ChartState.ts with interfaces + type guard**

```ts
import type { Candle, ChartType, ThemeMode, ThemeColors } from '../types';
import type { IndicatorConfig } from '../indicators/registry';
import type { DrawingSnapshot } from '../drawings/Drawing';

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

- [ ] **Step 3: Run tests, verify pass**
- [ ] **Step 4: Commit — `feat(core): add ChartState schema`**

---

## Task 3: Core — `indicators/registry.ts` + tests

**Files:**
- Create: `packages/core/src/indicators/registry.ts`
- Create: `packages/core/src/indicators/registry.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { createIndicator, indicatorId, diffIndicatorConfigs, type IndicatorConfig } from './registry';
import { SMA } from './SMA';
import { EMA } from './EMA';

describe('indicatorId', () => {
  it('produces stable id for equivalent configs', () => {
    expect(indicatorId({ type: 'sma', period: 20 })).toBe(indicatorId({ type: 'sma', period: 20 }));
  });
  it('differs across period', () => {
    expect(indicatorId({ type: 'sma', period: 20 })).not.toBe(indicatorId({ type: 'sma', period: 50 }));
  });
  it('differs across types', () => {
    expect(indicatorId({ type: 'sma', period: 20 })).not.toBe(indicatorId({ type: 'ema', period: 20 }));
  });
});

describe('createIndicator', () => {
  it('creates SMA instance', () => {
    expect(createIndicator({ type: 'sma', period: 20 })).toBeInstanceOf(SMA);
  });
  it('creates EMA instance', () => {
    expect(createIndicator({ type: 'ema', period: 50 })).toBeInstanceOf(EMA);
  });
  it('throws on unknown type', () => {
    expect(() => createIndicator({ type: 'xyz' as any, period: 1 } as IndicatorConfig)).toThrow();
  });
});

describe('diffIndicatorConfigs', () => {
  it('detects added', () => {
    const d = diffIndicatorConfigs([], [{ type: 'sma', period: 20 }]);
    expect(d.changed).toBe(true);
    expect(d.added).toEqual(['sma:20']);
  });
  it('detects removed', () => {
    const d = diffIndicatorConfigs([{ type: 'sma', period: 20 }], []);
    expect(d.changed).toBe(true);
    expect(d.removed).toEqual(['sma:20']);
  });
  it('detects no change', () => {
    const a = { type: 'sma' as const, period: 20 };
    const d = diffIndicatorConfigs([a], [{ type: 'sma', period: 20 }]);
    expect(d.changed).toBe(false);
  });
});
```

- [ ] **Step 2: Write registry.ts**

```ts
import type { Indicator } from './Indicator';
import { SMA } from './SMA';
import { EMA } from './EMA';
import { BollingerBands } from './BollingerBands';
import { RSI } from './RSI';
import { MACD } from './MACD';
import { Stochastic } from './Stochastic';
import { ATR } from './ATR';
import { VWAP, type VWAPAnchor } from './VWAP';

export type IndicatorConfig =
  | { type: 'sma'; period: number }
  | { type: 'ema'; period: number }
  | { type: 'bb'; period: number; stdDev: number }
  | { type: 'rsi'; period: number }
  | { type: 'macd'; fast: number; slow: number; signal: number }
  | { type: 'stoch'; kPeriod: number; dPeriod: number }
  | { type: 'atr'; period: number }
  | { type: 'vwap'; anchor: VWAPAnchor };

export function indicatorId(cfg: IndicatorConfig): string {
  switch (cfg.type) {
    case 'sma': return `sma:${cfg.period}`;
    case 'ema': return `ema:${cfg.period}`;
    case 'bb': return `bb:${cfg.period}:${cfg.stdDev}`;
    case 'rsi': return `rsi:${cfg.period}`;
    case 'macd': return `macd:${cfg.fast}:${cfg.slow}:${cfg.signal}`;
    case 'stoch': return `stoch:${cfg.kPeriod}:${cfg.dPeriod}`;
    case 'atr': return `atr:${cfg.period}`;
    case 'vwap': return `vwap:${cfg.anchor}`;
  }
}

export function createIndicator(cfg: IndicatorConfig): Indicator {
  switch (cfg.type) {
    case 'sma': return new SMA(cfg.period);
    case 'ema': return new EMA(cfg.period);
    case 'bb': return new BollingerBands(cfg.period, cfg.stdDev);
    case 'rsi': return new RSI(cfg.period);
    case 'macd': return new MACD(cfg.fast, cfg.slow, cfg.signal);
    case 'stoch': return new Stochastic(cfg.kPeriod, cfg.dPeriod);
    case 'atr': return new ATR(cfg.period);
    case 'vwap': return new VWAP(cfg.anchor);
    default: {
      const _exhaustive: never = cfg;
      throw new Error(`Unknown indicator type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export interface IndicatorDiff {
  changed: boolean;
  added: string[];
  removed: string[];
  kept: string[];
}

export function diffIndicatorConfigs(
  prev: IndicatorConfig[],
  next: IndicatorConfig[],
): IndicatorDiff {
  const prevIds = new Set(prev.map(indicatorId));
  const nextIds = new Set(next.map(indicatorId));
  const added: string[] = [];
  const removed: string[] = [];
  const kept: string[] = [];
  for (const id of nextIds) {
    if (prevIds.has(id)) kept.push(id);
    else added.push(id);
  }
  for (const id of prevIds) {
    if (!nextIds.has(id)) removed.push(id);
  }
  return {
    changed: added.length > 0 || removed.length > 0,
    added, removed, kept,
  };
}
```

- [ ] **Step 3: Run tests, verify pass**
- [ ] **Step 4: Commit — `feat(core): add indicator registry with config union + diff`**

---

## Task 4: Core — `saveState.ts` + `loadState.ts` + tests

**Files:**
- Create: `packages/core/src/state/saveState.ts`
- Create: `packages/core/src/state/loadState.ts`
- Create: `packages/core/src/state/saveState.test.ts`
- Create: `packages/core/src/state/loadState.test.ts`
- Modify: `packages/core/src/OHLCVChart.ts` (add methods)

- [ ] **Step 1: Write saveState tests (TDD — testing through OHLCVChart facade for realistic integration)**
- [ ] **Step 2: Write saveState.ts collector (pure function taking OHLCVChart and producing FullState / LayoutState)**
- [ ] **Step 3: Write loadState.ts restorer (validates version, restores in correct order)**
- [ ] **Step 4: Add `saveLayoutState/saveFullState/loadState` methods to OHLCVChart class**
- [ ] **Step 5: Run tests**
- [ ] **Step 6: Commit — `feat(core): add chart state save/load`**

---

## Task 5: Core — new OHLCVChart public methods

**Files:**
- Modify: `packages/core/src/OHLCVChart.ts`
- Modify: `packages/core/src/OHLCVChart.test.ts`

Add: `getIndicators`, `getDrawingLayer`, `startDrawing`, `getDrawings`, `loadDrawings`.

- [ ] **Step 1: Write tests for each new method**
- [ ] **Step 2: Implement methods (keep fields already present in `_engine`/`_drawingLayer` — expose readers/setters)**
- [ ] **Step 3: Commit — `feat(core): expose indicator/drawing accessors on facade`**

---

## Task 6: Core — export new APIs from index.ts

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add exports for ChartState, LayoutState, FullState, isFullState, IndicatorConfig, createIndicator, indicatorId, diffIndicatorConfigs**
- [ ] **Step 2: Build + typecheck, verify no breakage**
- [ ] **Step 3: Commit — `feat(core): export state + registry public API`**

---

## Task 7: React wrapper — full declarative props + forwardRef

**Files:**
- Modify: `packages/react/src/OHLCVChart.tsx`
- Create: `packages/react/src/OHLCVChart.test.tsx`

- [ ] **Step 1: Expand OHLCVChartProps interface with all props from spec**
- [ ] **Step 2: Expand OHLCVChartRef interface with all imperative methods**
- [ ] **Step 3: Wire chartType, theme, locale, priceFormat, volumeFormat, onHover, onError, onLoadMoreHistory via useEffect**
- [ ] **Step 4: Wire indicators prop via diffIndicatorConfigs + setIndicators(next.map(createIndicator))**
- [ ] **Step 5: Implement useImperativeHandle with all methods**
- [ ] **Step 6: Write tests (Testing Library + jsdom)**
- [ ] **Step 7: Commit — `feat(react): full wrapper API parity`**

---

## Task 8: React wrapper — useOHLCVChart hook parity

**Files:**
- Modify: `packages/react/src/useOHLCVChart.ts`
- Create: `packages/react/src/useOHLCVChart.test.tsx`

- [ ] **Step 1: Expand UseOHLCVChartOptions with all props**
- [ ] **Step 2: Return all imperative methods from hook**
- [ ] **Step 3: Tests**
- [ ] **Step 4: Commit — `feat(react): useOHLCVChart hook parity`**

---

## Task 9: Vue wrapper — reactive props + emits + defineExpose + v-model:indicators

**Files:**
- Modify: `packages/vue/src/OHLCVChart.ts`
- Create: `packages/vue/src/OHLCVChart.test.ts`

- [ ] **Step 1: Expand props, emits, defineExpose to match React parity**
- [ ] **Step 2: Add `update:indicators` emit for v-model forward compat**
- [ ] **Step 3: Wire indicators via watch + diffIndicatorConfigs**
- [ ] **Step 4: Tests**
- [ ] **Step 5: Commit — `feat(vue): full wrapper API parity + v-model:indicators`**

---

## Task 10: Vue wrapper — useOHLCVChart composable parity

**Files:**
- Modify: `packages/vue/src/useOHLCVChart.ts`
- Create: `packages/vue/src/useOHLCVChart.test.ts`

- [ ] **Step 1: Expand composable to match component props**
- [ ] **Step 2: Tests**
- [ ] **Step 3: Commit — `feat(vue): useOHLCVChart composable parity`**

---

## Task 11: ESLint setup + fix violations

**Files:**
- Create: `eslint.config.js` (flat config)
- Modify: `package.json` (add `lint` + `lint:fix` scripts)
- Fix: violations across packages/ and examples/

- [ ] **Step 1: Install deps (`eslint`, `@typescript-eslint/*`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-vue`)**
- [ ] **Step 2: Write `eslint.config.js` with TS + React + Vue**
- [ ] **Step 3: Add `lint` scripts**
- [ ] **Step 4: Run `npm run lint -- --fix` to auto-fix**
- [ ] **Step 5: Hand-fix remaining violations**
- [ ] **Step 6: Run `npm run lint` clean**
- [ ] **Step 7: Commit — `chore: add ESLint with TS/React/Vue rules`**

---

## Task 12: Unified playground `examples/playground/`

**Files:**
- Create: `examples/playground/package.json`
- Create: `examples/playground/vite.config.ts`
- Create: `examples/playground/tsconfig.json`
- Create: `examples/playground/index.html`
- Create: `examples/playground/src/main.tsx`
- Create: `examples/playground/src/App.tsx` (framework switcher)
- Create: `examples/playground/src/tabs/CoreTab.tsx`
- Create: `examples/playground/src/tabs/ReactTab.tsx`
- Create: `examples/playground/src/tabs/VueTab.tsx`
- Create: `examples/playground/src/shareUrl.ts`
- Modify: `package.json` (add `dev:playground`, `build:playground`)
- Modify: root `package.json` workspaces

- [ ] **Step 1: Scaffold Vite+React+Vue app**
- [ ] **Step 2: Implement framework switcher tabs**
- [ ] **Step 3: Implement share-URL flow (saveLayoutState → base64 → ?state=)**
- [ ] **Step 4: Run `dev:playground` — manual smoke**
- [ ] **Step 5: Commit — `feat(playground): unified demo with framework switcher`**

---

## Task 13: TypeDoc + root config

**Files:**
- Create: `typedoc.json`
- Install: `typedoc`
- Modify: `package.json` (`docs` script)

- [ ] **Step 1: Install typedoc**
- [ ] **Step 2: Write typedoc.json (entryPointStrategy: packages)**
- [ ] **Step 3: Add `npm run docs`**
- [ ] **Step 4: Run once, verify HTML output**
- [ ] **Step 5: Commit — `docs: add TypeDoc config`**

---

## Task 14: GitHub Actions — `ci.yml` + `pages.yml`

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/pages.yml`

- [ ] **Step 1: Write ci.yml (lint + typecheck + test + build)**
- [ ] **Step 2: Write pages.yml (build playground + typedoc → gh-pages)**
- [ ] **Step 3: Commit — `ci: add CI and Pages workflows`**

---

## Task 15: CHANGELOG + CONTRIBUTING + README refresh

**Files:**
- Create: `CHANGELOG.md`
- Create: `CONTRIBUTING.md`
- Modify: `README.md`

- [ ] **Step 1: Write CHANGELOG (Keep-a-Changelog 0.1.0 entry)**
- [ ] **Step 2: Write CONTRIBUTING with dev setup**
- [ ] **Step 3: Refresh README with new package names + quickstarts + badges**
- [ ] **Step 4: Commit — `docs: CHANGELOG, CONTRIBUTING, README refresh`**

---

## Task 16: Version bump to 0.1.0

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/react/package.json`
- Modify: `packages/vue/package.json`

- [ ] **Step 1: Bump all three to 0.1.0**
- [ ] **Step 2: Final `npm run lint && typecheck && test && build`**
- [ ] **Step 3: Commit — `chore: bump to 0.1.0`**
- [ ] **Step 4: Tag `v0.1.0`**
- [ ] **Step 5: Manual `npm publish --access public` (user action — requires npm login + OTP)**

---

## Deep-review cycles (×7)

After all 16 tasks land, run 7 review cycles. Each cycle:

1. **Cycle N: Scope and consistency audit** — skim plan vs implemented code, find gaps, fix inline
2. **Cycle N: API surface audit** — every core method exposed through both wrappers with matching sig
3. **Cycle N: Test coverage audit** — every new public API has tests, regression for preserveView still green
4. **Cycle N: Type safety audit** — no `any`, no `@ts-ignore`, strict flags honored
5. **Cycle N: DX audit** — README quickstarts work verbatim, error messages clear
6. **Cycle N: Performance audit** — no O(n²) loops in hot paths, useMemo reference stability
7. **Cycle N: Security audit** — saveState/loadState validates inputs, no `eval`/`Function`, no XSS in playground

Each cycle commits fixes separately: `fix(review-N): <short summary>`.
