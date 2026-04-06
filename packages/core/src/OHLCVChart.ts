import type { Candle, ChartConfig, ThemeColors, ThemeMode } from './types';
import { resolveTheme } from './utils';
import { CandleBuffer } from './data/CandleBuffer';
import { CandleMerger } from './data/CandleMerger';
import { DataFeed } from './data/DataFeed';
import { ChartEngine } from './rendering/ChartEngine';
import { Viewport } from './interaction/Viewport';
import { PanZoomController } from './interaction/PanZoomController';
import { CrosshairController } from './interaction/CrosshairController';

export class OHLCVChart {
  private _buffer: CandleBuffer;
  private _merger: CandleMerger;
  private _dataFeed: DataFeed;
  private _engine: ChartEngine;
  private _panZoom: PanZoomController;
  private _crosshair: CrosshairController;
  private _config: ChartConfig;
  private _clickHandler: ((e: MouseEvent) => void) | null = null;

  constructor(config: ChartConfig) {
    this._config = config;
    const theme = resolveTheme(config.theme);

    // Data layer
    this._buffer = new CandleBuffer();
    this._merger = new CandleMerger(this._buffer);
    this._dataFeed = new DataFeed(this._buffer, this._merger, config.transport ?? null);

    // Rendering
    this._engine = new ChartEngine(config.container, theme);
    this._engine.setBuffer(this._buffer);
    this._engine.setSymbol(config.symbol);
    this._engine.setResolution(config.resolution);
    if (config.priceFormat) this._engine.setPriceFormat(config.priceFormat);
    if (config.volumeFormat) this._engine.setVolumeFormat(config.volumeFormat);
    config.container.style.backgroundColor = theme.background;

    // Merger triggers render
    this._merger.onUpdate(() => {
      if (this._engine.viewport.isAtEnd() || this._buffer.length <= this._engine.viewport.visibleCount) {
        this._engine.viewport.scrollToEnd(this._buffer.length);
      }
      this._engine.requestRender();
    });

    // Interaction
    this._panZoom = new PanZoomController(this._engine.topCanvas, this._engine.viewport, {
      onViewportChange: () => {
        this._engine.requestRender();
        if (config.onVisibleRangeChange) {
          const vp = this._engine.viewport;
          const startIdx = Math.max(0, Math.floor(vp.startIndex));
          const endIdx = Math.min(this._buffer.length - 1, Math.ceil(vp.startIndex + vp.visibleCount));
          const startCandle = this._buffer.candleAt(startIdx);
          const endCandle = this._buffer.candleAt(endIdx);
          if (startCandle && endCandle) {
            config.onVisibleRangeChange(startCandle.t, endCandle.t);
          }
        }
      },
      onPanToStart: () => {
        this._dataFeed.loadMoreHistory();
      },
    });

    this._crosshair = new CrosshairController(this._engine, this._buffer, config.resolution);

    // Click handler for onCandleClick
    if (config.onCandleClick) {
      this._clickHandler = (e: MouseEvent) => {
        const rect = this._engine.topCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const layout = this._engine.layout;
        if (x < layout.chartLeft || x > layout.chartRight || y < layout.chartTop || y > layout.chartBottom) return;

        const index = this._engine.viewport.xToIndex(x);
        const candle = this._buffer.candleAt(index);
        if (candle) {
          config.onCandleClick!(candle, index);
        }
      };
      this._engine.topCanvas.addEventListener('click', this._clickHandler);
    }

    // Initial connect if transport is provided
    if (config.transport) {
      this._dataFeed.connect({ symbol: config.symbol, resolution: config.resolution });
    }
  }

  /** Set data directly (without transport) */
  setData(candles: Candle[]): void {
    this._buffer.clear();
    this._merger.loadHistory(candles);
    this._engine.viewport.scrollToEnd(this._buffer.length);
    this._engine.requestRender();
  }

  /** Update the last (forming) candle */
  updateLastCandle(candle: Candle): void {
    this._merger.mergeRealtime([candle]);
  }

  /** Switch to a different symbol/resolution */
  async switchSymbol(symbol: string, resolution: string): Promise<void> {
    this._config.symbol = symbol;
    this._config.resolution = resolution;
    this._engine.setSymbol(symbol);
    this._engine.setResolution(resolution);
    this._crosshair.setResolution(resolution);
    await this._dataFeed.connect({ symbol, resolution });
  }

  /** Change the theme at runtime */
  setTheme(theme: ThemeMode | ThemeColors): void {
    const resolved = resolveTheme(theme);
    this._engine.setTheme(resolved);
  }

  /** Get the underlying buffer */
  getBuffer(): CandleBuffer {
    return this._buffer;
  }

  /** Get the viewport */
  getViewport(): Viewport {
    return this._engine.viewport;
  }

  /** Force a render */
  render(): void {
    this._engine.requestRender();
  }

  /** Clean up all resources */
  destroy(): void {
    if (this._clickHandler) {
      this._engine.topCanvas.removeEventListener('click', this._clickHandler);
    }
    this._crosshair.destroy();
    this._panZoom.destroy();
    this._engine.destroy();
    this._dataFeed.destroy();
  }
}
