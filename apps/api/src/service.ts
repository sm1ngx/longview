import { randomUUID } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { and, eq } from 'drizzle-orm';
import {
  CurrencyGraph,
  ValuationEngine,
  calculateAllocation,
} from '@longview/core';
import type { AssetHolding, RateEdge } from '@longview/shared';
import {
  EcbFxProvider,
  LixingerFundProvider,
  OkxProvider,
} from '@longview/providers';
import { db, sqlite } from './db.js';
import {
  assets,
  cashHoldings,
  fundPositions,
  fxRates,
  fxSnapshots,
  assetSnapshots,
  portfolioSnapshots,
  providerConnections,
  providerSyncState,
  settings,
  targetAllocations,
} from './schema.js';

const now = () => new Date().toISOString();
const log = (event: string, detail?: string) =>
  console.info(
    JSON.stringify({ at: now(), event, ...(detail ? { detail } : {}) }),
  );
export const getSettings = () => db.select().from(settings).get()!;
db.insert(settings)
  .values({
    id: 'main',
    displayCurrency: 'CNY',
    autoSync: true,
    syncMinutes: 60,
    demoMode: false,
  })
  .onConflictDoNothing()
  .run();
for (const [id, source] of [
  ['okx', 'OKX'],
  ['fund', 'Lixinger / Manual'],
  ['fx', 'ECB'],
  ['stablecoin', 'OKX USDT-USD'],
] as const) {
  db.insert(providerConnections)
    .values({ id, connected: false, source })
    .onConflictDoNothing()
    .run();
  db.insert(providerSyncState)
    .values({ id, status: 'idle', source })
    .onConflictDoNothing()
    .run();
}

export function getAssets(): AssetHolding[] {
  return db
    .select()
    .from(assets)
    .all()
    .map((a) => ({
      ...a,
      assetType: a.assetType as AssetHolding['assetType'],
      currentValue:
        a.currentPrice === null
          ? null
          : new Decimal(a.quantity).mul(a.currentPrice).toString(),
    }));
}
export function getGraph(
  rateRows = db.select().from(fxRates).all(),
): CurrencyGraph {
  const graph = new CurrencyGraph();
  for (const r of rateRows)
    graph.add({
      ...r,
      asOf: r.asOf,
      stale:
        r.stale ||
        Date.now() - Date.parse(r.asOf) >
          (r.source === 'ECB' ? 96 : 24) * 3600_000,
    });
  return graph;
}
export function getPortfolio(currency = getSettings().displayCurrency) {
  const holdings = getAssets();
  if (!holdings.length)
    return {
      assets: [],
      totalUSD: null,
      totalDisplay: null,
      incomplete: false,
      currency,
      empty: true,
    };
  return {
    ...new ValuationEngine(getGraph()).portfolio(holdings, currency),
    currency,
    empty: false,
  };
}
function state(
  id: string,
  status: 'syncing' | 'success' | 'stale' | 'error',
  message: string | null = null,
) {
  const previous = db
    .select()
    .from(providerSyncState)
    .where(eq(providerSyncState.id, id))
    .get();
  db.update(providerSyncState)
    .set({
      status,
      lastAttempt: now(),
      lastSuccessfulSync:
        status === 'success' ? now() : (previous?.lastSuccessfulSync ?? null),
      errorMessage: message,
    })
    .where(eq(providerSyncState.id, id))
    .run();
  db.update(providerConnections)
    .set({
      connected:
        status === 'success' ||
        (status === 'stale' && !!previous?.lastSuccessfulSync),
    })
    .where(eq(providerConnections.id, id))
    .run();
  if (status === 'error' || status === 'stale')
    log('Provider Failure', `${id}: ${message}`);
  if (status === 'success' && previous?.status === 'error')
    log('Provider Recovery', id);
}
function saveRate(edge: RateEdge) {
  db.insert(fxRates)
    .values({
      pair: `${edge.from}-${edge.to}`,
      from: edge.from,
      to: edge.to,
      rate: edge.rate,
      asOf: edge.asOf,
      source: edge.source,
      estimated: !!edge.estimated,
      stale: !!edge.stale,
    })
    .onConflictDoUpdate({
      target: fxRates.pair,
      set: {
        rate: edge.rate,
        asOf: edge.asOf,
        source: edge.source,
        estimated: !!edge.estimated,
        stale: !!edge.stale,
      },
    })
    .run();
}
const okx = () =>
  new OkxProvider({
    apiKey: process.env.OKX_API_KEY ?? '',
    apiSecret: process.env.OKX_API_SECRET ?? '',
    passphrase: process.env.OKX_PASSPHRASE ?? '',
    region:
      process.env.OKX_REGION === 'EU' || process.env.OKX_REGION === 'US'
        ? process.env.OKX_REGION
        : 'GLOBAL',
  });
let syncing: Promise<void> | null = null;
let lastSyncRunAt = 0;
export const getLastSyncRunAt = () => lastSyncRunAt;
export async function syncAll(): Promise<void> {
  if (syncing) return syncing;
  syncing = performSync().finally(() => {
    syncing = null;
  });
  return syncing;
}
async function performSync() {
  lastSyncRunAt = Date.now();
  log('Sync Started');
  if (getSettings().demoMode) {
    log('Sync Completed', 'demo');
    return;
  }
  state('fx', 'syncing');
  try {
    for (const edge of await new EcbFxProvider().getRates('EUR'))
      saveRate(edge);
    state('fx', 'success');
  } catch {
    state('fx', 'stale', 'ECB 不可用，继续使用上次汇率');
  }
  state('stablecoin', 'syncing');
  try {
    const ticker = await okx().getTicker('USDT-USD');
    saveRate({
      from: 'USDT',
      to: 'USD',
      rate: ticker.price,
      asOf: ticker.asOf,
      source: 'OKX',
    });
    state('stablecoin', 'success');
  } catch {
    const old = db
      .select()
      .from(fxRates)
      .where(eq(fxRates.pair, 'USDT-USD'))
      .get();
    if (!old)
      saveRate({
        from: 'USDT',
        to: 'USD',
        rate: '1',
        asOf: now(),
        source: 'fallback',
        estimated: true,
        stale: true,
      });
    else
      db.update(fxRates)
        .set({ stale: true })
        .where(eq(fxRates.pair, 'USDT-USD'))
        .run();
    state('stablecoin', 'stale', 'USDT/USD 实时报价不可用，使用上次价格或估算');
  }
  if (
    process.env.OKX_API_KEY &&
    process.env.OKX_API_SECRET &&
    process.env.OKX_PASSPHRASE
  ) {
    state('okx', 'syncing');
    try {
      const provider = okx();
      const balances = await provider.getBalances();
      const grouped = new Map<string, Decimal>();
      for (const b of balances)
        grouped.set(
          b.currency,
          (grouped.get(b.currency) ?? new Decimal(0)).plus(b.quantity),
        );
      const updates: (typeof assets.$inferInsert)[] = [];
      for (const [symbol, quantity] of grouped) {
        const existing = db
          .select()
          .from(assets)
          .where(eq(assets.id, `okx:${symbol}`))
          .get();
        let currentPrice = existing?.currentPrice ?? null;
        let quote = existing?.priceCurrency ?? 'USD';
        let stale = false;
        if (symbol === 'USDT' || symbol === 'USD') {
          currentPrice = '1';
          quote = symbol;
        } else {
          try {
            const ticker = await provider.getAssetPrice(symbol);
            currentPrice = ticker.price;
            quote = ticker.quote;
          } catch {
            stale = true;
            log('Provider Failure', `price unavailable: ${symbol}`);
          }
        }
        updates.push({
          id: `okx:${symbol}`,
          symbol,
          name: symbol,
          assetType: 'CRYPTO',
          provider: 'OKX',
          nativeCurrency: symbol,
          quantity: quantity.toString(),
          currentPrice,
          priceCurrency: quote,
          targetAllocation: existing?.targetAllocation ?? '0',
          category: 'Crypto',
          groupId: null,
          enabled: true,
          lastUpdatedAt: stale ? existing?.lastUpdatedAt ?? null : now(),
          source: 'OKX',
          priceEstimated: false,
          stale,
        });
      }
      sqlite.transaction(() => {
        for (const a of db
          .select()
          .from(assets)
          .where(eq(assets.provider, 'OKX'))
          .all())
          if (!grouped.has(a.symbol))
            db.update(assets)
              .set({ quantity: '0', lastUpdatedAt: now() })
              .where(eq(assets.id, a.id))
              .run();
        for (const item of updates)
          db.insert(assets)
            .values(item)
            .onConflictDoUpdate({
              target: assets.id,
              set: {
                quantity: item.quantity,
                currentPrice: item.currentPrice,
                priceCurrency: item.priceCurrency,
                lastUpdatedAt: item.lastUpdatedAt,
                stale: item.stale,
              },
            })
            .run();
      })();
      state(
        'okx',
        updates.some((a) => a.stale) ? 'stale' : 'success',
        updates.some((a) => a.stale) ? '部分币种价格沿用上次数据' : null,
      );
    } catch (error) {
      state(
        'okx',
        'error',
        error instanceof Error ? error.message : 'OKX 同步失败',
      );
    }
  }
  const fundRows = db.select().from(fundPositions).all();
  if (fundRows.length) {
    state('fund', 'syncing');
    let failures = 0;
    for (const fund of fundRows) {
      if (!process.env.LIXINGER_TOKEN) {
        failures++;
        db.update(assets)
          .set({ stale: true })
          .where(eq(assets.id, `fund:${fund.id}`))
          .run();
        continue;
      }
      try {
        const nav = await new LixingerFundProvider(
          process.env.LIXINGER_TOKEN,
        ).getLatestNav(fund.fundCode);
        const marketValue = new Decimal(fund.shares).mul(nav.nav).toString();
        db.update(fundPositions)
          .set({
            latestNav: nav.nav,
            navDate: nav.date,
            marketValue,
            provider: nav.source,
            lastUpdatedAt: now(),
          })
          .where(eq(fundPositions.id, fund.id))
          .run();
        db.update(assets)
          .set({
            currentPrice: nav.nav,
            quantity: fund.shares,
            lastUpdatedAt: now(),
            stale: Date.now() - Date.parse(nav.date) > 7 * 86400_000,
          })
          .where(eq(assets.id, `fund:${fund.id}`))
          .run();
      } catch {
        failures++;
        db.update(assets)
          .set({ stale: true })
          .where(eq(assets.id, `fund:${fund.id}`))
          .run();
      }
    }
    state(
      'fund',
      failures ? 'stale' : 'success',
      failures ? `${failures} 只基金净值未更新，沿用上次净值` : null,
    );
  }
  createSnapshot(false);
  log('Sync Completed');
}
export function createSnapshot(manual: boolean) {
  const portfolio = getPortfolio('USD');
  if (!portfolio.totalUSD || portfolio.incomplete) return null;
  const dayUtc = now().slice(0, 10);
  if (
    !manual &&
    db
      .select()
      .from(portfolioSnapshots)
      .where(
        and(
          eq(portfolioSnapshots.dayUtc, dayUtc),
          eq(portfolioSnapshots.manual, false),
        ),
      )
      .get()
  )
    return null;
  const id = randomUUID();
  sqlite.transaction(() => {
    db.insert(portfolioSnapshots)
      .values({
        id,
        timestamp: now(),
        dayUtc,
        canonicalCurrency: 'USD',
        totalValueUSD: portfolio.totalUSD!,
        manual,
      })
      .run();
    for (const asset of portfolio.assets)
      if (asset.valueUSD !== null)
        db.insert(assetSnapshots)
          .values({
            id: randomUUID(),
            snapshotId: id,
            assetId: asset.id,
            quantity: asset.quantity,
            nativePrice: asset.currentPrice,
            priceCurrency: asset.priceCurrency,
            valueUSD: asset.valueUSD,
            category: asset.category,
            providerTimestamp: asset.lastUpdatedAt,
          })
          .run();
    for (const rate of db.select().from(fxRates).all())
      db.insert(fxSnapshots)
        .values({
          id: randomUUID(),
          snapshotId: id,
          from: rate.from,
          to: rate.to,
          rate: rate.rate,
          asOf: rate.asOf,
          estimated: rate.estimated,
        })
        .run();
  })();
  return id;
}
export function getHistory(currency: string) {
  return db
    .select()
    .from(portfolioSnapshots)
    .all()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((snapshot) => {
      const rates = db
        .select()
        .from(fxSnapshots)
        .where(eq(fxSnapshots.snapshotId, snapshot.id))
        .all();
      const graph = new CurrencyGraph();
      for (const rate of rates) graph.add({ ...rate, source: 'Snapshot' });
      let displayValue: string | null = null;
      try {
        displayValue = graph
          .convert(snapshot.totalValueUSD, 'USD', currency)
          .amount.toString();
      } catch {
        /* historical FX absent */
      }
      const byCategory: Record<string, string> = {};
      for (const row of db
        .select()
        .from(assetSnapshots)
        .where(eq(assetSnapshots.snapshotId, snapshot.id))
        .all())
        byCategory[row.category] = new Decimal(byCategory[row.category] ?? 0)
          .plus(row.valueUSD)
          .toString();
      return { ...snapshot, displayValue, currency, byCategoryUSD: byCategory };
    });
}
export function saveFund(input: {
  id?: string;
  fundCode: string;
  fundName: string;
  fundType?: string;
  shares: string;
  costBasis?: string | null;
  latestNav?: string | null;
}) {
  if (
    !/^\d{6}$/.test(input.fundCode) ||
    !input.fundName.trim() ||
    !new Decimal(input.shares).gte(0)
  )
    throw new Error('Invalid fund position');
  const id = input.id ?? randomUUID();
  const previous = db
    .select()
    .from(fundPositions)
    .where(eq(fundPositions.id, id))
    .get();
  if (previous && previous.fundCode !== input.fundCode)
    throw new Error('Fund code cannot be changed; add a new position');
  const latestNav = input.latestNav ?? previous?.latestNav ?? null;
  if (latestNav !== null && !new Decimal(latestNav).gt(0))
    throw new Error('NAV must be positive');
  const marketValue =
    latestNav === null
      ? null
      : new Decimal(input.shares).mul(latestNav).toString();
  const manualNavChanged =
    !!input.latestNav && input.latestNav !== previous?.latestNav;
  db.insert(fundPositions)
    .values({
      id,
      fundCode: input.fundCode,
      fundName: input.fundName,
      fundType: input.fundType ?? 'FUND',
      shares: input.shares,
      costBasis: input.costBasis ?? null,
      latestNav,
      marketValue,
      currency: 'CNY',
      provider: manualNavChanged ? 'Manual' : (previous?.provider ?? 'Manual'),
      navDate: manualNavChanged ? now() : (previous?.navDate ?? null),
      lastUpdatedAt: now(),
    })
    .onConflictDoUpdate({
      target: fundPositions.id,
      set: {
        fundCode: input.fundCode,
        fundName: input.fundName,
        fundType: input.fundType ?? 'FUND',
        shares: input.shares,
        costBasis: input.costBasis ?? null,
        latestNav,
        marketValue,
        provider: manualNavChanged
          ? 'Manual'
          : (previous?.provider ?? 'Manual'),
        navDate: manualNavChanged ? now() : (previous?.navDate ?? null),
        lastUpdatedAt: now(),
      },
    })
    .run();
  db.insert(assets)
    .values({
      id: `fund:${id}`,
      symbol: input.fundCode,
      name: input.fundName,
      assetType: 'FUND',
      provider: 'Fund NAV',
      nativeCurrency: 'CNY',
      quantity: input.shares,
      currentPrice: latestNav,
      priceCurrency: 'CNY',
      targetAllocation: '0',
      category: '基金',
      lastUpdatedAt: now(),
      source: 'Fund',
      stale: !latestNav,
    })
    .onConflictDoUpdate({
      target: assets.id,
      set: {
        symbol: input.fundCode,
        name: input.fundName,
        quantity: input.shares,
        currentPrice: latestNav,
        stale: !latestNav,
      },
    })
    .run();
  return id;
}
export function saveCash(input: {
  id?: string;
  currency: string;
  amount: string;
  name?: string;
}) {
  if (!/^[A-Z]{3,5}$/.test(input.currency) || !new Decimal(input.amount).gte(0))
    throw new Error('Invalid cash holding');
  const id = input.id ?? randomUUID();
  const name = input.name || `${input.currency} 现金`;
  db.insert(cashHoldings)
    .values({ id, currency: input.currency, amount: input.amount, name })
    .onConflictDoUpdate({
      target: cashHoldings.id,
      set: { amount: input.amount, name },
    })
    .run();
  db.insert(assets)
    .values({
      id: `cash:${id}`,
      symbol: input.currency,
      name,
      assetType: 'CASH',
      provider: 'Manual',
      nativeCurrency: input.currency,
      quantity: input.amount,
      currentPrice: '1',
      priceCurrency: input.currency,
      targetAllocation: '0',
      category: '现金',
      lastUpdatedAt: now(),
      source: 'Manual',
    })
    .onConflictDoUpdate({
      target: assets.id,
      set: {
        symbol: input.currency,
        nativeCurrency: input.currency,
        quantity: input.amount,
        priceCurrency: input.currency,
        name,
        lastUpdatedAt: now(),
      },
    })
    .run();
  return id;
}
export function saveManual(input: {
  id?: string;
  name: string;
  category: string;
  value: string;
  currency: string;
}) {
  if (
    !input.name.trim() ||
    !input.category.trim() ||
    !/^[A-Z]{3,5}$/.test(input.currency) ||
    !new Decimal(input.value).gte(0)
  )
    throw new Error('Invalid manual asset');
  const id = input.id ?? randomUUID();
  db.insert(assets)
    .values({
      id: `manual:${id}`,
      symbol: input.name,
      name: input.name,
      assetType: 'OTHER',
      provider: 'Manual',
      nativeCurrency: input.currency,
      quantity: '1',
      currentPrice: input.value,
      priceCurrency: input.currency,
      targetAllocation: '0',
      category: input.category,
      lastUpdatedAt: now(),
      source: 'Manual',
    })
    .onConflictDoUpdate({
      target: assets.id,
      set: {
        name: input.name,
        category: input.category,
        currentPrice: input.value,
        priceCurrency: input.currency,
        lastUpdatedAt: now(),
      },
    })
    .run();
  return id;
}
export function setTargets(rows: { assetId: string; percent: string }[]) {
  const holdings = getAssets().filter((a) => a.enabled);
  if (
    rows.length !== holdings.length ||
    new Set(rows.map((r) => r.assetId)).size !== rows.length ||
    rows.some((r) => !holdings.some((a) => a.id === r.assetId))
  )
    throw new Error('每个启用资产都需要目标比例');
  const total = rows.reduce(
    (sum, row) => sum.plus(row.percent),
    new Decimal(0),
  );
  if (!total.eq(100) || rows.some((r) => new Decimal(r.percent).lt(0)))
    throw new Error(`目标比例共 ${total.toString()}%，必须为 100%`);
  sqlite.transaction(() => {
    db.delete(targetAllocations).run();
    for (const row of rows) {
      db.update(assets)
        .set({ targetAllocation: row.percent })
        .where(eq(assets.id, row.assetId))
        .run();
      db.insert(targetAllocations)
        .values({ assetId: row.assetId, percent: row.percent })
        .onConflictDoUpdate({
          target: targetAllocations.assetId,
          set: { percent: row.percent },
        })
        .run();
    }
  })();
}
export function allocation(contribution: string, currency: string) {
  const portfolio = getPortfolio('USD');
  if (portfolio.empty || portfolio.incomplete)
    throw new Error('资产估值不完整，无法计算分配');
  const graph = getGraph();
  return calculateAllocation(
    portfolio.assets.map((a) => ({
      id: a.id,
      name: a.name,
      currentValue: graph
        .convert(a.valueUSD!, 'USD', currency)
        .amount.toString(),
      targetPercent: a.targetAllocation,
    })),
    contribution,
    currency,
  );
}
export function demoSeed() {
  if (getAssets().length) throw new Error('仅空白资产库可以加载演示数据');
  const stamp = now();
  for (const [from, to, rate] of [
    ['EUR', 'USD', '1.1'],
    ['EUR', 'CNY', '7.8'],
    ['EUR', 'JPY', '170'],
    ['EUR', 'HKD', '8.5'],
    ['EUR', 'GBP', '0.85'],
    ['EUR', 'SGD', '1.46'],
    ['EUR', 'AUD', '1.65'],
    ['EUR', 'CAD', '1.56'],
    ['USDT', 'USD', '0.999'],
  ] as const)
    saveRate({ from, to, rate, asOf: stamp, source: 'Demo', estimated: true });
  for (const a of [
    {
      id: 'demo:BTC',
      symbol: 'BTC',
      name: 'Bitcoin · Demo',
      assetType: 'CRYPTO',
      quantity: '0.015',
      currentPrice: '83000',
      priceCurrency: 'USDT',
      category: 'Crypto',
      targetAllocation: '25',
    },
    {
      id: 'demo:ETH',
      symbol: 'ETH',
      name: 'Ethereum · Demo',
      assetType: 'CRYPTO',
      quantity: '0.4',
      currentPrice: '3000',
      priceCurrency: 'USDT',
      category: 'Crypto',
      targetAllocation: '10',
    },
    {
      id: 'demo:USDT',
      symbol: 'USDT',
      name: 'USDT · Demo',
      assetType: 'CRYPTO',
      quantity: '100',
      currentPrice: '1',
      priceCurrency: 'USDT',
      category: 'Crypto',
      targetAllocation: '5',
    },
    {
      id: 'demo:FUND',
      symbol: '000001',
      name: '指数基金 · Demo',
      assetType: 'FUND',
      quantity: '3000',
      currentPrice: '1.25',
      priceCurrency: 'CNY',
      category: '基金',
      targetAllocation: '50',
    },
    {
      id: 'demo:CASH',
      symbol: 'CNY',
      name: '人民币现金 · Demo',
      assetType: 'CASH',
      quantity: '600',
      currentPrice: '1',
      priceCurrency: 'CNY',
      category: '现金',
      targetAllocation: '10',
    },
  ] as const)
    db.insert(assets)
      .values({
        ...a,
        provider: 'Demo',
        nativeCurrency: a.symbol,
        enabled: true,
        lastUpdatedAt: stamp,
        source: 'Demo',
        priceEstimated: true,
      })
      .run();
  db.update(settings)
    .set({ demoMode: true })
    .where(eq(settings.id, 'main'))
    .run();
  createSnapshot(false);
}
