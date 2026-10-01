import { describe, expect, it, vi } from 'vitest';
import { OkxProvider, ProviderError } from './okx.js';
const credentials = {
  apiKey: 'test',
  apiSecret: 'test',
  passphrase: 'test',
  region: 'GLOBAL' as const,
};
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ code: '0', data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
describe('read only OKX provider', () => {
  it('checks permission and aggregates trading and funding balances', async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.includes('account/config')
        ? response([{ perm: 'read_only' }])
        : url.includes('account/balance')
          ? response([
              {
                details: [
                  { ccy: 'BTC', cashBal: '0.00005954' },
                  { ccy: 'ETH', cashBal: '0' },
                ],
              },
            ])
          : response([{ ccy: 'USDT', bal: '100' }]),
    );
    const provider = new OkxProvider(credentials, fetcher as typeof fetch);
    expect(await provider.getBalances()).toEqual([
      { currency: 'BTC', quantity: '0.00005954', account: 'trading' },
      { currency: 'USDT', quantity: '100', account: 'funding' },
    ]);
    expect(
      fetcher.mock.calls.every(([url]) => !String(url).includes('/trade/')),
    ).toBe(true);
  });
  it('rejects trade permission', async () => {
    const p = new OkxProvider(credentials, (async () =>
      response([{ perm: 'read_only,trade' }])) as typeof fetch);
    await expect(p.getBalances()).rejects.toMatchObject({ kind: 'permission' });
  });
  it('maps authentication and rate limits', async () => {
    for (const [status, kind] of [
      [401, 'auth'],
      [429, 'rate_limit'],
    ] as const) {
      const p = new OkxProvider(credentials, (async () =>
        response([], status)) as typeof fetch);
      await expect(p.testConnection()).rejects.toMatchObject({ kind });
    }
  });
  it('maps network timeout', async () => {
    const p = new OkxProvider(credentials, (async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    }) as typeof fetch);
    await expect(p.testConnection()).rejects.toEqual(
      new ProviderError('OKX timeout', 'timeout'),
    );
  });
});
