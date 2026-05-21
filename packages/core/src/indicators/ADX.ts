import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Average Directional Index (Wilder 1978) — trend strength oscillator
 * with three series: `+DI`, `-DI`, and `ADX`.
 *
 *   +DM = max(high[i] − high[i-1], 0)  if high move > low move else 0
 *   -DM = max(low[i-1] − low[i], 0)    if low move > high move else 0
 *   TR  = max(h-l, |h-prevC|, |prevC-l|)
 *
 * Wilder-smoothed +DM, -DM, TR over `period`, then:
 *   +DI = 100 * smoothed(+DM) / smoothed(TR)
 *   -DI = 100 * smoothed(-DM) / smoothed(TR)
 *   DX  = 100 * |+DI - -DI| / (+DI + -DI)
 *   ADX = Wilder-smoothed DX
 *
 * Both smoothings warm up over `period` bars, so ADX itself is
 * available starting at index `2*period − 1`.
 */
export class ADX extends Indicator {
  readonly placement: IndicatorPlacement = 'pane';

  constructor(public readonly period: number = 14) {
    super();
    if (!Number.isInteger(period) || period < 2) {
      throw new Error(`ADX period must be an integer >= 2, got ${period}`);
    }
  }

  get id(): string {
    return `adx(${this.period})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const plusDI = nanArray(n);
    const minusDI = nanArray(n);
    const adx = nanArray(n);
    const p = this.period;

    if (n === 0 || n < p + 1) {
      return [
        { name: '+di', values: plusDI },
        { name: '-di', values: minusDI },
        { name: 'adx', values: adx },
      ];
    }

    // Step 1: per-bar +DM, -DM, TR. Index 0 is undefined; start at 1.
    const pdm = new Float64Array(n);
    const mdm = new Float64Array(n);
    const tr = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const cur = buffer.candleAt(i)!;
      const prev = buffer.candleAt(i - 1)!;
      const upMove = cur.h - prev.h;
      const downMove = prev.l - cur.l;
      pdm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
      mdm[i] = downMove > upMove && downMove > 0 ? downMove : 0;
      const r1 = cur.h - cur.l;
      const r2 = Math.abs(cur.h - prev.c);
      const r3 = Math.abs(prev.c - cur.l);
      tr[i] = Math.max(r1, r2, r3);
    }

    // Step 2: Wilder-smoothed sums. First value at index `p` is the
    // simple sum of the first `p` raw values; thereafter the running
    // sum decays by 1/p each step and adds the new raw.
    let sumPdm = 0;
    let sumMdm = 0;
    let sumTr = 0;
    for (let i = 1; i <= p; i++) {
      sumPdm += pdm[i]!;
      sumMdm += mdm[i]!;
      sumTr += tr[i]!;
    }

    const dx = new Float64Array(n);
    const writeDIandDX = (i: number) => {
      const pd = sumTr === 0 ? 0 : (100 * sumPdm) / sumTr;
      const md = sumTr === 0 ? 0 : (100 * sumMdm) / sumTr;
      plusDI[i] = pd;
      minusDI[i] = md;
      const denom = pd + md;
      dx[i] = denom === 0 ? 0 : (100 * Math.abs(pd - md)) / denom;
    };
    writeDIandDX(p);

    for (let i = p + 1; i < n; i++) {
      sumPdm = sumPdm - sumPdm / p + pdm[i]!;
      sumMdm = sumMdm - sumMdm / p + mdm[i]!;
      sumTr = sumTr - sumTr / p + tr[i]!;
      writeDIandDX(i);
    }

    // Step 3: ADX is the Wilder smoothing of DX, again over `period`.
    // First ADX value is the simple mean of DX over indices p..2p-1.
    if (n < 2 * p) {
      return [
        { name: '+di', values: plusDI },
        { name: '-di', values: minusDI },
        { name: 'adx', values: adx },
      ];
    }
    let adxAcc = 0;
    for (let i = p; i < 2 * p; i++) adxAcc += dx[i]!;
    adx[2 * p - 1] = adxAcc / p;
    let prev = adx[2 * p - 1]!;
    for (let i = 2 * p; i < n; i++) {
      const next = (prev * (p - 1) + dx[i]!) / p;
      adx[i] = next;
      prev = next;
    }

    return [
      { name: '+di', values: plusDI },
      { name: '-di', values: minusDI },
      { name: 'adx', values: adx },
    ];
  }
}
