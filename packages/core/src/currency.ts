import { Decimal } from 'decimal.js';
import type { RateEdge } from '@longview/shared';

export class ConversionError extends Error {}
export interface ConversionResult {
  amount: Decimal;
  path: string[];
  estimated: boolean;
  stale: boolean;
}

export class CurrencyGraph {
  private edges = new Map<string, RateEdge[]>();
  add(edge: RateEdge): void {
    const rate = new Decimal(edge.rate);
    if (!rate.isFinite() || rate.lte(0) || edge.from === edge.to)
      throw new ConversionError('Invalid FX rate');
    const direct = {
      ...edge,
      from: edge.from.toUpperCase(),
      to: edge.to.toUpperCase(),
    };
    const reverse = {
      ...direct,
      from: direct.to,
      to: direct.from,
      rate: new Decimal(1).div(rate).toString(),
    };
    this.edges.set(direct.from, [
      ...(this.edges.get(direct.from) ?? []).filter((e) => e.to !== direct.to),
      direct,
    ]);
    this.edges.set(reverse.from, [
      ...(this.edges.get(reverse.from) ?? []).filter(
        (e) => e.to !== reverse.to,
      ),
      reverse,
    ]);
  }
  convert(amount: Decimal.Value, from: string, to: string): ConversionResult {
    const start = from.toUpperCase();
    const end = to.toUpperCase();
    if (start === end)
      return {
        amount: new Decimal(amount),
        path: [start],
        estimated: false,
        stale: false,
      };
    const queue: {
      currency: string;
      amount: Decimal;
      path: string[];
      estimated: boolean;
      stale: boolean;
    }[] = [
      {
        currency: start,
        amount: new Decimal(amount),
        path: [start],
        estimated: false,
        stale: false,
      },
    ];
    const visited = new Set([start]);
    while (queue.length) {
      const node = queue.shift()!;
      for (const edge of this.edges.get(node.currency) ?? []) {
        if (visited.has(edge.to)) continue;
        const next = {
          currency: edge.to,
          amount: node.amount.mul(edge.rate),
          path: [...node.path, edge.to],
          estimated: node.estimated || !!edge.estimated,
          stale: node.stale || !!edge.stale,
        };
        if (edge.to === end)
          return {
            amount: next.amount,
            path: next.path,
            estimated: next.estimated,
            stale: next.stale,
          };
        visited.add(edge.to);
        queue.push(next);
      }
    }
    throw new ConversionError(`Missing conversion path: ${start} → ${end}`);
  }
}
