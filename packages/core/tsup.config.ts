import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    indicators: 'src/indicators/index.ts',
    drawings: 'src/drawings/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  treeshake: true,
  clean: true,
});
