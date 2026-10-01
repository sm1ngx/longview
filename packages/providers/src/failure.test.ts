import { describe, expect, it } from 'vitest';
import { EcbFxProvider } from './fx.js';
import {
  FallbackFundProvider,
  LixingerFundProvider,
  ManualFundProvider,
  type FundProvider,
} from './fund.js';

describe('provider failures', () => {
  it('rejects malformed ECB data instead of inventing an FX rate', async () => {
    const provider = new EcbFxProvider(
      (async () => new Response('<xml/>')) as typeof fetch,
    );
    await expect(provider.getRates('EUR')).rejects.toThrow('date missing');
  });
  it('surfaces fund NAV source failure to the fallback', async () => {
    const primary = new LixingerFundProvider(
      'token',
      (async () => new Response('error', { status: 503 })) as typeof fetch,
    );
    const fallback = new ManualFundProvider();
    const provider = new FallbackFundProvider(primary, fallback);
    await expect(provider.getLatestNav('000001')).rejects.toThrow(
      'Manual NAV required',
    );
  });
  it('uses a documented secondary fund provider when primary fails', async () => {
    const failed: FundProvider = {
      searchFund: async () => {
        throw Error('down');
      },
      getFundInfo: async () => {
        throw Error('down');
      },
      getLatestNav: async () => {
        throw Error('down');
      },
      getHistoricalNav: async () => {
        throw Error('down');
      },
    };
    const backup: FundProvider = {
      searchFund: async () => [],
      getFundInfo: async () => null,
      getLatestNav: async (code) => ({
        code,
        nav: '1.2345',
        date: '2026-09-29',
        source: 'backup',
      }),
      getHistoricalNav: async () => [],
    };
    expect(
      (await new FallbackFundProvider(failed, backup).getLatestNav('000001'))
        .nav,
    ).toBe('1.2345');
  });
});
