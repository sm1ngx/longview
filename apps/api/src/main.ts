import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { DISPLAY_CURRENCIES } from '@longview/shared';
import { db } from './db.js';
import {
  assets,
  assetSnapshots,
  cashHoldings,
  fundPositions,
  fxRates,
  fxSnapshots,
  portfolioSnapshots,
  providerConnections,
  providerSyncState,
  settings,
  targetAllocations,
} from './schema.js';
import {
  allocation,
  createSnapshot,
  demoSeed,
  getAssets,
  getHistory,
  getLastSyncRunAt,
  getPortfolio,
  getSettings,
  saveCash,
  saveFund,
  saveManual,
  setTargets,
  syncAll,
} from './service.js';

const app = Fastify({
  logger: {
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.apiKey',
      'req.body.secret',
      'req.body.passphrase',
      'req.body.token',
    ],
  },
  bodyLimit: 128 * 1024,
});
type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid JSON body');
  return value as Obj;
};
const str = (value: unknown, key: string): string => {
  if (typeof value !== 'string') throw new Error(`${key} must be a string`);
  return value;
};
const configured = () =>
  !!(
    process.env.OKX_API_KEY &&
    process.env.OKX_API_SECRET &&
    process.env.OKX_PASSPHRASE
  );
app.setErrorHandler((error, _request, reply) => {
  const message = error instanceof Error ? error.message : 'Request failed';
  reply
    .status(
      message.startsWith('Invalid') ||
        message.includes('must') ||
        message.includes('目标') ||
        message.includes('需要')
        ? 400
        : 500,
    )
    .send({ error: message });
});
app.get('/api/health', async () => ({ ok: true }));
app.get('/api/settings', async () => ({
  ...getSettings(),
  okxConfigured: configured(),
  fundNavConfigured: !!process.env.LIXINGER_TOKEN,
}));
app.put('/api/settings', async (request) => {
  const body = obj(request.body);
  const changes: Partial<typeof settings.$inferInsert> = {};
  if (body.displayCurrency !== undefined) {
    const currency = str(body.displayCurrency, 'displayCurrency');
    if (
      !DISPLAY_CURRENCIES.includes(
        currency as (typeof DISPLAY_CURRENCIES)[number],
      )
    )
      throw new Error('Invalid display currency');
    changes.displayCurrency = currency;
  }
  if (body.autoSync !== undefined) {
    if (typeof body.autoSync !== 'boolean') throw new Error('Invalid autoSync');
    changes.autoSync = body.autoSync;
  }
  if (body.syncMinutes !== undefined) {
    if (![15, 60, 360, 1440].includes(Number(body.syncMinutes)))
      throw new Error('Invalid sync frequency');
    changes.syncMinutes = Number(body.syncMinutes);
  }
  db.update(settings).set(changes).where(eq(settings.id, 'main')).run();
  return getSettings();
});
app.get('/api/portfolio', async (request) => {
  const q = request.query as { currency?: string };
  return getPortfolio(
    q.currency &&
      DISPLAY_CURRENCIES.includes(
        q.currency as (typeof DISPLAY_CURRENCIES)[number],
      )
      ? q.currency
      : undefined,
  );
});
app.get('/api/assets', async () => getAssets());
app.get('/api/providers', async () =>
  db
    .select()
    .from(providerSyncState)
    .all()
    .map((s) => ({
      ...s,
      connected:
        db
          .select()
          .from(providerConnections)
          .where(eq(providerConnections.id, s.id))
          .get()?.connected ?? false,
      configured:
        s.id === 'okx'
          ? configured()
          : s.id === 'fund'
            ? !!process.env.LIXINGER_TOKEN
            : true,
    })),
);
app.get('/api/providers/:id/status', async (request, reply) => {
  const { id } = request.params as { id: string };
  const status = db
    .select()
    .from(providerSyncState)
    .where(eq(providerSyncState.id, id))
    .get();
  if (!status) return reply.code(404).send({ error: 'Unknown provider' });
  return status;
});
app.get('/api/fx', async () => ({
  rates: db.select().from(fxRates).all(),
  supportedCurrencies: DISPLAY_CURRENCIES,
}));
app.post('/api/sync', async () => {
  await syncAll();
  return {
    providers: db.select().from(providerSyncState).all(),
    portfolio: getPortfolio(),
  };
});
app.get('/api/history', async (request) => {
  const q = request.query as { currency?: string; range?: string };
  const currency =
    q.currency &&
    DISPLAY_CURRENCIES.includes(
      q.currency as (typeof DISPLAY_CURRENCIES)[number],
    )
      ? q.currency
      : getSettings().displayCurrency;
  const history = getHistory(currency);
  const days = { '1M': 31, '3M': 93, '6M': 186, '1Y': 366 }[q.range ?? 'ALL'];
  return days
    ? history.filter(
        (row) => Date.parse(row.timestamp) >= Date.now() - days * 86400_000,
      )
    : history;
});
app.post('/api/history/snapshot', async () => ({ id: createSnapshot(true) }));
app.post('/api/allocation/calculate', async (request) => {
  const b = obj(request.body);
  const contribution = str(b.contribution, 'contribution');
  const currency = str(b.currency, 'currency');
  if (
    !DISPLAY_CURRENCIES.includes(
      currency as (typeof DISPLAY_CURRENCIES)[number],
    )
  )
    throw new Error('Invalid currency');
  return allocation(contribution, currency);
});
app.get('/api/funds', async () => db.select().from(fundPositions).all());
app.post('/api/funds', async (request) => {
  const b = obj(request.body);
  return {
    id: saveFund({
      fundCode: str(b.fundCode, 'fundCode'),
      fundName: str(b.fundName, 'fundName'),
      shares: str(b.shares, 'shares'),
      fundType: typeof b.fundType === 'string' ? b.fundType : undefined,
      costBasis: typeof b.costBasis === 'string' ? b.costBasis : null,
      latestNav: typeof b.latestNav === 'string' ? b.latestNav : null,
    }),
  };
});
app.put('/api/funds/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!db.select().from(fundPositions).where(eq(fundPositions.id, id)).get())
    return reply.code(404).send({ error: 'Fund not found' });
  const b = obj(request.body);
  return {
    id: saveFund({
      id,
      fundCode: str(b.fundCode, 'fundCode'),
      fundName: str(b.fundName, 'fundName'),
      shares: str(b.shares, 'shares'),
      fundType: typeof b.fundType === 'string' ? b.fundType : undefined,
      costBasis: typeof b.costBasis === 'string' ? b.costBasis : null,
      latestNav: typeof b.latestNav === 'string' ? b.latestNav : null,
    }),
  };
});
app.delete('/api/funds/:id', async (request) => {
  const { id } = request.params as { id: string };
  db.delete(fundPositions).where(eq(fundPositions.id, id)).run();
  db.delete(assets)
    .where(eq(assets.id, `fund:${id}`))
    .run();
  db.delete(targetAllocations)
    .where(eq(targetAllocations.assetId, `fund:${id}`))
    .run();
  return { deleted: true };
});
app.get('/api/cash', async () => db.select().from(cashHoldings).all());
app.post('/api/cash', async (request) => {
  const b = obj(request.body);
  return {
    id: saveCash({
      currency: str(b.currency, 'currency'),
      amount: str(b.amount, 'amount'),
      name: typeof b.name === 'string' ? b.name : undefined,
    }),
  };
});
app.put('/api/cash/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!db.select().from(cashHoldings).where(eq(cashHoldings.id, id)).get())
    return reply.code(404).send({ error: 'Cash not found' });
  const b = obj(request.body);
  return {
    id: saveCash({
      id,
      currency: str(b.currency, 'currency'),
      amount: str(b.amount, 'amount'),
      name: typeof b.name === 'string' ? b.name : undefined,
    }),
  };
});
app.delete('/api/cash/:id', async (request) => {
  const { id } = request.params as { id: string };
  db.delete(cashHoldings).where(eq(cashHoldings.id, id)).run();
  db.delete(assets)
    .where(eq(assets.id, `cash:${id}`))
    .run();
  db.delete(targetAllocations)
    .where(eq(targetAllocations.assetId, `cash:${id}`))
    .run();
  return { deleted: true };
});
app.post('/api/manual-assets', async (request) => {
  const b = obj(request.body);
  return {
    id: saveManual({
      name: str(b.name, 'name'),
      category: str(b.category, 'category'),
      value: str(b.value, 'value'),
      currency: str(b.currency, 'currency'),
    }),
  };
});
app.delete('/api/manual-assets/:id', async (request) => {
  const { id } = request.params as { id: string };
  db.delete(assets)
    .where(eq(assets.id, `manual:${id}`))
    .run();
  db.delete(targetAllocations)
    .where(eq(targetAllocations.assetId, `manual:${id}`))
    .run();
  return { deleted: true };
});
app.put('/api/targets', async (request) => {
  const b = obj(request.body);
  if (!Array.isArray(b.targets)) throw new Error('Invalid targets');
  setTargets(
    b.targets.map((r: unknown) => {
      const row = obj(r);
      return {
        assetId: str(row.assetId, 'assetId'),
        percent: str(row.percent, 'percent'),
      };
    }),
  );
  return { saved: true };
});
app.post('/api/demo', async () => {
  demoSeed();
  return getPortfolio();
});
app.get('/api/backup', async (_request, reply) => {
  reply.header(
    'content-disposition',
    'attachment; filename="longview-backup.json"',
  );
  return {
    format: 'longview-backup-v1',
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    manualAssets: db
      .select()
      .from(assets)
      .where(eq(assets.source, 'Manual'))
      .all(),
    fundPositions: db.select().from(fundPositions).all(),
    cashHoldings: db.select().from(cashHoldings).all(),
    targetAllocations: db.select().from(targetAllocations).all(),
    snapshots: db.select().from(portfolioSnapshots).all(),
    assetSnapshots: db.select().from(assetSnapshots).all(),
    fxSnapshots: db.select().from(fxSnapshots).all(),
  };
});
const webDist = resolve(process.cwd(), '../web/dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((request, reply) =>
    request.url.startsWith('/api/')
      ? reply.code(404).send({ error: 'Not found' })
      : reply.sendFile('index.html'),
  );
}
const port = Number(process.env.PORT || 3001);
await app.listen({ port, host: process.env.HOST || '127.0.0.1' });
console.info(`LongView API listening on ${port}`);
void syncAll();
setInterval(() => {
  const s = getSettings();
  if (s.autoSync && Date.now() - getLastSyncRunAt() >= s.syncMinutes * 60_000)
    void syncAll();
}, 60_000).unref();
