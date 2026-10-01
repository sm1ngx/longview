import { Decimal } from 'decimal.js';

export interface AllocationInput {
  id: string;
  name: string;
  currentValue: string;
  targetPercent: string;
}
export interface AllocationLine {
  id: string;
  name: string;
  currentPercent: string;
  targetPercent: string;
  deviationPercent: string;
  gap: string;
  amount: string;
  reason: string;
}
export interface AllocationResult {
  contribution: string;
  currency: string;
  lines: AllocationLine[];
  totalAllocated: string;
}
export function calculateAllocation(
  inputs: AllocationInput[],
  contribution: string,
  currency: string,
): AllocationResult {
  const cash = new Decimal(contribution);
  if (!cash.isFinite() || cash.lt(0))
    throw new Error('Contribution must be nonnegative');
  if (!inputs.length) throw new Error('No assets');
  const targets = inputs.map((a) => new Decimal(a.targetPercent));
  if (
    targets.some((t) => !t.isFinite() || t.lt(0)) ||
    !targets.reduce((s, t) => s.plus(t), new Decimal(0)).eq(100)
  )
    throw new Error('Target allocations must total 100%');
  const values = inputs.map((a) => new Decimal(a.currentValue));
  if (values.some((v) => !v.isFinite() || v.lt(0)))
    throw new Error('Invalid asset value');
  const total = values.reduce((s, v) => s.plus(v), new Decimal(0));
  const nextTotal = total.plus(cash);
  const gaps = targets.map((t, i) =>
    nextTotal.mul(t).div(100).minus(values[i]!),
  );
  const positive = gaps.reduce(
    (s, g) => s.plus(Decimal.max(g, 0)),
    new Decimal(0),
  );
  const digits = currency.toUpperCase() === 'JPY' ? 0 : 2;
  const normalized = cash.toDecimalPlaces(digits, Decimal.ROUND_HALF_UP);
  if (!cash.eq(normalized))
    throw new Error(`Contribution supports at most ${digits} decimal places`);
  const amounts = gaps.map((g) =>
    positive.gt(0) && g.gt(0)
      ? normalized
          .mul(g)
          .div(positive)
          .toDecimalPlaces(digits, Decimal.ROUND_DOWN)
      : new Decimal(0),
  );
  const remainder = normalized.minus(
    amounts.reduce((s, a) => s.plus(a), new Decimal(0)),
  );
  const finalIndex = gaps.findLastIndex((g) => g.gt(0));
  if (finalIndex >= 0)
    amounts[finalIndex] = amounts[finalIndex]!.plus(remainder);
  const lines = inputs.map((a, i): AllocationLine => {
    const currentPercent = total.isZero()
      ? new Decimal(0)
      : values[i]!.div(total).mul(100);
    const deviation = currentPercent.minus(targets[i]!);
    return {
      id: a.id,
      name: a.name,
      currentPercent: currentPercent.toFixed(2),
      targetPercent: targets[i]!.toString(),
      deviationPercent: deviation.toFixed(2),
      gap: gaps[i]!.toString(),
      amount: amounts[i]!.toFixed(digits),
      reason: gaps[i]!.lte(0)
        ? `${a.name}已达到或超过目标比例，本轮不追加`
        : `${a.name}当前低于投入后目标，分配部分新增资金`,
    };
  });
  return {
    contribution: normalized.toFixed(digits),
    currency,
    lines,
    totalAllocated: amounts
      .reduce((s, a) => s.plus(a), new Decimal(0))
      .toFixed(digits),
  };
}
