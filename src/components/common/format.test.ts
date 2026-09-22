import { describe, expect, it } from 'vitest';

import { formatAmount, formatDuration, formatRate } from './format';

describe('formatAmount', () => {
  it('keeps whole amounts whole, with thousands separators', () => {
    expect(formatAmount(1)).toBe('1');
    expect(formatAmount(1_250_000)).toBe('1,250,000');
  });

  it('keeps a chance-based fraction readable rather than rounding it away', () => {
    expect(formatAmount(0.8)).toBe('0.8');
    expect(formatAmount(0.05)).toBe('0.05');
    expect(formatAmount(0.02)).toBe('0.02');
  });

  it('hides the float dust a fractional recipe row leaves behind', () => {
    expect(formatAmount(0.1 + 0.2)).toBe('0.3');
    expect(formatAmount(0.8 * 3)).toBe('2.4');
  });
});

describe('formatRate', () => {
  it('follows the size of the rate', () => {
    expect(formatRate(120.4)).toBe('120');
    expect(formatRate(12.34)).toBe('12.3');
    expect(formatRate(0.125)).toBe('0.13');
    expect(formatRate(0.0001)).toBe('1.0e-4');
  });
});

describe('formatDuration', () => {
  it('drops the units it does not need', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(3723)).toBe('1h 2m 3s');
  });

  it('reads an empty or negative line as no time at all', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-5)).toBe('0s');
  });
});
