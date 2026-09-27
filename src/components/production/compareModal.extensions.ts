export type Rank = 'best' | 'worst' | 'average';

// rank alternatives by a numeric metric (lower = better). only assigns
// best/worst when the alternatives actually differ; every alt sharing the
// min/max is marked, not just the first.
//
// `eligible` keeps alternatives whose metric is not a measurement out of the
// ranking entirely: a line missing the EU on its recipes reports 0 EU/t, and
// ranking that as the lowest draw hands a green arrow to the one node nobody
// finished filling in. Those come back 'average' and never move the min/max.
export const rankBy = <T>(
  items: T[],
  value: (item: T) => number,
  eligible: (item: T) => boolean = () => true,
): ((item: T) => Rank) => {
  const ranked = items.filter(eligible);
  const values = ranked.map(value);
  const min = Math.min(...values);
  const max = Math.max(...values);

  return item => {
    if (values.length === 0 || min === max || !eligible(item)) return 'average';

    const v = value(item);
    if (v === min) return 'best';
    if (v === max) return 'worst';

    return 'average';
  };
};
