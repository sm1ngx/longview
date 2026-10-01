import { Decimal } from 'decimal.js';
import { ProviderError } from './okx.js';

export interface FundInfo {
  code: string;
  name: string;
  type: string;
}
export interface FundNav {
  code: string;
  nav: string;
  date: string;
  source: string;
}
export interface FundProvider {
  searchFund(query: string): Promise<FundInfo[]>;
  getFundInfo(code: string): Promise<FundInfo | null>;
  getLatestNav(code: string): Promise<FundNav>;
  getHistoricalNav(
    code: string,
    startDate: string,
    endDate: string,
  ): Promise<FundNav[]>;
}
export class LixingerFundProvider implements FundProvider {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  private async post<T>(path: string, params: object): Promise<T[]> {
    if (!this.token) throw new ProviderError('Lixinger token missing', 'auth');
    const response = await this.fetcher(
      `https://open.lixinger.com/api/cn/fund${path}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: this.token, ...params }),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok)
      throw new ProviderError(`Lixinger HTTP ${response.status}`, 'remote');
    const data = (await response.json()) as { code?: number; data?: T[] };
    if (data.code !== 1 || !Array.isArray(data.data))
      throw new ProviderError('Lixinger API error', 'remote');
    return data.data;
  }
  async searchFund(query: string): Promise<FundInfo[]> {
    if (!/^\d{6}$/.test(query)) return [];
    const info = await this.getFundInfo(query);
    return info ? [info] : [];
  }
  async getFundInfo(code: string): Promise<FundInfo | null> {
    const data = await this.post<{
      stockCode: string;
      name: string;
      fundSecondLevel?: string;
    }>('', { stockCodes: [code], pageIndex: 0 });
    const item = data.find((d) => d.stockCode === code);
    return item
      ? { code, name: item.name, type: item.fundSecondLevel ?? 'FUND' }
      : null;
  }
  async getLatestNav(code: string): Promise<FundNav> {
    const localDate = (date: Date) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date);
    const startDate = localDate(new Date(Date.now() - 30 * 86400_000));
    const rows = await this.getHistoricalNav(
      code,
      startDate,
      localDate(new Date()),
    );
    const latest = rows.sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!latest) throw new ProviderError('Fund NAV missing', 'remote');
    return latest;
  }
  async getHistoricalNav(
    code: string,
    startDate: string,
    endDate: string,
  ): Promise<FundNav[]> {
    if (!/^\d{6}$/.test(code))
      throw new ProviderError('Invalid fund code', 'remote');
    const rows = await this.post<{ date: string; netValue: number }>(
      '/net-value',
      { stockCode: code, startDate, endDate },
    );
    return rows
      .filter((r) => r.date && new Decimal(r.netValue).gt(0))
      .map((r) => ({
        code,
        nav: new Decimal(r.netValue).toString(),
        date: r.date,
        source: 'Lixinger',
      }));
  }
}
export class ManualFundProvider implements FundProvider {
  async searchFund(): Promise<FundInfo[]> {
    return [];
  }
  async getFundInfo(): Promise<FundInfo | null> {
    return null;
  }
  async getLatestNav(): Promise<FundNav> {
    throw new ProviderError('Manual NAV required', 'remote');
  }
  async getHistoricalNav(): Promise<FundNav[]> {
    return [];
  }
}
export class FallbackFundProvider implements FundProvider {
  constructor(
    private readonly primary: FundProvider,
    private readonly fallback: FundProvider,
  ) {}
  async searchFund(q: string): Promise<FundInfo[]> {
    try {
      return await this.primary.searchFund(q);
    } catch {
      return this.fallback.searchFund(q);
    }
  }
  async getFundInfo(c: string): Promise<FundInfo | null> {
    try {
      return await this.primary.getFundInfo(c);
    } catch {
      return this.fallback.getFundInfo(c);
    }
  }
  async getLatestNav(c: string): Promise<FundNav> {
    try {
      return await this.primary.getLatestNav(c);
    } catch {
      return this.fallback.getLatestNav(c);
    }
  }
  async getHistoricalNav(c: string, s: string, e: string): Promise<FundNav[]> {
    try {
      return await this.primary.getHistoricalNav(c, s, e);
    } catch {
      return this.fallback.getHistoricalNav(c, s, e);
    }
  }
}
