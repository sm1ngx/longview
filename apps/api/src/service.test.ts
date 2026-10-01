import { beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const xml = `<gesmes:Envelope><Cube><Cube time='2026-09-30'><Cube currency='USD' rate='1.1'/><Cube currency='CNY' rate='7.7'/></Cube></Cube></gesmes:Envelope>`;
let online = true;
vi.stubGlobal('fetch', async (url: string) => {
  if (!online) throw new Error('provider offline');
  if (url.includes('ecb.europa.eu')) return new Response(xml);
  return new Response(JSON.stringify({ code: '500', data: [] }));
});

type Service = typeof import('./service.js');
let service: Service;
beforeAll(async () => {
  process.env.DATABASE_URL = `/tmp/longview-test-${randomUUID()}.db`;
  process.env.LIXINGER_TOKEN = '';
  process.env.OKX_API_KEY = '';
  service = await import('./service.js');
});

describe('last known good data', () => {
  it('preserves fund NAV and cash valuation after all configured data sources fail', async () => {
    service.saveCash({ currency: 'CNY', amount: '100', name: 'Test cash' });
    service.saveFund({
      fundCode: '000001',
      fundName: 'Test fund',
      shares: '10',
      latestNav: '1.5',
    });
    await service.syncAll();
    const before = service.getPortfolio('USD');
    expect(before.totalUSD).not.toBeNull();
    online = false;
    await service.syncAll();
    const after = service.getPortfolio('USD');
    expect(after.totalUSD).toBe(before.totalUSD);
    expect(after.assets.find((a) => a.assetType === 'FUND')?.currentPrice).toBe(
      '1.5',
    );
    expect(after.assets.find((a) => a.assetType === 'FUND')?.stale).toBe(true);
  });
});
