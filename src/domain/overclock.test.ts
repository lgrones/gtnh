import { describe, expect, it } from 'vitest';

import {
  type EnergyHatch,
  type RecipeNodeData,
  type VoltageTier,
} from '@/contexts/productionStore';

import {
  hatchPower,
  overclock,
  recipeTier,
  suppliedPower,
  suppliedTier,
} from './overclock';

// the wiki's overclock example: 128 EU/t for 60s = 153,600 EU total, fed one
// tier above the MV it requires
const recipe = (
  patch: Partial<RecipeNodeData> & { hatches?: EnergyHatch[] } = {},
): RecipeNodeData =>
  ({
    name: 'Recipe',
    kind: 'multi',
    machine: 'Vacuum Freezer', // imperfect
    inputs: [],
    outputs: [],
    hatches: [{ tier: 'HV', count: 1 }],
    multiplier: 1,
    eu: 153600,
    time: 60,
    ...patch,
  }) as RecipeNodeData;

// one group of identical hatches, the normal build
const fed = (tier: VoltageTier, count = 1) => ({ hatches: [{ tier, count }] });

// a singleblock is powered by its own tier, never by hatches
const singleblock = (
  patch: {
    voltage?: VoltageTier;
    amperage?: number;
  } & Partial<RecipeNodeData> = {},
): RecipeNodeData =>
  ({
    name: 'Recipe',
    kind: 'single',
    machine: 'Macerator',
    inputs: [],
    outputs: [],
    voltage: 'HV',
    amperage: 1,
    multiplier: 1,
    eu: 153600,
    time: 60,
    ...patch,
  }) as RecipeNodeData;

describe('tier lookup', () => {
  it('maps a recipe to the lowest tier that can carry it', () => {
    expect(recipeTier(128)).toBe('MV');
    expect(recipeTier(129)).toBe('HV');
    expect(recipeTier(8)).toBe('ULV');
  });

  it('sums a multiblock hatches, so 4 LV hatches is 1A of MV', () => {
    expect(hatchPower([{ tier: 'LV', count: 4 }])).toBe(128);
    expect(suppliedTier(hatchPower([{ tier: 'LV', count: 4 }]))).toBe('MV');
  });

  it('sums mixed hatch tiers', () => {
    expect(
      hatchPower([
        { tier: 'LV', count: 2 },
        { tier: 'MV', count: 1 },
      ]),
    ).toBe(192);
  });

  it('ignores amperage on a singleblock, which needs a higher tier machine', () => {
    expect(suppliedPower(singleblock({ voltage: 'LV', amperage: 4 }))).toBe(32);
  });

  it('reports the highest tier fully covered, not the next one up', () => {
    expect(suppliedTier(511)).toBe('MV');
    expect(suppliedTier(512)).toBe('HV');
  });
});

describe('imperfect overclocks', () => {
  it('halves the time and quadruples the power per step', () => {
    const result = overclock(recipe());

    expect(result.mode).toBe('imperfect');
    expect(result.steps).toBe(1);
    expect(result.power).toBe(512);
    expect(result.time).toBe(30);
  });

  it('doubles the recipe total energy, as the wiki notes', () => {
    const result = overclock(recipe());
    expect(result.power * result.time * 20).toBe(153600 * 2);
  });

  it('applies both steps when fed two tiers above the recipe', () => {
    const result = overclock(recipe(fed('EV')));

    expect(result.steps).toBe(2);
    expect(result.power).toBe(128 * 16);
    expect(result.time).toBe(15);
  });
});

describe('perfect overclocks', () => {
  it('quarters the time and quadruples the power per step', () => {
    const result = overclock(recipe({ machine: 'Large Chemical Reactor' }));

    expect(result.mode).toBe('perfect');
    expect(result.steps).toBe(1);
    expect(result.power).toBe(512);
    expect(result.time).toBe(15);
  });

  it('leaves the recipe total energy unchanged', () => {
    const result = overclock(recipe({ machine: 'Large Chemical Reactor' }));
    expect(result.power * result.time * 20).toBe(153600);
  });
});

describe('singleblock overclocks', () => {
  it('overclocks off the machine tier, like any other machine', () => {
    const result = overclock(singleblock());

    expect(result.mode).toBe('imperfect');
    expect(result.steps).toBe(1);
    expect(result.power).toBe(512);
    expect(result.time).toBe(30);
  });

  it('does not overclock at the recipe tier', () => {
    const result = overclock(singleblock({ voltage: 'MV' }));

    expect(result.steps).toBe(0);
    expect(result.power).toBe(128);
    expect(result.time).toBe(60);
  });

  it('gains nothing from extra amperage', () => {
    const result = overclock(singleblock({ voltage: 'MV', amperage: 8 }));

    expect(result.steps).toBe(0);
    expect(result.power).toBe(128);
  });

  it('never gains parallels — its leftover steps are simply lost', () => {
    // 1s = 20 ticks; imperfect halving fits 4 steps, 6 tiers are available
    const result = overclock(singleblock({ eu: 2560, time: 1, voltage: 'UV' }));

    expect(result.steps).toBe(4);
    expect(result.surplus).toBe(2);
    expect(result.parallels).toBe(1);
    expect(result.power).toBe(128 * 4 ** 4);
  });
});

describe('parallels', () => {
  // the wiki's Volcanus example, after its 90% energy discount: 1,800 EU/t over
  // 16s with 8 parallels. run on a perfect machine so one mode covers both steps
  const volcanus = (patch: Partial<RecipeNodeData> = {}) =>
    recipe({
      machine: 'Large Chemical Reactor',
      eu: 1800 * 16 * 20,
      time: 16,
      parallels: 8,
      ...patch,
    });

  it('multiplies power by the parallel count without changing the duration', () => {
    // 8 EV hatches = 16,384 EU/t: enough for 8 parallels, not to overclock
    const result = overclock(volcanus(fed('EV', 8)));

    expect(result.parallels).toBe(8);
    expect(result.steps).toBe(0);
    expect(result.power).toBe(8 * 1800);
    expect(result.time).toBe(16);
  });

  it('keeps the total energy per recipe unchanged, unlike an imperfect step', () => {
    const one = overclock(volcanus({ ...fed('EV', 8), parallels: 1 }));
    const eight = overclock(volcanus(fed('EV', 8)));

    const perRecipe = (x: ReturnType<typeof overclock>) =>
      (x.power * x.time) / x.parallels;
    expect(perRecipe(eight)).toBe(perRecipe(one));
  });

  it('follows base x parallels x 4^oc once there is power for both', () => {
    const result = overclock(volcanus(fed('UV')));

    expect(result.parallels).toBe(8);
    expect(result.steps).toBe(2);
    expect(result.power).toBe(1800 * 8 * 4 ** 2);
    expect(result.time).toBe(1);
  });

  it('runs only as many parallels as the supply can power', () => {
    // 3 EV hatches = 6,144 EU/t, which covers three of the eight offered
    const result = overclock(volcanus(fed('EV', 3)));

    expect(result.parallels).toBe(3);
    expect(result.power).toBe(3 * 1800);
  });

  it('reports the entered count alongside the affordable one', () => {
    const capped = overclock(volcanus(fed('EV', 3)));
    expect(capped.offeredParallels).toBe(8);
    expect(capped.parallels).toBe(3);

    const paid = overclock(volcanus(fed('EV', 8)));
    expect(paid.offeredParallels).toBe(8);
    expect(paid.parallels).toBe(8);
  });

  it('never runs more parallels than the node was told to, however fed', () => {
    // 1s = 20 ticks at 128 EU/t against a UV hatch: four steps fit the
    // duration and two more are affordable, but one parallel is one parallel.
    // spare power cannot conjure the items a second concurrent recipe eats
    const result = overclock(
      recipe({ eu: 2560, time: 1, parallels: 1, ...fed('UV') }),
    );

    expect(result.parallels).toBe(1);
    expect(result.steps).toBe(4);
    expect(result.surplus).toBe(2);
    expect(result.power).toBe(128 * 4 ** 4);
  });

  it('runs the entered parallels and reports the steps it could not use', () => {
    // the same node at four parallels: they are bought up front at 1x power
    // each, which is what raises the recipe to HV and eats an overclock step
    const result = overclock(
      recipe({ eu: 2560, time: 1, parallels: 4, ...fed('UV') }),
    );

    expect(result.parallels).toBe(4);
    expect(result.recipe).toBe('HV');
    expect(result.steps).toBe(4);
    expect(result.surplus).toBe(1);
    expect(result.power).toBe(128 * 4 * 4 ** 4);
  });
});

describe('machines that do not overclock', () => {
  it('leaves a `none` machine untouched', () => {
    const result = overclock(recipe({ machine: 'TFFT' }));

    expect(result.mode).toBe('none');
    expect(result.steps).toBe(0);
    expect(result.power).toBe(128);
    expect(result.time).toBe(60);
  });

  it('leaves a `unique` machine at the values the user entered', () => {
    const result = overclock(recipe({ machine: 'Eye of Harmony' }));

    expect(result.mode).toBe('unique');
    expect(result.steps).toBe(0);
    expect(result.time).toBe(60);
  });

  it('ignores parallels on a machine that cannot overclock', () => {
    const result = overclock(recipe({ machine: 'TFFT', parallels: 8 }));
    expect(result.parallels).toBe(1);
  });
});

describe('mixed machines', () => {
  it('defaults to imperfect', () => {
    const result = overclock(recipe({ machine: 'Electric Blast Furnace' }));

    expect(result.mode).toBe('imperfect');
    expect(result.time).toBe(30);
  });

  it('honours a per-node perfect override', () => {
    const result = overclock(
      recipe({ machine: 'Electric Blast Furnace', overclock: 'perfect' }),
    );

    expect(result.mode).toBe('perfect');
    expect(result.time).toBe(15);
  });

  it('ignores the override on a machine that is not mixed', () => {
    const result = overclock(recipe({ overclock: 'perfect' }));

    expect(result.mode).toBe('imperfect');
    expect(result.time).toBe(30);
  });
});

describe('underpowered machines', () => {
  it('flags a supply that cannot even run the recipe unoverclocked', () => {
    const result = overclock(recipe(fed('LV'))); // 32 EU/t

    expect(result.underpowered).toBe(true);
    expect(result.steps).toBe(0);
    expect(result.parallels).toBe(1);
    expect(result.power).toBe(128);
  });

  it('does not flag a supply that exactly meets the requirement', () => {
    const result = overclock(recipe(fed('MV')));

    expect(result.underpowered).toBe(false);
    expect(result.steps).toBe(0);
  });
});

describe('machines outside the catalog', () => {
  it('assumes imperfect, the standard behaviour of most multiblocks', () => {
    const result = overclock(recipe({ machine: 'Some Modded Multi' }));

    expect(result.mode).toBe('imperfect');
    expect(result.steps).toBe(1);
  });
});

describe('amperage only overclocks when it reaches a tier', () => {
  // 30 EU/t base with 5 parallels draws 150 EU/t, an HV requirement
  const parallel = (patch: Partial<RecipeNodeData> = {}) =>
    recipe({ eu: 30 * 10 * 20, time: 10, parallels: 5, ...patch });

  it('does not overclock on 2 HV hatches — 1,024 EU/t is still HV', () => {
    const result = overclock(parallel(fed('HV', 2)));

    expect(result.parallels).toBe(5);
    expect(result.recipe).toBe('HV');
    expect(result.supplied).toBe('HV'); // 1,024 does not reach EV's 2,048
    expect(result.steps).toBe(0);
    expect(result.power).toBe(150);
  });

  it('overclocks on 4 HV hatches, which do reach EV', () => {
    const result = overclock(parallel(fed('HV', 4)));

    expect(result.supplied).toBe('EV');
    expect(result.steps).toBe(1);
    expect(result.power).toBe(600);
    expect(result.time).toBe(5);
  });

  it('reproduces the EBF trick: 4 LV hatches are exactly 1A of MV', () => {
    const result = overclock(
      recipe({ eu: 32 * 10 * 20, time: 10, ...fed('LV', 4) }),
    );

    expect(result.supplied).toBe('MV');
    expect(result.recipe).toBe('LV');
    expect(result.steps).toBe(1);
  });
});

describe('recipe amperage', () => {
  it('never affects a multiblock overclock — hatches decide the supply', () => {
    const plain = overclock(recipe({ amperage: 1 }));
    const heavy = overclock(recipe({ amperage: 3 }));

    expect(heavy.steps).toBe(plain.steps);
    expect(heavy.power).toBe(plain.power);
    expect(heavy.supplied).toBe(plain.supplied);
  });
});
