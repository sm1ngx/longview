import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { calculateAllocation } from './allocation.js';
const portfolio = [
  { id: 'fund', name: '基金', currentValue: '560', targetPercent: '60' },
  { id: 'btc', name: 'BTC', currentValue: '270', targetPercent: '25' },
  { id: 'eth', name: 'ETH', currentValue: '90', targetPercent: '10' },
  { id: 'cash', name: '现金', currentValue: '80', targetPercent: '5' },
];
describe('contribution allocation', () => {
  it.each(['0', '0.01', '1', '1000', '1000000000000.99'])(
    'preserves the entire contribution %s',
    (cash) => {
      const result = calculateAllocation(portfolio, cash, 'CNY');
      expect(result.totalAllocated).toBe(new Decimal(cash).toFixed(2));
      expect(
        result.lines
          .reduce((s, l) => s.plus(l.amount), new Decimal(0))
          .toFixed(2),
      ).toBe(result.contribution);
    },
  );
  it('never allocates to an overweight asset', () => {
    const result = calculateAllocation(portfolio, '100', 'CNY');
    expect(result.lines.find((l) => l.id === 'cash')?.amount).toBe('0.00');
  });
  it('handles exact target allocation', () => {
    const result = calculateAllocation(
      [
        { id: 'a', name: 'A', currentValue: '50', targetPercent: '50' },
        { id: 'b', name: 'B', currentValue: '50', targetPercent: '50' },
      ],
      '10',
      'USD',
    );
    expect(result.lines.map((l) => l.amount)).toEqual(['5.00', '5.00']);
  });
  it('assigns rounding remainder', () => {
    const result = calculateAllocation(
      ['a', 'b', 'c'].map((id) => ({
        id,
        name: id,
        currentValue: '0',
        targetPercent: id === 'a' ? '34' : '33',
      })),
      '0.01',
      'USD',
    );
    expect(result.totalAllocated).toBe('0.01');
  });
  it('rejects invalid targets', () =>
    expect(() =>
      calculateAllocation(
        [{ id: 'a', name: 'A', currentValue: '1', targetPercent: '97' }],
        '1',
        'USD',
      ),
    ).toThrow('100%'));
  it('supports JPY whole amounts', () =>
    expect(calculateAllocation(portfolio, '1', 'JPY').totalAllocated).toBe(
      '1',
    ));
});
