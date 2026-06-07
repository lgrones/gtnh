import { describe, expect, it } from 'vitest';

import { rankBy } from './compareModal.extensions';

// rank a flat list of numbers via identity, for terse assertions
const ranks = (values: number[]) => {
  const rank = rankBy(values, x => x);
  return values.map(rank);
};

describe('rankBy', () => {
  it('marks the single min as best and single max as worst', () => {
    expect(ranks([5, 1, 9, 3])).toEqual([
      'average',
      'best',
      'worst',
      'average',
    ]);
  });

  it('marks every alternative average when all values are equal', () => {
    expect(ranks([4, 4, 4])).toEqual(['average', 'average', 'average']);
  });

  it('marks a lone alternative average (no difference to compare)', () => {
    expect(ranks([7])).toEqual(['average']);
  });

  it('marks all alternatives sharing the min, not just the first', () => {
    expect(ranks([1, 1, 5])).toEqual(['best', 'best', 'worst']);
  });

  it('marks all alternatives sharing the max, not just the first', () => {
    expect(ranks([2, 9, 9])).toEqual(['best', 'worst', 'worst']);
  });

  it('marks ties at both ends when only two distinct values exist', () => {
    expect(ranks([1, 5, 1, 5])).toEqual(['best', 'worst', 'best', 'worst']);
  });

  it('reads the metric through the accessor', () => {
    const items = [{ d: 30 }, { d: 10 }, { d: 20 }];
    const rank = rankBy(items, x => x.d);
    expect(items.map(rank)).toEqual(['worst', 'best', 'average']);
  });
});
