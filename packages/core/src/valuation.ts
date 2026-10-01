import { Decimal } from 'decimal.js';
import type { AssetHolding } from '@longview/shared';
import { CurrencyGraph } from './currency.js';

export interface ValuedAsset extends AssetHolding {
  nativeValue: string | null;
  valueUSD: string | null;
  displayValue: string | null;
  estimated: boolean;
  stale: boolean;
  valuationError: string | null;
}
export class ValuationEngine {
  constructor(private readonly graph: CurrencyGraph) {}
  value(asset: AssetHolding, displayCurrency: string): ValuedAsset {
    try {
      if (asset.currentPrice === null) throw new Error('Missing price');
      const nativeValue = new Decimal(asset.quantity).mul(asset.currentPrice);
      const usd = this.graph.convert(nativeValue, asset.priceCurrency, 'USD');
      const display = this.graph.convert(usd.amount, 'USD', displayCurrency);
      return {
        ...asset,
        nativeValue: nativeValue.toString(),
        valueUSD: usd.amount.toString(),
        displayValue: display.amount.toString(),
        estimated: !!asset.priceEstimated || usd.estimated || display.estimated,
        stale: !!asset.stale || usd.stale || display.stale,
        valuationError: null,
      };
    } catch (error) {
      return {
        ...asset,
        nativeValue: null,
        valueUSD: null,
        displayValue: null,
        estimated: false,
        stale: true,
        valuationError:
          error instanceof Error ? error.message : 'Valuation failed',
      };
    }
  }
  portfolio(
    assets: AssetHolding[],
    displayCurrency: string,
  ): {
    assets: ValuedAsset[];
    totalUSD: string | null;
    totalDisplay: string | null;
    incomplete: boolean;
  } {
    const valued = assets
      .filter((a) => a.enabled)
      .map((a) => this.value(a, displayCurrency));
    const incomplete = valued.some((a) => a.valueUSD === null);
    const totalUSD = valued.reduce(
      (sum, a) => sum.plus(a.valueUSD ?? 0),
      new Decimal(0),
    );
    let totalDisplay: string | null = null;
    try {
      totalDisplay = this.graph
        .convert(totalUSD, 'USD', displayCurrency)
        .amount.toString();
    } catch {
      /* unknown display FX */
    }
    return {
      assets: valued,
      totalUSD: incomplete ? null : totalUSD.toString(),
      totalDisplay: incomplete ? null : totalDisplay,
      incomplete,
    };
  }
}
