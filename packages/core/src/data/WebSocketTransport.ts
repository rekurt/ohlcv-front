import type { Candle, DataFeedConfig, DataTransport, HistoryRequest } from '../types';

/**
 * Abstract WebSocket transport. Implement the abstract methods for your
 * specific WS library (Centrifugo, Socket.IO, native WebSocket, etc.)
 */
export abstract class WebSocketTransport implements DataTransport {
  protected _onUpdate: ((candles: Candle[]) => void) | null = null;
  protected _config: DataFeedConfig | null = null;

  /** Connect to the WebSocket server */
  abstract connect(url: string): void;

  /** Subscribe to a specific channel/topic */
  abstract subscribeChannel(channel: string, handler: (data: unknown) => void): void;

  /** Unsubscribe from a channel */
  abstract unsubscribeChannel(channel: string): void;

  /** Fetch historical data (typically via HTTP, not WS) */
  abstract fetchHistory(req: HistoryRequest): Promise<Candle[]>;

  /** Parse incoming WS data into Candle array */
  protected parseCandles(data: unknown): Candle[] {
    // Default: assume data is Candle[] or single Candle
    if (Array.isArray(data)) return data as Candle[];
    if (data && typeof data === 'object' && 't' in data) return [data as Candle];
    return [];
  }

  subscribe(config: DataFeedConfig, onUpdate: (candles: Candle[]) => void): void {
    this._config = config;
    this._onUpdate = onUpdate;
    const channel = `${config.symbol}:${config.resolution}`;
    this.subscribeChannel(channel, (data: unknown) => {
      const candles = this.parseCandles(data);
      if (candles.length > 0) {
        this._onUpdate?.(candles);
      }
    });
  }

  unsubscribe(): void {
    if (this._config) {
      const channel = `${this._config.symbol}:${this._config.resolution}`;
      this.unsubscribeChannel(channel);
    }
    this._onUpdate = null;
    this._config = null;
  }

  destroy(): void {
    this.unsubscribe();
  }
}
