import { bench, describe } from 'vitest';
import { CandleBuffer } from '../data/CandleBuffer';
import { findGaps } from '../data/gaps';
import type { Candle } from '../types';

/**
 * CandleBuffer hot-path throughput: ingestion (append / appendBatch),
 * realtime updates (updateLast), zero-copy reads (sliceView), and a full-scan
 * consumer (findGaps). These pin the columnar Float64Array + O(1) head-offset
 * design and guard against regressions in the data layer.
 *
 * Run: `npm run bench`.
 */
function makeCandle(i: number): Candle {
  const price = 100 + Math.sin(i / 10) * 5;
  const o = price;
  const c = price + Math.cos(i / 7) * 0.3;
  return {
    o,
    h: Math.max(o, c) + 0.5,
    l: Math.min(o, c) - 0.5,
    c,
    v: 1000 + (i % 500),
    t: 1_700_000_000 + i * 60,
  };
}

function makeArray(n: number): Candle[] {
  const out = new Array<Candle>(n);
  for (let i = 0; i < n; i++) out[i] = makeCandle(i);
  return out;
}

const N = 50_000;
const SAMPLE = makeArray(N);

// Pre-built buffer for read/update benchmarks.
const prebuilt = new CandleBuffer(N);
for (const c of SAMPLE) prebuilt.append(c);

describe(`CandleBuffer @ ${N} candles`, () => {
  bench('append (fresh buffer)', () => {
    const buf = new CandleBuffer();
    for (let i = 0; i < N; i++) buf.append(SAMPLE[i]!);
  });

  bench('appendBatch (fresh buffer)', () => {
    const buf = new CandleBuffer();
    buf.appendBatch(SAMPLE);
  });

  bench('updateLast x N (realtime tick simulation)', () => {
    const last = SAMPLE[N - 1]!;
    for (let i = 0; i < N; i++) prebuilt.updateLast(last);
  });

  bench('sliceView(0, N) full zero-copy view', () => {
    prebuilt.sliceView(0, prebuilt.length);
  });

  bench('findGaps (full scan)', () => {
    findGaps(prebuilt, 60);
  });
});
