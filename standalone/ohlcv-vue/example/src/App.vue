<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { OHLCVChart } from '@rekurt/ohlcv-vue';
import {
  formatPrice,
  formatTime,
  SMA,
  EMA,
  BollingerBands,
  VWAP,
  DrawingLayer,
  TrendLine,
  HorizontalLine,
  toHeikinAshi,
  toRenko,
  type Candle,
  type ChartType,
  type HoverInfo,
  type Indicator,
  type ThemeMode,
  type OHLCVChart as CoreChart,
} from '@rekurt/ohlcv-core';
import {
  SYMBOLS,
  RESOLUTIONS,
  generateCandles,
  advanceLastCandle,
} from './shared';

type DrawingTool = 'none' | 'trendline' | 'hline';
type DataTransform = 'none' | 'heikin-ashi' | 'renko';
type IndicatorId = 'sma20' | 'ema50' | 'bb' | 'vwap';

const CANDLE_COUNT = 500;
const LIVE_TICK_MS = 500;
const RENKO_BRICK_RATIO = 0.001;

// ---- State ----
const symbolId = ref(SYMBOLS[0]!.id);
const resolutionId = ref('1H');
const theme = ref<ThemeMode>('dark');
const chartType = ref<ChartType>('candles');
const dataTransform = ref<DataTransform>('none');
const live = ref(false);
const indicatorSet = ref<Set<IndicatorId>>(new Set());
const activeTool = ref<DrawingTool>('none');
const hover = ref<HoverInfo | null>(null);
const indicatorMenuOpen = ref(false);

const symbol = computed(() => SYMBOLS.find((s) => s.id === symbolId.value) ?? SYMBOLS[0]!);
const resolution = computed(
  () => RESOLUTIONS.find((r) => r.id === resolutionId.value) ?? RESOLUTIONS[0]!,
);

const chartComponentRef = ref<{ chart: CoreChart | null } | null>(null);
const drawingLayer = new DrawingLayer();

// Raw candles + derived render data (after transform)
const rawCandles = ref<Candle[]>([]);
const renderData = ref<Candle[]>([]);

function applyTransform(raw: Candle[]): Candle[] {
  if (dataTransform.value === 'heikin-ashi') return toHeikinAshi(raw);
  if (dataTransform.value === 'renko') {
    const brickSize = Math.max(0.01, symbol.value.basePrice * RENKO_BRICK_RATIO);
    const bricks = toRenko(raw, brickSize);
    return bricks.length > 0 ? bricks : raw;
  }
  return raw;
}

function regenerate(): void {
  const raw = generateCandles({
    symbol: symbol.value,
    resolution: resolution.value,
    count: CANDLE_COUNT,
  });
  rawCandles.value = raw;
  renderData.value = applyTransform(raw);
}
regenerate();

function buildIndicators(): Indicator[] {
  const list: Indicator[] = [];
  if (indicatorSet.value.has('sma20')) list.push(new SMA(20));
  if (indicatorSet.value.has('ema50')) list.push(new EMA(50));
  if (indicatorSet.value.has('bb')) list.push(new BollingerBands(20, 2));
  if (indicatorSet.value.has('vwap')) list.push(new VWAP('session'));
  return list;
}

onMounted(() => {
  const core = chartComponentRef.value?.chart;
  if (!core) return;
  core.setDrawingLayer(drawingLayer);
  core.setChartType(chartType.value);
  core.setIndicators(buildIndicators());
  core.setOnHover((info) => (hover.value = info));
});

watch(chartType, (next) => chartComponentRef.value?.chart?.setChartType(next));
watch(
  indicatorSet,
  () => chartComponentRef.value?.chart?.setIndicators(buildIndicators()),
  { deep: true },
);
watch(dataTransform, () => {
  renderData.value = applyTransform(rawCandles.value);
});
watch([symbol, resolution], () => {
  if (live.value) live.value = false;
  regenerate();
});
watch(activeTool, () => {
  drawingLayer.cancelActive();
  chartComponentRef.value?.chart?.render();
});

// Live simulation
let liveTimer: ReturnType<typeof setInterval> | null = null;
watch(live, (on) => {
  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = null;
  }
  if (!on) return;
  let tickIndex = 0;
  liveTimer = setInterval(() => {
    const core = chartComponentRef.value?.chart;
    const raw = rawCandles.value;
    if (!core || raw.length === 0) return;
    const last = raw[raw.length - 1]!;
    const next = advanceLastCandle({
      lastCandle: last,
      symbol: symbol.value,
      tickIndex: ++tickIndex,
    });
    raw[raw.length - 1] = next;
    if (dataTransform.value === 'none') {
      core.updateLastCandle(next);
    } else {
      renderData.value = applyTransform(raw);
    }
  }, LIVE_TICK_MS);
});

function onKeyDown(e: KeyboardEvent) {
  const target = e.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  )
    return;
  if (e.key === 't' || e.key === 'T') activeTool.value = 'trendline';
  else if (e.key === 'h' || e.key === 'H') activeTool.value = 'hline';
  else if (e.key === 'Escape') activeTool.value = 'none';
}

function onDocumentClick() {
  indicatorMenuOpen.value = false;
}

onMounted(() => {
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('click', onDocumentClick);
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('click', onDocumentClick);
  if (liveTimer) clearInterval(liveTimer);
});

function toggleTheme() {
  const next = theme.value === 'dark' ? 'light' : 'dark';
  theme.value = next;
  document.documentElement.style.colorScheme = next;
}

function toggleIndicator(id: IndicatorId) {
  const next = new Set(indicatorSet.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  indicatorSet.value = next;
}

function clearDrawings() {
  drawingLayer.clear();
  drawingLayer.cancelActive();
  chartComponentRef.value?.chart?.render();
}

function exportPng() {
  const core = chartComponentRef.value?.chart;
  if (!core) return;
  const url = core.toPNG();
  if (!url) return;
  const link = document.createElement('a');
  link.href = url;
  link.download = `${symbolId.value}-${resolutionId.value}-${Date.now()}.png`;
  link.click();
}

function onChartClick(e: MouseEvent) {
  if (activeTool.value === 'none') return;
  const core = chartComponentRef.value?.chart;
  if (!core) return;
  const wrapper = e.currentTarget as HTMLElement;
  const canvases = wrapper.querySelectorAll('canvas');
  const topCanvas = canvases[canvases.length - 1];
  if (!(topCanvas instanceof HTMLCanvasElement)) return;
  const rect = topCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const viewport = core.getViewport();
  const layout = viewport.layout;
  if (
    x < layout.chartLeft ||
    x > layout.chartRight ||
    y < layout.chartTop ||
    y > layout.chartBottom
  )
    return;
  const index = viewport.xToIndex(x);
  const price = viewport.yToPrice(y);
  if (!drawingLayer.active) {
    if (activeTool.value === 'trendline') drawingLayer.startDrawing(new TrendLine());
    else if (activeTool.value === 'hline') drawingLayer.startDrawing(new HorizontalLine());
  }
  drawingLayer.addPoint({ index, price });
  core.render();
}

function toggleIndicatorMenu(e: MouseEvent) {
  e.stopPropagation();
  indicatorMenuOpen.value = !indicatorMenuOpen.value;
}

function hoverCls(): string {
  return hover.value && hover.value.candle.c >= hover.value.candle.o ? 'bull' : 'bear';
}

function hoverChange(): number {
  if (!hover.value) return 0;
  return hover.value.candle.c - hover.value.candle.o;
}
function hoverChangePct(): number {
  if (!hover.value || hover.value.candle.o === 0) return 0;
  return (hoverChange() / hover.value.candle.o) * 100;
}
</script>

<template>
  <div class="app">
    <aside class="sidebar">
      <button
        :class="{ active: activeTool === 'none' }"
        title="Select / no tool (Esc)"
        @click="activeTool = 'none'"
      >
        ✋
      </button>
      <button
        :class="{ active: activeTool === 'trendline' }"
        title="Trend line (T)"
        @click="activeTool = 'trendline'"
      >
        ╱
      </button>
      <button
        :class="{ active: activeTool === 'hline' }"
        title="Horizontal line (H)"
        @click="activeTool = 'hline'"
      >
        ━
      </button>
      <div class="spacer" />
      <button title="Clear all drawings" @click="clearDrawings">🗑</button>
      <button title="Export chart as PNG" @click="exportPng">📷</button>
    </aside>

    <header class="toolbar">
      <label>Symbol</label>
      <select :value="symbolId" @change="symbolId = ($event.target as HTMLSelectElement).value">
        <option v-for="s in SYMBOLS" :key="s.id" :value="s.id">{{ s.label }}</option>
      </select>

      <label>TF</label>
      <select
        :value="resolutionId"
        @change="resolutionId = ($event.target as HTMLSelectElement).value"
      >
        <option v-for="r in RESOLUTIONS" :key="r.id" :value="r.id">{{ r.id }}</option>
      </select>

      <label>Type</label>
      <select
        :value="chartType"
        @change="chartType = ($event.target as HTMLSelectElement).value as ChartType"
      >
        <option value="candles">Candles</option>
        <option value="line">Line</option>
        <option value="area">Area</option>
        <option value="ohlc">OHLC Bars</option>
      </select>

      <label>Data</label>
      <select
        :value="dataTransform"
        @change="dataTransform = ($event.target as HTMLSelectElement).value as DataTransform"
      >
        <option value="none">Raw</option>
        <option value="heikin-ashi">Heikin Ashi</option>
        <option value="renko">Renko</option>
      </select>

      <div class="indicator-menu">
        <button @click="toggleIndicatorMenu">Indicators ▾</button>
        <div v-if="indicatorMenuOpen" class="indicator-dropdown" @click.stop>
          <label>
            <input
              type="checkbox"
              :checked="indicatorSet.has('sma20')"
              @change="toggleIndicator('sma20')"
            />
            SMA(20)
          </label>
          <label>
            <input
              type="checkbox"
              :checked="indicatorSet.has('ema50')"
              @change="toggleIndicator('ema50')"
            />
            EMA(50)
          </label>
          <label>
            <input
              type="checkbox"
              :checked="indicatorSet.has('bb')"
              @change="toggleIndicator('bb')"
            />
            Bollinger Bands
          </label>
          <label>
            <input
              type="checkbox"
              :checked="indicatorSet.has('vwap')"
              @change="toggleIndicator('vwap')"
            />
            VWAP (session)
          </label>
        </div>
      </div>

      <button @click="toggleTheme">{{ theme === 'dark' ? '🌙' : '☀' }}</button>
      <button :class="{ active: live }" @click="live = !live">
        {{ live ? '■ Stop' : '▶ Live' }}
      </button>

      <span class="spacer" />
      <span class="symbol-label">{{ symbol.label }} · {{ resolution.id }}</span>
    </header>

    <div class="chart-wrap" @click="onChartClick">
      <OHLCVChart
        ref="chartComponentRef"
        :symbol="symbol.label"
        :resolution="resolution.id"
        :data="renderData"
        :theme="theme"
      />
    </div>

    <footer class="status-bar">
      <template v-if="hover">
        <span :class="hoverCls()">#{{ hover.index }}</span>
        <span>&nbsp;&nbsp;{{ formatTime(hover.candle.t, resolution.id) }}&nbsp;&nbsp;</span>
        <span>O <b>{{ formatPrice(hover.candle.o) }}</b></span>
        <span>H <b>{{ formatPrice(hover.candle.h) }}</b></span>
        <span>L <b>{{ formatPrice(hover.candle.l) }}</b></span>
        <span>C <b>{{ formatPrice(hover.candle.c) }}</b></span>
        <span>V <b>{{ Math.round(hover.candle.v).toLocaleString() }}</b></span>
        <span :class="hoverCls()">
          {{ hoverChange() >= 0 ? '+' : '' }}{{ hoverChange().toFixed(2) }}
          ({{ hoverChangePct() >= 0 ? '+' : '' }}{{ hoverChangePct().toFixed(2) }}%)
        </span>
      </template>
      <span v-else>Hover chart to see OHLCV</span>
      <span class="hint">
        Drag pan · Wheel zoom · ←→ keys · T trend · H hline · Esc cancel · Dbl-click fit
      </span>
    </footer>
  </div>
</template>
