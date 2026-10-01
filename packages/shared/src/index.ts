export const DISPLAY_CURRENCIES = [
  'CNY',
  'USDT',
  'USD',
  'EUR',
  'HKD',
  'JPY',
  'GBP',
  'SGD',
  'AUD',
  'CAD',
] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];
export type AssetType =
  'CRYPTO' | 'FUND' | 'ETF' | 'STOCK' | 'BOND' | 'CASH' | 'OTHER';
export type SyncStatus = 'idle' | 'syncing' | 'success' | 'stale' | 'error';
export interface AssetHolding {
  id: string;
  symbol: string;
  name: string;
  assetType: AssetType;
  provider: string;
  nativeCurrency: string;
  quantity: string;
  currentPrice: string | null;
  priceCurrency: string;
  currentValue?: string | null;
  targetAllocation: string;
  category: string;
  groupId?: string | null;
  enabled: boolean;
  lastUpdatedAt: string | null;
  source: string;
  priceEstimated?: boolean;
  stale?: boolean;
}
export interface ProviderState {
  id: string;
  status: SyncStatus;
  lastSuccessfulSync: string | null;
  lastAttempt: string | null;
  errorMessage: string | null;
  source: string;
}
export interface RateEdge {
  from: string;
  to: string;
  rate: string;
  asOf: string;
  source: string;
  estimated?: boolean;
  stale?: boolean;
}
export interface FundPosition {
  id: string;
  fundCode: string;
  fundName: string;
  fundType: string;
  shares: string;
  costBasis: string | null;
  latestNav: string | null;
  marketValue: string | null;
  currency: string;
  provider: string;
  navDate: string | null;
  lastUpdatedAt: string | null;
}
