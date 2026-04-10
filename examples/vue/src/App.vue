<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { OHLCVChart } from '@ohlcv/vue';
import {
  formatPrice,
  formatTime,
  type Candle,
  type ThemeMode,
  type OHLCVChart as CoreChart,
} from '@ohlcv/core';
import {
  SYMBOLS,
  RESOLUTIONS,
  generateCandles,
  advanceLastCandle,
} from '@ohlcv-examples/shared';
import Toolbar from './Toolbar.vue';

const CANDLE_COUNT = 500;
const LIVE_TICK_MS = 500;

const symbolId = ref<string>(SYMBOLS[0].id);
const resolutionId = ref<string>('1H');
const theme = ref<ThemeMode>('dark');
const live = ref(false);
const status = ref('Click a candle to see details · drag to pan · wheel to zoom · ↔ to scroll');

const symbol = computed(() => SYMBOLS.find((s) => s.id === symbolId.value) ?? SYMBOLS[0]);
const resolution = computed(
  () => RESOLUTIONS.find((r) => r.id === resolutionId.value) ?? RESOLUTIONS[0],
);

// Ref to the chart component. `.chart` is exposed by @ohlcv/vue and gives
// us imperative access to the underlying core chart instance.
const chartComponentRef = ref<{ chart: CoreChart | null } | null>(null);

// `data` changes only when symbol/resolution changes — never during live ticks.
// Live updates are applied through the imperative `updateLastCandle` API so
// that the viewport is not reset each tick.
const data = ref<Candle[]>([]);
const liveCandles = ref<Candle[]>([]);

function regenerate() {
  const next = generateCandles({
    symbol: symbol.value,
    resolution: resolution.value,
    count: CANDLE_COUNT,
  });
  data.value = next;
  liveCandles.value = next;
}
regenerate();

watch([symbol, resolution], () => {
  if (live.value) live.value = false;
  regenerate();
});

// Live simulation loop — imperative path, does not touch the `data` prop.
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
    const arr = liveCandles.value;
    if (!core || arr.length === 0) return;
    const last = arr[arr.length - 1];
    const next = advanceLastCandle({
      lastCandle: last,
      symbol: symbol.value,
      tickIndex: ++tickIndex,
    });
    arr[arr.length - 1] = next;
    core.updateLastCandle(next);
  }, LIVE_TICK_MS);
});

onBeforeUnmount(() => {
  if (liveTimer) clearInterval(liveTimer);
});

function handleCandleClick(candle: Candle, index: number) {
  status.value =
    `#${index}  ${formatTime(candle.t, resolution.value.id)}  ` +
    `O ${formatPrice(candle.o)}  H ${formatPrice(candle.h)}  ` +
    `L ${formatPrice(candle.l)}  C ${formatPrice(candle.c)}  ` +
    `V ${Math.round(candle.v)}`;
}

function toggleTheme() {
  const next = theme.value === 'dark' ? 'light' : 'dark';
  theme.value = next;
  document.documentElement.style.colorScheme = next;
}
</script>

<template>
  <Toolbar
    :symbols="SYMBOLS"
    :resolutions="RESOLUTIONS"
    :symbol-id="symbolId"
    :resolution-id="resolutionId"
    :theme="theme"
    :live="live"
    :status="status"
    @update:symbol-id="symbolId = $event"
    @update:resolution-id="resolutionId = $event"
    @toggle-theme="toggleTheme"
    @toggle-live="live = !live"
  />
  <div class="chart-wrap">
    <OHLCVChart
      ref="chartComponentRef"
      :symbol="symbol.label"
      :resolution="resolution.id"
      :data="data"
      :theme="theme"
      @candle-click="handleCandleClick"
    />
  </div>
</template>

<!--
  Alternative: composable-based usage

  <script setup lang="ts">
  import { useOHLCVChart } from '@ohlcv/vue';
  import { onMounted } from 'vue';
  const { containerRef, setData } = useOHLCVChart({
    symbol: 'BTC/USDT',
    resolution: '1H',
    theme: 'dark',
  });
  onMounted(() => setData(generateCandles({ symbol: SYMBOLS[0], resolution: RESOLUTIONS[3], count: 500 })));
  </script>

  <template><div ref="containerRef" style="width:100%;height:100vh" /></template>
-->
