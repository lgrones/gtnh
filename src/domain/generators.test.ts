import { describe, expect, it } from 'vitest';

import { type TierDemand, type VoltageTier } from '@/contexts/productionStore';

import {
  bankEntry,
  GENERATORS,
  planBank,
  resolveBank,
  suggestBank,
} from './generators';

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

describe('resolveBank', () => {
  const benzene = gas.fuels.find(f => f.name === 'Benzene')!;
  const naquadah = GENERATORS.find(c => c.id === 'naquadah')!;

  it('pools every row against one demand, whatever tier it is', () => {
    // two HV gas turbines (512 each) and one IV naquadah reactor (8,192)
    const bank = resolveBank(
      [
        bankEntry('gas', 'HV', benzene.name, 2),
        bankEntry('naquadah', 'IV', 'Tiberium Rod', 1),
      ],
      7680,
    );

    expect(bank.output).toBe(9216);
    expect(bank.drawn).toBe(7680);
    expect(bank.shortfall).toBe(0);
  });

  it('reports what the bank cannot cover', () => {
    const bank = resolveBank([bankEntry('gas', 'HV', benzene.name, 1)], 2000);

    expect(bank.output).toBe(512);
    expect(bank.drawn).toBe(512);
    expect(bank.shortfall).toBe(1488);
    expect(bank.duty).toBe(1);
  });

  it('throttles every row together rather than burning into a full buffer', () => {
    const half = resolveBank([bankEntry('gas', 'HV', benzene.name, 2)], 512);
    const full = resolveBank([bankEntry('gas', 'HV', benzene.name, 1)], 512);

    // twice the generators at half duty burn what one at full duty does
    expect(half.duty).toBe(0.5);
    expect(half.fuels[0]!.rate).toBeCloseTo(full.fuels[0]!.rate);
    // 512 EU/t over 0.85 efficiency, 20 ticks a second, 360 EU per litre
    expect(full.fuels[0]!.rate).toBeCloseTo((512 / 0.85 / 360) * 20);
  });

  it('sums one line per fuel across the rows that burn it', () => {
    const bank = resolveBank(
      [
        bankEntry('gas', 'HV', benzene.name, 1),
        bankEntry('gas', 'MV', benzene.name, 1),
        bankEntry('naquadah', 'IV', 'Tiberium Rod', 1),
      ],
      100000,
    );

    expect(bank.fuels.map(f => f.name)).toEqual(['Benzene', 'Tiberium Rod']);
    expect(bank.fuels.find(f => f.name === 'Tiberium Rod')?.unit).toBe('item');
  });

  it('keeps a row whose generator or fuel the table no longer has', () => {
    const bank = resolveBank(
      [
        bankEntry('gas', 'HV', 'Unobtainium', 2),
        bankEntry('nope', 'HV', '', 1),
      ],
      1000,
    );

    expect(bank.rows[0]?.fuel).toBeUndefined();
    expect(bank.rows[0]?.output).toBe(1024); // it still makes power
    expect(bank.rows[0]?.fuelRate).toBe(0);
    expect(bank.rows[1]?.category).toBeUndefined();
    expect(bank.rows[1]?.output).toBe(0);
  });

  it('carries no fuel and no draw for an empty bank', () => {
    const bank = resolveBank([], 500);

    expect(bank).toMatchObject({
      output: 0,
      drawn: 0,
      shortfall: 500,
      duty: 0,
    });
    expect(bank.fuels).toEqual([]);
  });

  it('gives a naquadah reactor its above-one efficiency', () => {
    const variant = naquadah.tiers.find(t => t.tier === 'ZPM')!;
    const fuel = naquadah.fuels.find(f => f.name === 'Tiberium Rod')!;
    const bank = resolveBank(
      [bankEntry('naquadah', 'ZPM', fuel.name, 1)],
      Number.POSITIVE_INFINITY,
    );

    expect(variant.efficiency).toBe(2);
    expect(bank.fuels[0]!.rate).toBeCloseTo(
      (bank.output / variant.efficiency / fuel.value) * 20,
    );
  });
});

describe('suggestBank', () => {
  it('turns the per-tier sizing into rows to start editing from', () => {
    const entries = suggestBank(
      gas,
      naturalGas,
      demand([
        ['LV', { power: 100, amps: 1 }],
        ['HV', { power: 512, amps: 1 }],
      ]),
    );

    expect(entries).toMatchObject([
      { categoryId: 'gas', tier: 'LV', fuelName: 'Natural Gas', count: 4 },
      { categoryId: 'gas', tier: 'HV', fuelName: 'Natural Gas', count: 1 },
    ]);
  });

  it('carries a tier the category cannot build on its largest variant', () => {
    // gas turbines stop at IV, so the UV machines ride on IV generators —
    // pooled, a transformer chain covers the difference
    const entries = suggestBank(
      gas,
      naturalGas,
      demand([['UV', { power: 16384, amps: 1 }]]),
    );

    expect(entries).toMatchObject([
      { tier: 'IV', count: Math.ceil(16384 / 8192) },
    ]);
  });
});
