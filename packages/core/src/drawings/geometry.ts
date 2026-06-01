/**
 * Shortest distance from point (px, py) to the line segment a→b, all in
 * screen-space pixels. Used by drawing hit-testing for selection.
 */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Best-effort alpha overlay for a CSS color string. Handles `#rrggbb`,
 * `#rgb` and `rgb(...)`/`rgba(...)`; anything else passes through
 * unchanged so theme authors can supply pre-mixed colors if needed.
 *
 * Shared by the drawing classes (channels, pitchfork, measure box) so
 * each fill doesn't re-implement the parser.
 */
export function colorWithAlpha(color: string, alpha: number): string {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    const hex =
      color.length === 4
        ? color
            .slice(1)
            .split('')
            .map((c) => c + c)
            .join('')
        : color.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const rgbaMatch = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbaMatch) {
    return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${alpha})`;
  }
  return color;
}

/**
 * Ordinary least-squares fit of `y = slope·x + intercept` over the
 * samples `ys[i]` at abscissa `x0 + i`. Returns the fitted line plus the
 * sample standard deviation of the residuals (population σ, matching the
 * convention used for regression-channel bands). When fewer than two
 * finite samples are present the slope is zero and σ is zero.
 */
export interface LinearFit {
  slope: number;
  intercept: number;
  sigma: number;
  /** Abscissa of the first sample — the fit is expressed relative to it. */
  x0: number;
}

export function linearRegression(ys: readonly number[], x0: number): LinearFit {
  const n = ys.length;
  if (n === 0) return { slope: 0, intercept: 0, sigma: 0, x0 };
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const y = ys[i]!;
    if (!Number.isFinite(y)) continue;
    sx += i;
    sy += y;
    sxx += i * i;
    sxy += i * y;
    count++;
  }
  if (count < 2) {
    // Flat line at the mean (or the single sample) — no meaningful slope.
    return { slope: 0, intercept: count === 1 ? sy : 0, sigma: 0, x0 };
  }
  const denom = count * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (count * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / count;
  // Population σ of residuals from the fitted line.
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const y = ys[i]!;
    if (!Number.isFinite(y)) continue;
    const resid = y - (slope * i + intercept);
    ss += resid * resid;
  }
  const sigma = Math.sqrt(ss / count);
  return { slope, intercept, sigma, x0 };
}
