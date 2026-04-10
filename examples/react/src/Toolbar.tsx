import type { SymbolInfo, ResolutionInfo } from '@ohlcv-examples/shared';
import type { ThemeMode } from '@ohlcv/core';

export interface ToolbarProps {
  symbols: readonly SymbolInfo[];
  resolutions: readonly ResolutionInfo[];
  symbolId: string;
  resolutionId: string;
  theme: ThemeMode;
  live: boolean;
  status: string;
  onSymbolChange: (id: string) => void;
  onResolutionChange: (id: string) => void;
  onThemeToggle: () => void;
  onLiveToggle: () => void;
}

export function Toolbar(props: ToolbarProps) {
  return (
    <header className="toolbar">
      <label>Symbol</label>
      <select value={props.symbolId} onChange={(e) => props.onSymbolChange(e.target.value)}>
        {props.symbols.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>

      <label>Resolution</label>
      <select value={props.resolutionId} onChange={(e) => props.onResolutionChange(e.target.value)}>
        {props.resolutions.map((r) => (
          <option key={r.id} value={r.id}>
            {r.id}
          </option>
        ))}
      </select>

      <button onClick={props.onThemeToggle}>
        {props.theme === 'dark' ? '🌙 Dark' : '☀ Light'}
      </button>

      <button className={props.live ? 'active' : ''} onClick={props.onLiveToggle}>
        {props.live ? '■ Stop' : '▶ Live'}
      </button>

      <span className="spacer" />
      <span className="status">{props.status}</span>
    </header>
  );
}
