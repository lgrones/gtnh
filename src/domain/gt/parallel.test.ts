import { describe, expect, it } from 'vitest';

import { determineParallel, type ParallelInput } from './parallel';

const base = (patch: Partial<ParallelInput> = {}): ParallelInput => ({
  machineMaxParallel: 1,
  recipeEUt: 32,
  availableEUt: 32,
  ...patch,
});

describe('the recipe draw the clamps are measured against', () => {
  it('rounds the modified draw up, as GT charges it', () => {
    // 120 EU/t discounted by four heat steps is 97.74, and the machine pays 98
    const result = determineParallel(
      base({
        recipeEUt: 120,
        heatDiscountMultiplier: 0.95 ** 4,
        availableEUt: 8192,
      }),
    );
    expect(result.recipeEUt).toBe(98);
  });

  it('applies the machine EU modifier as well as the heat discount', () => {
    expect(
      determineParallel(
        base({ recipeEUt: 480, eutModifier: 0.9, availableEUt: 8192 }),
      ).recipeEUt,
    ).toBe(432);
  });
});

describe('a machine that cannot pay for one recipe', () => {
  it('runs nothing and says why', () => {
    const result = determineParallel(
      base({ recipeEUt: 480, availableEUt: 100 }),
    );
    expect(result.running).toBe(0);
    expect(result.insufficientPower).toBe(true);
  });

  it('is not the same as a machine with no parallels declared', () => {
    const result = determineParallel(base({ machineMaxParallel: 0 }));
    expect(result.running).toBe(0);
    expect(result.insufficientPower).toBe(false);
  });
});

describe('the sub-tick multiplier', () => {
  // it is applied before every other clamp, so it multiplies straight past the
  // controller's declared cap — a one-parallel machine really does run seven
  it('multiplies past the declared cap', () => {
    const result = determineParallel(
      base({
        machineMaxParallel: 1,
        subTickMultiplier: 7,
        availableEUt: 524288,
      }),
    );
    expect(result.effectiveCap).toBe(7);
    expect(result.running).toBe(7);
    expect(result.limitedBy).toBe('machine');
  });

  // machines with their own base-duration rule divide instead of multiplying
  it('divides by a custom duration supplier below one tick', () => {
    expect(
      determineParallel(
        base({
          machineMaxParallel: 2,
          durationUnderOneTick: 0.25,
          availableEUt: 524288,
        }),
      ).effectiveCap,
    ).toBe(8);
  });

  it('leaves the cap alone when that supplier is at or above one tick', () => {
    expect(
      determineParallel(
        base({
          machineMaxParallel: 2,
          durationUnderOneTick: 2,
          availableEUt: 524288,
        }),
      ).effectiveCap,
    ).toBe(2);
  });
});

describe('the clamps, and which one is reported', () => {
  // 2,048 EU/t buys four of a 432 EU/t recipe, not four and a half
  const powerBound = base({
    machineMaxParallel: 8,
    recipeEUt: 480,
    eutModifier: 0.9,
    availableEUt: 2048,
  });

  it('floors the parallels the supply can pay for', () => {
    const result = determineParallel(powerBound);
    expect(result.powerCap).toBe(4);
    expect(result.running).toBe(4);
    expect(result.limitedBy).toBe('power');
  });

  it('reports a node limit ahead of anything the game imposed', () => {
    const result = determineParallel({ ...powerBound, nodeLimit: 2 });
    expect(result.running).toBe(2);
    expect(result.limitedBy).toBe('node');
  });

  it('reports the input bound when that is what binds', () => {
    const result = determineParallel({ ...powerBound, inputLimit: 3 });
    expect(result.running).toBe(3);
    expect(result.limitedBy).toBe('input');
  });

  // when the machine's own cap and the supply agree, more hatches would buy
  // nothing — so the cap is the honest answer
  it('blames the machine when its cap ties with the supply', () => {
    const result = determineParallel(
      base({ machineMaxParallel: 4, recipeEUt: 32, availableEUt: 128 }),
    );
    expect(result.powerCap).toBe(4);
    expect(result.running).toBe(4);
    expect(result.limitedBy).toBe('machine');
  });
});
