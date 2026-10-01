import { Decimal } from 'decimal.js';
import type { RateEdge } from '@longview/shared';
import { ProviderError } from './okx.js';

export interface FxProvider {
  getRate(from: string, to: string): Promise<RateEdge>;
  getRates(base: string): Promise<RateEdge[]>;
  getSupportedCurrencies(): Promise<string[]>;
}
export class EcbFxProvider implements FxProvider {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  private async load(): Promise<RateEdge[]> {
    const response = await this.fetcher(
      'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
      { signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok)
      throw new ProviderError(`ECB HTTP ${response.status}`, 'remote');
    const xml = await response.text();
    const date = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
    if (!date) throw new ProviderError('ECB date missing', 'remote');
    const asOf = `${date}T16:00:00Z`;
    const edges: RateEdge[] = [];
    for (const match of xml.matchAll(
      /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([^'"]+)['"]\s*\/>/g,
    )) {
      const [, to, rate] = match;
      if (to && rate && new Decimal(rate).gt(0))
        edges.push({
          from: 'EUR',
          to,
          rate,
          asOf,
          source: 'ECB',
          stale: Date.now() - Date.parse(asOf) > 96 * 3600_000,
        });
    }
    if (!edges.some((e) => e.to === 'USD'))
      throw new ProviderError('ECB USD rate missing', 'remote');
    return edges;
  }
  async getRates(base: string): Promise<RateEdge[]> {
    const edges = await this.load();
    if (base === 'EUR') return edges;
    const baseRate = edges.find((e) => e.to === base)?.rate;
    if (!baseRate)
      throw new ProviderError('ECB currency unsupported', 'remote');
    return [
      {
        from: base,
        to: 'EUR',
        rate: new Decimal(1).div(baseRate).toString(),
        asOf: edges[0]!.asOf,
        source: 'ECB',
      },
      ...edges
        .filter((e) => e.to !== base)
        .map((e) => ({
          ...e,
          from: base,
          rate: new Decimal(e.rate).div(baseRate).toString(),
        })),
    ];
  }
  async getRate(from: string, to: string): Promise<RateEdge> {
    const edge = (await this.getRates(from)).find((e) => e.to === to);
    if (!edge) throw new ProviderError('ECB pair unsupported', 'remote');
    return edge;
  }
  async getSupportedCurrencies(): Promise<string[]> {
    return ['EUR', ...(await this.load()).map((e) => e.to)];
  }
}
