<script setup lang="ts">
import type { SymbolInfo, ResolutionInfo } from '@ohlcv-examples/shared';
import type { ThemeMode } from '@ohlcv/core';

defineProps<{
  symbols: readonly SymbolInfo[];
  resolutions: readonly ResolutionInfo[];
  symbolId: string;
  resolutionId: string;
  theme: ThemeMode;
  live: boolean;
  status: string;
}>();

defineEmits<{
  (e: 'update:symbolId', value: string): void;
  (e: 'update:resolutionId', value: string): void;
  (e: 'toggleTheme'): void;
  (e: 'toggleLive'): void;
}>();
</script>

<template>
  <header class="toolbar">
    <label>Symbol</label>
    <select
      :value="symbolId"
      @change="$emit('update:symbolId', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="s in symbols" :key="s.id" :value="s.id">{{ s.label }}</option>
    </select>

    <label>Resolution</label>
    <select
      :value="resolutionId"
      @change="$emit('update:resolutionId', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="r in resolutions" :key="r.id" :value="r.id">{{ r.id }}</option>
    </select>

    <button @click="$emit('toggleTheme')">
      {{ theme === 'dark' ? '🌙 Dark' : '☀ Light' }}
    </button>

    <button :class="{ active: live }" @click="$emit('toggleLive')">
      {{ live ? '■ Stop' : '▶ Live' }}
    </button>

    <span class="spacer" />
    <span class="status">{{ status }}</span>
  </header>
</template>
