import './env.js';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema.js';

const path = resolve(process.env.DATABASE_URL || './data/longview.db');
mkdirSync(dirname(path), { recursive: true });
export const sqlite: Database.Database = new Database(path);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.exec(`
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, symbol TEXT NOT NULL, name TEXT NOT NULL, asset_type TEXT NOT NULL, provider TEXT NOT NULL, native_currency TEXT NOT NULL, quantity TEXT NOT NULL, current_price TEXT, price_currency TEXT NOT NULL, target_allocation TEXT NOT NULL DEFAULT '0', category TEXT NOT NULL, group_id TEXT, enabled INTEGER NOT NULL DEFAULT 1, last_updated_at TEXT, source TEXT NOT NULL, price_estimated INTEGER NOT NULL DEFAULT 0, stale INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS fund_positions (id TEXT PRIMARY KEY, fund_code TEXT NOT NULL, fund_name TEXT NOT NULL, fund_type TEXT NOT NULL, shares TEXT NOT NULL, cost_basis TEXT, latest_nav TEXT, market_value TEXT, currency TEXT NOT NULL, provider TEXT NOT NULL, nav_date TEXT, last_updated_at TEXT);
CREATE TABLE IF NOT EXISTS cash_holdings (id TEXT PRIMARY KEY, currency TEXT NOT NULL, amount TEXT NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS provider_connections (id TEXT PRIMARY KEY, connected INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS provider_sync_state (id TEXT PRIMARY KEY, status TEXT NOT NULL, last_successful_sync TEXT, last_attempt TEXT, error_message TEXT, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, display_currency TEXT NOT NULL DEFAULT 'CNY', auto_sync INTEGER NOT NULL DEFAULT 1, sync_minutes INTEGER NOT NULL DEFAULT 60, demo_mode INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS target_allocations (asset_id TEXT PRIMARY KEY, percent TEXT NOT NULL, group_id TEXT);
CREATE TABLE IF NOT EXISTS fx_rates (pair TEXT PRIMARY KEY, from_currency TEXT NOT NULL, to_currency TEXT NOT NULL, rate TEXT NOT NULL, as_of TEXT NOT NULL, source TEXT NOT NULL, estimated INTEGER NOT NULL DEFAULT 0, stale INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS portfolio_snapshots (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, day_utc TEXT NOT NULL, canonical_currency TEXT NOT NULL, total_value_usd TEXT NOT NULL, manual INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS asset_snapshots (id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES portfolio_snapshots(id) ON DELETE CASCADE, asset_id TEXT NOT NULL, quantity TEXT NOT NULL, native_price TEXT, price_currency TEXT NOT NULL, value_usd TEXT NOT NULL, category TEXT NOT NULL, provider_timestamp TEXT);
CREATE TABLE IF NOT EXISTS fx_snapshots (id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES portfolio_snapshots(id) ON DELETE CASCADE, from_currency TEXT NOT NULL, to_currency TEXT NOT NULL, rate TEXT NOT NULL, as_of TEXT NOT NULL, estimated INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS daily_snapshot ON portfolio_snapshots(day_utc) WHERE manual = 0;
`);
export const db = drizzle(sqlite, { schema });
