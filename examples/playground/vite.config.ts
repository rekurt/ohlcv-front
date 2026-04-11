import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

// Playground Vite config.
//
// Key choice: alias @rekurt/ohlcv-* to the workspace packages' src/
// directly, not dist/. This gives HMR for source changes in packages/
// without rebuilding tsup every edit. Production build (`vite build`)
// still produces a self-contained bundle.
//
// Without this alias, the playground serves the last-built dist/index.js
// and every change to packages/*/src would require `npm run build`.
// The preserveView bug of commit 46f8eea was caused by exactly this
// trap — never again.
export default defineConfig({
  plugins: [react(), vue()],
  resolve: {
    alias: {
      '@rekurt/ohlcv-core': fileURLToPath(
        new URL('../../packages/core/src/index.ts', import.meta.url),
      ),
      '@rekurt/ohlcv-react': fileURLToPath(
        new URL('../../packages/react/src/index.ts', import.meta.url),
      ),
      '@rekurt/ohlcv-vue': fileURLToPath(
        new URL('../../packages/vue/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5176,
    strictPort: true,
    open: false,
  },
  // Base path for the hosted build (GitHub Pages subpath).
  // Set via env if you host on a different path.
  base: process.env['PLAYGROUND_BASE'] ?? '/',
});
