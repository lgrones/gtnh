import { describe, expect, it } from 'vitest';

import {
  calculateHeatDiscountMultiplier,
  calculateMultiplierUnderOneTick,
  calculateOverclock,
  type OverclockInput,
} from './overclockCalculator';

// a recipe fed by a machine that is its exact match, so nothing overclocks
// unless a test asks for it
const base = (patch: Partial<OverclockInput> = {}): OverclockInput => ({
  recipeEUt: 100,
  machineVoltage: 100,
  machineAmperage: 1,
  duration: 100,
  ...patch,
});

describe('the heat discount', () => {
  // one step per 900 K above what the recipe asks for, at 0.95 each
  it('compounds one step per 900 K of surplus heat', () => {
    expect(
      calculateHeatDiscountMultiplier(
        base({ heatDiscount: true, recipeHeat: 1800, machineHeat: 5400 }),
      ),
    ).toBeCloseTo(0.95 ** 4, 12);
  });

  it('is one when the machine does not discount', () => {
    expect(
      calculateHeatDiscountMultiplier(
        base({ recipeHeat: 1800, machineHeat: 5400 }),
      ),
    ).toBe(1);
  });
});

describe('a machine that matches its recipe exactly', () => {
  it('does not overclock', () => {
    const result = calculateOverclock(base());
    expect(result.tiersAbove).toBe(0);
    expect(result.overclocks).toBe(0);
    expect(result.euPerTick).toBe(100);
    expect(result.durationTicks).toBe(100);
  });
});

describe('Volcanus — the full modifier stack', () => {
  // 480 EU/t over 200 ticks at 8 parallels, on 4 EV hatches, with Nichrome
  // coils against a 1,500 K recipe. Volcanus costs 0.9x EU and runs at 1/2.2
  // the duration, and its coils are 3,600 K
  const volcanus = base({
    recipeEUt: 480,
    duration: 200,
    parallel: 8,
    machineVoltage: 2048,
    machineAmperage: 4,
    amperageOC: true,
    eutModifier: 0.9,
    durationModifier: 1 / 2.2,
    heatOC: true,
    heatDiscount: true,
    recipeHeat: 1500,
    machineHeat: 3600,
  });

  it('discounts the power twice for 2,100 K of surplus heat', () => {
    const result = calculateOverclock(volcanus);
    expect(result.heatDiscounts).toBe(2);
    expect(result.heatDiscountMultiplier).toBeCloseTo(0.9025, 12);
  });

  // 8,192 EU/t over a 3,119 EU/t draw is 2 by long division, and log4(2) is 0 —
  // the fraction is gone before the logarithm ever sees it
  it('finds no headroom, because the ratio truncates before log4', () => {
    expect(calculateOverclock(volcanus).tiersAbove).toBe(0);
    expect(calculateOverclock(volcanus).overclocks).toBe(0);
  });

  it('charges the ceiling of the modified draw', () => {
    // 480 x 8 x 0.9 x 0.9025 = 3,119.04
    expect(calculateOverclock(volcanus).euPerTick).toBe(3120);
  });

  it('truncates the sped-up duration to whole ticks', () => {
    // 200 / 2.2 = 90.909…
    expect(calculateOverclock(volcanus).durationTicks).toBe(90);
  });
});

describe('the Electric Blast Furnace — heat overclocks and discounts together', () => {
  // 120 EU/t over 600 ticks on one IV hatch, 5,400 K of coil against an
  // 1,800 K recipe
  const ebf = base({
    recipeEUt: 120,
    duration: 600,
    machineVoltage: 8192,
    amperageOC: true,
    heatOC: true,
    heatDiscount: true,
    recipeHeat: 1800,
    machineHeat: 5400,
  });

  it('takes four discount steps and two heat overclocks from the same surplus', () => {
    const result = calculateOverclock(ebf);
    // 3,600 K of surplus: four 900 K discounts, two 1,800 K overclocks
    expect(result.heatDiscounts).toBe(4);
    expect(result.heatOverclocks).toBe(2);
    expect(result.regularOverclocks).toBe(1);
    expect(result.overclocks).toBe(3);
  });

  it('charges every overclock but quarters the duration for the heat ones', () => {
    const result = calculateOverclock(ebf);
    // 120 x 0.95^4 = 97.74, then 4^3 for three overclocks
    expect(result.euPerTick).toBe(6256);
    // 600 / 4^2 / 2^1 = 18.75, truncated
    expect(result.durationTicks).toBe(18);
  });
});

describe('amperage overclocking', () => {
  // four LV hatches against a 32 EU/t recipe
  const fed = (amperageOC: boolean): OverclockInput =>
    base({
      recipeEUt: 32,
      machineVoltage: 32,
      machineAmperage: 4,
      duration: 100,
      amperageOC,
    });

  // this is the divergence from the old tier-ladder model: GT asks what the
  // power RATIO is, and 128 EU/t over 32 EU/t is a full overclock
  it('spends amps on overclocks when the machine allows it', () => {
    expect(calculateOverclock(fed(true)).overclocks).toBe(1);
  });

  // without it a machine may only draw as many amps as it runs parallels, so a
  // single-parallel recipe sees one amp
  it('ignores the extra amps when the machine does not', () => {
    expect(calculateOverclock(fed(false)).overclocks).toBe(0);
  });

  it('caps at the voltage tier gap when amperage overclocking is off', () => {
    // 512 EU/t over an 8 EU/t recipe at 4 parallels: the power ratio offers 3,
    // but HV is only two tiers above ULV
    const result = calculateOverclock(
      base({
        recipeEUt: 8,
        machineVoltage: 512,
        machineAmperage: 4,
        parallel: 4,
        amperageOC: false,
      }),
    );
    expect(result.tiersAbove).toBe(3);
    expect(result.overclocks).toBe(2);
    expect(result.clampedBy).toBe('voltageTier');
  });

  it('reports the cap when maxOverclocks is what bites', () => {
    const result = calculateOverclock(
      base({
        recipeEUt: 32,
        machineVoltage: 524288,
        amperageOC: true,
        maxOverclocks: 2,
      }),
    );
    expect(result.tiersAbove).toBe(7);
    expect(result.overclocks).toBe(2);
    expect(result.clampedBy).toBe('maxOverclocks');
  });
});

describe('a machine that cannot overclock at all', () => {
  // the one place a duration is rounded UP rather than truncated
  it('ceils the duration, where every other path truncates it', () => {
    const input = base({ duration: 75, durationModifier: 0.25 });
    expect(
      calculateOverclock({ ...input, noOverclock: true }).durationTicks,
    ).toBe(19);
    expect(calculateOverclock(input).durationTicks).toBe(18);
  });

  it('charges the recipe unchanged', () => {
    const result = calculateOverclock(base({ noOverclock: true }));
    expect(result.euPerTick).toBe(100);
    expect(result.overclocks).toBe(0);
    expect(result.clampedBy).toBe('noOverclock');
  });
});

describe('a machine colder than its recipe', () => {
  // GT never matches the recipe in this state, so the arithmetic below is
  // unreachable in game. It is pinned here because the port reproduces it
  // faithfully and the app layer — not this module — is what refuses to enter it
  const cold = base({
    recipeEUt: 32,
    machineVoltage: 524288,
    amperageOC: true,
    heatOC: true,
    heatDiscount: true,
    recipeHeat: 3600,
    machineHeat: 0,
  });

  it('makes the recipe cost more, not less', () => {
    const result = calculateOverclock(cold);
    expect(result.heatDiscounts).toBe(-4);
    expect(result.heatDiscountMultiplier).toBeGreaterThan(1);
  });

  it('hands out more regular overclocks than it performed', () => {
    const result = calculateOverclock(cold);
    expect(result.heatOverclocks).toBe(-2);
    expect(result.regularOverclocks).toBe(result.overclocks + 2);
  });
});

describe('laser overclocking', () => {
  it('spends plain overclocks first, then the escalating laser ones', () => {
    const result = calculateOverclock(
      base({
        recipeEUt: 1000,
        duration: 100,
        machineVoltage: 2097152,
        machineAmperage: 8,
        amperageOC: true,
        laserOC: true,
        maxRegularOverclocks: 3,
      }),
    );
    expect(result.regularOverclocks).toBe(3);
    // 4.3x, then 4.6x, then 4.9x — the fourth would exceed the supply
    expect(result.laserOverclocks).toBe(3);
    expect(result.overclocks).toBe(6);
    expect(result.durationTicks).toBe(1);
  });

  it('stops before an overclock would push a slice under one tick', () => {
    const result = calculateOverclock(
      base({
        recipeEUt: 1000,
        duration: 4,
        machineVoltage: 536870912,
        amperageOC: true,
        laserOC: true,
        maxRegularOverclocks: 1,
      }),
    );
    expect(result.regularOverclocks).toBe(1);
    expect(result.laserOverclocks).toBe(0);
    expect(result.durationTicks).toBe(2);
  });
});

describe('overclocking past the one tick floor', () => {
  // 32 EU/t over 20 ticks on a UV hatch: seven overclocks available, but a
  // recipe cannot run in less than a tick
  const compressed = base({
    recipeEUt: 32,
    duration: 20,
    machineVoltage: 524288,
    amperageOC: true,
  });

  it('charges for every overclock even when the duration floors at one tick', () => {
    const result = calculateOverclock(compressed);
    expect(result.overclocks).toBe(7);
    expect(result.durationTicks).toBe(1);
    expect(result.euPerTick).toBe(32 * 4 ** 7);
  });

  // this is what the old model got wrong: the compressed time is not wasted,
  // it becomes parallels
  it('turns the compression into a parallel multiplier', () => {
    expect(calculateMultiplierUnderOneTick(compressed)).toBe(7);
  });

  it('gives no multiplier when the recipe never reaches one tick', () => {
    expect(calculateMultiplierUnderOneTick(base())).toBe(1);
    expect(
      calculateMultiplierUnderOneTick(base({ noOverclock: true, duration: 1 })),
    ).toBe(1);
  });
});
