#!/usr/bin/env node
/**
 * Lightweight bundle-size reporter.
 *
 * Walks each library package's dist/ directory and prints both
 * raw and gzipped sizes for the ESM/CJS entry points (plus
 * subpath exports when present). No external dependencies — uses
 * the Node built-ins zlib + fs.
 *
 * Intended as a CI signal, not a gate. To turn it into a gate,
 * add a baseline JSON file and fail the script when any entry
 * grows beyond a threshold.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const PACKAGES = [
  'packages/core',
  'packages/react',
  'packages/vue',
];

const TARGET_EXTENSIONS = ['.js', '.cjs'];

function formatKB(bytes) {
  return (bytes / 1024).toFixed(2) + ' KB';
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
    const gz = gzipSync(content);
    entries.push({
      file: basename(file),
      raw: content.length,
      gzipped: gz.length,
    });
  }
  return entries.sort((a, b) => a.file.localeCompare(b.file));
}

let hasError = false;
console.log('\nBundle sizes:\n');
for (const pkg of PACKAGES) {
  const dist = join(pkg, 'dist');
  let entries;
  try {
    entries = collect(dist);
  } catch (err) {
    console.error(`  ⚠ ${pkg}: ${err.message}`);
    hasError = true;
    continue;
  }
  if (entries.length === 0) {
    console.log(`  ${pkg}: (no bundles found — run build first)`);
    continue;
  }
  console.log(`  ${pkg}:`);
  for (const e of entries) {
    console.log(
      `    ${e.file.padEnd(20)}  raw ${formatKB(e.raw).padStart(10)}   gzip ${formatKB(e.gzipped).padStart(10)}`,
    );
  }
}
console.log('');
process.exit(hasError ? 1 : 0);
