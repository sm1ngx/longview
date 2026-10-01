import { describe, expect, it } from 'vitest';
import { CurrencyGraph } from './currency.js';
import { ValuationEngine } from './valuation.js';
import type { AssetHolding } from '@longview/shared';
const asOf = new Date().toISOString();
const graph = new CurrencyGraph();
graph.add({ from: 'USDT', to: 'USD', rate: '0.98', asOf, source: 'test' });
graph.add({ from: 'EUR', to: 'USD', rate: '1.1', asOf, source: 'test' });
graph.add({ from: 'EUR', to: 'CNY', rate: '7.7', asOf, source: 'test' });
const asset = (
  price: string | null,
  quote: string,
  type: AssetHolding['assetType'] = 'CRYPTO',
): AssetHolding => ({
  id: 'a',
  symbol: 'BTC',
  name: 'Bitcoin',
  assetType: type,
  provider: 'test',
  nativeCurrency: 'BTC',
  quantity: '0.001',
  currentPrice: price,
  priceCurrency: quote,
  targetAllocation: '100',
  category: 'Crypto',
  enabled: true,
  lastUpdatedAt: asOf,
  source: 'test',
});
describe('valuation and conversion', () => {
  it('converts BTC USDT to USD without assuming peg', () => {
    const v = new ValuationEngine(graph).value(asset('83000', 'USDT'), 'USD');
    expect(v.nativeValue).toBe('83');
    expect(v.valueUSD).toBe('81.34');
  });
  it('converts via EUR graph to CNY', () => {
    const v = new ValuationEngine(graph).value(asset('83000', 'USDT'), 'CNY');
    expect(Number(v.displayValue)).toBeCloseTo(569.38);
  });
  it('converts fund and cash CNY to USD and USDT', () => {
    const fund = asset('1000', 'CNY', 'FUND');
    expect(
      new ValuationEngine(graph).value(fund, 'USDT').displayValue,
    ).not.toBeNull();
    expect(
      new ValuationEngine(graph).value(fund, 'USD').valueUSD,
    ).not.toBeNull();
  });
  it('handles missing FX and missing prices as incomplete, not zero', () => {
    expect(
      new ValuationEngine(new CurrencyGraph()).value(asset('1', 'USDT'), 'USD')
        .valueUSD,
    ).toBeNull();
    expect(
      new ValuationEngine(graph).portfolio([asset(null, 'USDT')], 'CNY')
        .totalUSD,
    ).toBeNull();
  });
  it('marks stale inputs', () => {
    expect(
      new ValuationEngine(graph).value(
        { ...asset('1', 'USDT'), stale: true },
        'USD',
      ).stale,
    ).toBe(true);
  });
  it('prevents graph cycles', () => {
    const g = new CurrencyGraph();
    g.add({ from: 'A', to: 'B', rate: '2', asOf, source: 'test' });
    g.add({ from: 'B', to: 'C', rate: '3', asOf, source: 'test' });
    expect(g.convert(1, 'A', 'C').amount.toString()).toBe('6');
    expect(() => g.convert(1, 'A', 'D')).toThrow();
  });
});
