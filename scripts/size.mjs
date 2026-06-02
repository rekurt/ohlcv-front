#!/usr/bin/env node
/**
 * Bundle-size reporter + CI gate.
 *
 * Two measurements:
 *  1. Tree-shaken "base chart" — what a real app pays for `import
 *     { OHLCVChart }` after minify+treeshake (the headline number; this is
 *     the apples-to-apples comparison against lightweight-charts' ~35 KB).
 *     Measured via esbuild over the built dist.
 *  2. Raw dist entries (ESM/CJS) per package — full barrels + subpaths.
 *
 * Entries listed in BUDGETS are gated: if any exceeds its gzip budget the
 * script exits non-zero, failing CI. Other entries are reported only.
 *
 * No runtime deps beyond Node built-ins + esbuild (already a tsup dep). If
 * dist/ hasn't been built, the tree-shaken measurement is skipped with a
 * notice rather than failing.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';

const ROOT = process.cwd();
const PACKAGES = ['packages/core', 'packages/react', 'packages/vue'];
const TARGET_EXTENSIONS = ['.js', '.cjs'];

/**
 * Gzip budgets in KB. Crossing one fails the script (CI gate). Numbers carry
 * a small headroom over the current size so honest growth is allowed but a
 * regression (e.g. a heavy dep sneaking into the base chart) trips the gate.
 */
const BUDGETS = {
  // Headline: the tree-shaken base chart — what a host importing only
  // `OHLCVChart` actually ships after treeshake + `sideEffects:false`. Tracks
  // real consumer cost and stays at parity with lightweight-charts (~35 KB
  // gzip). Budget 36 KB: the engine-parity stack's correctness fixes
  // (replay-lifecycle, future-bar clamps, loadState hardening) cost ~0.3 KB,
  // landing at ~35 KB — still parity vs a bare 35 KB engine that ships none of
  // the indicators/drawings/data-layer/replay this base chart carries.
  'tree-shaken:OHLCVChart': 36,
  // Framework wrappers are thin. Currently ~2 KB each.
  'packages/react:index.js': 3.5,
  'packages/vue:index.js': 4,
};

// NOT gated (reported only): the full barrel `packages/core:index.js`. It
// re-exports EVERY indicator/drawing/primitive/interaction, so it grows
// legitimately with each feature and does NOT reflect what a real consumer
// pays (tree-shaking removes the unused parts — see the headline gate above).
// Gating it would just force a budget bump per feature, which is noise.

const failures = [];

function formatKB(bytes) {
  return (bytes / 1024).toFixed(2) + ' KB';
}

function gateNote(key, gzipBytes) {
  const budget = BUDGETS[key];
  if (budget === undefined) return '';
  const gzipKB = gzipBytes / 1024;
  if (gzipKB > budget) {
    failures.push(`${key}: ${gzipKB.toFixed(2)} KB > budget ${budget} KB`);
    return `  ❌ > ${budget} KB`;
  }
  return `  ✓ ≤ ${budget} KB`;
}

/** Bundle a synthetic entry with esbuild and return its gzipped byte size. */
async function measureTreeShaken(exportStmt) {
  const mod = await import('esbuild');
  const esbuild = mod.default ?? mod;
  const result = await esbuild.build({
    stdin: { contents: exportStmt, resolveDir: ROOT, loader: 'js' },
    bundle: true,
    minify: true,
    format: 'esm',
    write: false,
    treeShaking: true,
  });
  return gzipSync(result.outputFiles[0].contents).length;
}

function collect(distDir) {
  const entries = [];
  for (const file of readdirSync(distDir)) {
    if (!TARGET_EXTENSIONS.some((ext) => file.endsWith(ext))) continue;
    if (file.endsWith('.map')) continue;
    const path = join(distDir, file);
    const stat = statSync(path);
    if (!stat.isFile()) continue;
    const content = readFileSync(path);
    entries.push({ file: basename(file), raw: content.length, gzipped: gzipSync(content).length });
  }
  return entries.sort((a, b) => a.file.localeCompare(b.file));
}

console.log('\nBundle sizes:\n');

// 1. Headline tree-shaken base chart (needs built dist + esbuild).
const coreIndex = resolve(ROOT, 'packages/core/dist/index.js');
try {
  statSync(coreIndex);
  const gzip = await measureTreeShaken(`export { OHLCVChart } from ${JSON.stringify(coreIndex)};`);
  console.log(
    `  tree-shaken base chart (OHLCVChart)   gzip ${formatKB(gzip).padStart(10)}${gateNote('tree-shaken:OHLCVChart', gzip)}`,
  );
} catch (err) {
  const why = err.code === 'ENOENT' ? 'run build first' : err.message;
  console.log(`  tree-shaken base chart: (skipped — ${why})`);
}
console.log('');

// 2. Per-package raw dist entries.
let buildMissing = false;
for (const pkg of PACKAGES) {
  const dist = join(pkg, 'dist');
  let entries;
  try {
    entries = collect(dist);
  } catch (err) {
    console.error(`  ⚠ ${pkg}: ${err.message}`);
    buildMissing = true;
    continue;
  }
  if (entries.length === 0) {
    console.log(`  ${pkg}: (no bundles found — run build first)`);
    continue;
  }
  console.log(`  ${pkg}:`);
  for (const e of entries) {
    console.log(
      `    ${e.file.padEnd(20)}  raw ${formatKB(e.raw).padStart(10)}   gzip ${formatKB(e.gzipped).padStart(10)}${gateNote(`${pkg}:${e.file}`, e.gzipped)}`,
    );
  }
}
console.log('');

if (failures.length > 0) {
  console.error('Bundle budget exceeded:');
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error('');
  process.exit(1);
}
process.exit(buildMissing ? 1 : 0);
