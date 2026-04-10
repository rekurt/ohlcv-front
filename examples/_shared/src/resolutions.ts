export interface ResolutionInfo {
  id: string;
  seconds: number;
}

export const RESOLUTIONS: readonly ResolutionInfo[] = [
  { id: '1m', seconds: 60 },
  { id: '5m', seconds: 300 },
  { id: '15m', seconds: 900 },
  { id: '1H', seconds: 3600 },
  { id: '4H', seconds: 14400 },
  { id: '1D', seconds: 86400 },
];
