import type { ThemeColors, ChartLayout, CandleView } from '../types';
import type { Viewport } from '../interaction/Viewport';

export class VolumeRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    view: CandleView,
    theme: ThemeColors,
  ): void {
    if (viewport.volumeMax === 0) return;

    const bodyWidth = viewport.candleWidth;

    for (let i = 0; i < view.length; i++) {
      const bufferIndex = view.offset + i;
      const x = viewport.indexToX(bufferIndex);
      const halfBody = bodyWidth / 2;

      if (x + halfBody < layout.chartLeft || x - halfBody > layout.chartRight) continue;

      // `i < view.length` guarantees TypedArray access is defined.
      const open = view.open[i]!;
      const close = view.close[i]!;
      const bull = close >= open;

      ctx.fillStyle = bull ? theme.bullVolume : theme.bearVolume;

      const vol = view.volume[i]!;
      const barTop = viewport.volumeToY(vol);
      const barHeight = layout.volumeBottom - barTop;

      ctx.fillRect(Math.round(x - halfBody), barTop, bodyWidth, barHeight);
    }
  }
}
