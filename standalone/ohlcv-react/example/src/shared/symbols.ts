export interface SymbolInfo {
  id: string;
  label: string;
  seed: number;
  basePrice: number;
}

export const SYMBOLS: readonly SymbolInfo[] = [
  { id: 'BTCUSDT', label: 'BTC/USDT', seed: 1, basePrice: 42000 },
  { id: 'ETHUSDT', label: 'ETH/USDT', seed: 2, basePrice: 2500 },
  { id: 'SOLUSDT', label: 'SOL/USDT', seed: 3, basePrice: 140 },
];
