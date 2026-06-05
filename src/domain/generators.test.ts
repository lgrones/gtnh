import { describe, expect, it } from 'vitest';

import { type TierDemand, type VoltageTier } from '@/contexts/productionStore';

import { GENERATORS, planBank } from './generators';

const gas = GENERATORS.find(c => c.id === 'gas')!;
const naturalGas = gas.fuels.find(f => f.name === 'Natural Gas')!;

const demand = (entries: [VoltageTier, TierDemand][]) =>
  new Map<VoltageTier, TierDemand>(entries);

describe('planBank amperage', () => {
  it('sizes by power when power needs more units than amps', () => {
    // LV gen = 32 EU/t @ 1A. 100 EU/t needs ceil(100/32)=4 units; only 1A drawn
    const plan = planBank(
      gas,
      naturalGas,
      demand([['LV', { power: 100, amps: 1 }]]),
    );
    const row = plan.rows[0]!;
    expect(row.count).toBe(4);
    expect(row.ampBound).toBe(false);
  });

  it('sizes by amps when amperage needs more units than power', () => {
    // 30 EU/t needs only 1 LV gen power-wise, but 4A needs 4 generators
    const plan = planBank(
      gas,
      naturalGas,
      demand([['LV', { power: 30, amps: 4 }]]),
    );
    const row = plan.rows[0]!;
    expect(row.count).toBe(4);
    expect(row.ampBound).toBe(true);
  });

  it('throttles fuel to actual power draw, not the amp-padded count', () => {
    // amp-bound to 4 gens, but fuel sized off 30 EU/t draw only
    const ampBound = planBank(
      gas,
      naturalGas,
      demand([['LV', { power: 30, amps: 4 }]]),
    );
    const powerOnly = planBank(
      gas,
      naturalGas,
      demand([['LV', { power: 30, amps: 1 }]]),
    );
    expect(ampBound.rows[0]!.fuelRate).toBeCloseTo(powerOnly.rows[0]!.fuelRate);
  });
});
