#!/usr/bin/env node
// Refresh the vendored @rekurt/ohlcv-core tarball from the monorepo.
//
// @rekurt/ohlcv-core is not published to npm yet, so this repo vendors a
// built tarball in vendor/rekurt-ohlcv-core.tgz. Run this script to pull
// the latest core from https://github.com/rekurt/ohlcv-front, build it,
// and replace the tarball (then commit the result):
//
//   npm run update:core
//
// Once core is published to npm, drop vendor/ and switch the
// devDependency to a regular version range.

import { execSync } from 'node:child_process';
import { mkdtempSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE_REPO = 'https://github.com/rekurt/ohlcv-front.git';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_TARBALL = join(REPO_ROOT, 'vendor', 'rekurt-ohlcv-core.tgz');

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

const work = mkdtempSync(join(tmpdir(), 'ohlcv-core-'));
try {
  console.log(`Cloning ${CORE_REPO} ...`);
  run(`git clone --depth 1 ${CORE_REPO} ${join(work, 'ohlcv-front')}`);
  const mono = join(work, 'ohlcv-front');

  console.log('Installing monorepo dependencies ...');
  run('npm ci', mono);

  console.log('Building @rekurt/ohlcv-core ...');
  run('npm run build -w packages/core', mono);

  console.log('Packing tarball ...');
  run(`npm pack ${join(mono, 'packages', 'core')}`, work);
  const tarball = readdirSync(work).find((f) => f.endsWith('.tgz'));
  if (!tarball) throw new Error('npm pack produced no tarball');

  copyFileSync(join(work, tarball), VENDOR_TARBALL);
  console.log(`Updated ${VENDOR_TARBALL}`);

  console.log('Refreshing package-lock.json ...');
  run('npm install', REPO_ROOT);

  console.log('Done. Review and commit vendor/ + package-lock.json.');
} finally {
  rmSync(work, { recursive: true, force: true });
}
