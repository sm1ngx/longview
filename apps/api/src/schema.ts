import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  symbol: text('symbol').notNull(),
  name: text('name').notNull(),
  assetType: text('asset_type').notNull(),
  provider: text('provider').notNull(),
  nativeCurrency: text('native_currency').notNull(),
  quantity: text('quantity').notNull(),
  currentPrice: text('current_price'),
  priceCurrency: text('price_currency').notNull(),
  targetAllocation: text('target_allocation').notNull().default('0'),
  category: text('category').notNull(),
  groupId: text('group_id'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastUpdatedAt: text('last_updated_at'),
  source: text('source').notNull(),
  priceEstimated: integer('price_estimated', { mode: 'boolean' })
    .notNull()
    .default(false),
  stale: integer('stale', { mode: 'boolean' }).notNull().default(false),
});
export const fundPositions = sqliteTable('fund_positions', {
  id: text('id').primaryKey(),
  fundCode: text('fund_code').notNull(),
  fundName: text('fund_name').notNull(),
  fundType: text('fund_type').notNull(),
  shares: text('shares').notNull(),
  costBasis: text('cost_basis'),
  latestNav: text('latest_nav'),
  marketValue: text('market_value'),
  currency: text('currency').notNull(),
  provider: text('provider').notNull(),
  navDate: text('nav_date'),
  lastUpdatedAt: text('last_updated_at'),
});
export const cashHoldings = sqliteTable('cash_holdings', {
  id: text('id').primaryKey(),
  currency: text('currency').notNull(),
  amount: text('amount').notNull(),
  name: text('name').notNull(),
});
export const providerConnections = sqliteTable('provider_connections', {
  id: text('id').primaryKey(),
  connected: integer('connected', { mode: 'boolean' }).notNull().default(false),
  source: text('source').notNull(),
});
export const providerSyncState = sqliteTable('provider_sync_state', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  lastSuccessfulSync: text('last_successful_sync'),
  lastAttempt: text('last_attempt'),
  errorMessage: text('error_message'),
  source: text('source').notNull(),
});
export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  displayCurrency: text('display_currency').notNull().default('CNY'),
  autoSync: integer('auto_sync', { mode: 'boolean' }).notNull().default(true),
  syncMinutes: integer('sync_minutes').notNull().default(60),
  demoMode: integer('demo_mode', { mode: 'boolean' }).notNull().default(false),
});
export const targetAllocations = sqliteTable('target_allocations', {
  assetId: text('asset_id').primaryKey(),
  percent: text('percent').notNull(),
  groupId: text('group_id'),
});
export const fxRates = sqliteTable('fx_rates', {
  pair: text('pair').primaryKey(),
  from: text('from_currency').notNull(),
  to: text('to_currency').notNull(),
  rate: text('rate').notNull(),
  asOf: text('as_of').notNull(),
  source: text('source').notNull(),
  estimated: integer('estimated', { mode: 'boolean' }).notNull().default(false),
  stale: integer('stale', { mode: 'boolean' }).notNull().default(false),
});
export const portfolioSnapshots = sqliteTable('portfolio_snapshots', {
  id: text('id').primaryKey(),
  timestamp: text('timestamp').notNull(),
  dayUtc: text('day_utc').notNull(),
  canonicalCurrency: text('canonical_currency').notNull(),
  totalValueUSD: text('total_value_usd').notNull(),
  manual: integer('manual', { mode: 'boolean' }).notNull().default(false),
});
export const assetSnapshots = sqliteTable('asset_snapshots', {
  id: text('id').primaryKey(),
  snapshotId: text('snapshot_id').notNull(),
  assetId: text('asset_id').notNull(),
  quantity: text('quantity').notNull(),
  nativePrice: text('native_price'),
  priceCurrency: text('price_currency').notNull(),
  valueUSD: text('value_usd').notNull(),
  category: text('category').notNull(),
  providerTimestamp: text('provider_timestamp'),
});
export const fxSnapshots = sqliteTable('fx_snapshots', {
  id: text('id').primaryKey(),
  snapshotId: text('snapshot_id').notNull(),
  from: text('from_currency').notNull(),
  to: text('to_currency').notNull(),
  rate: text('rate').notNull(),
  asOf: text('as_of').notNull(),
  estimated: integer('estimated', { mode: 'boolean' }).notNull().default(false),
});
