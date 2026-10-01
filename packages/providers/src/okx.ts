import { createHmac } from 'node:crypto';
import { Decimal } from 'decimal.js';

export interface OkxCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  region: 'GLOBAL' | 'EU' | 'US';
}
export interface OkxBalance {
  currency: string;
  quantity: string;
  account: 'trading' | 'funding';
}
type Fetcher = typeof fetch;
const HOSTS = {
  GLOBAL: 'https://www.okx.com',
  EU: 'https://eea.okx.com',
  US: 'https://us.okx.com',
} as const;
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly kind:
      'auth' | 'rate_limit' | 'timeout' | 'remote' | 'permission',
  ) {
    super(message);
  }
}

export class OkxProvider {
  private readonly host: string;
  constructor(
    private readonly credentials: OkxCredentials,
    private readonly fetcher: Fetcher = fetch,
  ) {
    this.host = HOSTS[credentials.region];
  }
  private async request<T>(path: string, authenticated: boolean): Promise<T[]> {
    const timestamp = new Date().toISOString();
    const headers: Record<string, string> = {};
    if (authenticated) {
      headers['OK-ACCESS-KEY'] = this.credentials.apiKey;
      headers['OK-ACCESS-PASSPHRASE'] = this.credentials.passphrase;
      headers['OK-ACCESS-TIMESTAMP'] = timestamp;
      headers['OK-ACCESS-SIGN'] = createHmac(
        'sha256',
        this.credentials.apiSecret,
      )
        .update(`${timestamp}GET${path}`)
        .digest('base64');
    }
    try {
      const response = await this.fetcher(`${this.host}${path}`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(8000),
      });
      if (response.status === 401 || response.status === 403)
        throw new ProviderError('OKX authentication failed', 'auth');
      if (response.status === 429)
        throw new ProviderError('OKX rate limit', 'rate_limit');
      if (!response.ok)
        throw new ProviderError(`OKX HTTP ${response.status}`, 'remote');
      const body = (await response.json()) as {
        code?: string;
        msg?: string;
        data?: T[];
      };
      if (body.code !== '0' || !Array.isArray(body.data))
        throw new ProviderError(
          `OKX API ${body.code ?? 'invalid response'}: ${body.msg ?? ''}`,
          'remote',
        );
      return body.data;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'OKX timeout'
          : 'OKX unavailable',
        'timeout',
      );
    }
  }
  async testConnection(): Promise<{
    connected: true;
    permission: 'read_only';
  }> {
    if (
      !this.credentials.apiKey ||
      !this.credentials.apiSecret ||
      !this.credentials.passphrase
    )
      throw new ProviderError('OKX credentials missing', 'auth');
    const config = await this.request<{ perm?: string }>(
      '/api/v5/account/config',
      true,
    );
    const permissions = (config[0]?.perm ?? '')
      .split(',')
      .map((p) => p.trim().toLowerCase());
    if (permissions.length !== 1 || permissions[0] !== 'read_only')
      throw new ProviderError(
        '该 API Key 具有交易或资金操作权限，不建议用于 LongView。请改用仅 Read 权限的 Key。',
        'permission',
      );
    return { connected: true, permission: 'read_only' };
  }
  async getTradingBalances(): Promise<OkxBalance[]> {
    const rows = await this.request<{
      details?: { ccy?: string; cashBal?: string; eq?: string }[];
    }>('/api/v5/account/balance', true);
    return rows.flatMap((row) =>
      (row.details ?? []).flatMap((item) => {
        const quantity = item.cashBal || item.eq || '0';
        return item.ccy && new Decimal(quantity).gt(0)
          ? [{ currency: item.ccy, quantity, account: 'trading' as const }]
          : [];
      }),
    );
  }
  async getFundingBalances(): Promise<OkxBalance[]> {
    const rows = await this.request<{ ccy?: string; bal?: string }>(
      '/api/v5/asset/balances',
      true,
    );
    return rows.flatMap((item) =>
      item.ccy && item.bal && new Decimal(item.bal).gt(0)
        ? [
            {
              currency: item.ccy,
              quantity: item.bal,
              account: 'funding' as const,
            },
          ]
        : [],
    );
  }
  async getBalances(): Promise<OkxBalance[]> {
    await this.testConnection();
    const [trading, funding] = await Promise.all([
      this.getTradingBalances(),
      this.getFundingBalances(),
    ]);
    return [...trading, ...funding];
  }
  async getTicker(
    instrument: string,
  ): Promise<{ price: string; asOf: string }> {
    if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(instrument))
      throw new ProviderError('Invalid instrument', 'remote');
    const [ticker] = await this.request<{ last?: string; ts?: string }>(
      `/api/v5/market/ticker?instId=${encodeURIComponent(instrument)}`,
      false,
    );
    if (!ticker?.last || !new Decimal(ticker.last).gt(0))
      throw new ProviderError('Ticker missing', 'remote');
    return {
      price: ticker.last,
      asOf: ticker.ts
        ? new Date(Number(ticker.ts)).toISOString()
        : new Date().toISOString(),
    };
  }
  async getAssetPrice(
    symbol: string,
  ): Promise<{ price: string; quote: 'USDT' | 'USD'; asOf: string }> {
    if (!/^[A-Z0-9]+$/.test(symbol))
      throw new ProviderError('Invalid symbol', 'remote');
    for (const quote of ['USDT', 'USD'] as const) {
      try {
        const ticker = await this.getTicker(`${symbol}-${quote}`);
        return { ...ticker, quote };
      } catch (error) {
        if (
          error instanceof ProviderError &&
          ['auth', 'rate_limit', 'timeout'].includes(error.kind)
        )
          throw error;
      }
    }
    throw new ProviderError(`No spot ticker for ${symbol}`, 'remote');
  }
}
