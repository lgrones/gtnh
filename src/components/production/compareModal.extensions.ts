export type Rank = 'best' | 'worst' | 'average';

// rank alternatives by a numeric metric (lower = better). only assigns
// best/worst when the alternatives actually differ; every alt sharing the
// min/max is marked, not just the first.
export const rankBy = <T>(
  items: T[],
  value: (item: T) => number,
): ((item: T) => Rank) => {
  const values = items.map(value);
  const min = Math.min(...values);
  const max = Math.max(...values);

  return item => {
    if (min === max) return 'average';

    const v = value(item);
    if (v === min) return 'best';
    if (v === max) return 'worst';

    return 'average';
  };
};
