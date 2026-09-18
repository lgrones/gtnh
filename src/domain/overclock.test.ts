import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HATCH_AMPS,
  type EnergyHatch,
  type MultiblockRecipeData,
  type RecipeNodeData,
  type SingleblockRecipeData,
  type VoltageTier,
} from '@/contexts/productionStore';

import {
  basePower,
  hatchSupply,
  hatchVoltage,
  overclock,
  recipeTier,
  suppliedPower,
  suppliedTier,
  tierAbove,
} from './overclock';

// Every expectation here was worked through by hand against GT 5.09.51.482
// before it was written down, the same way the kernel tests were. Where a
// number came out of the game's own quirks — a truncating long division, a
// duration floored to whole ticks — the comment says so, because a test that
// merely records what the code does would have nothing to catch.

const hatch = (
  tier: VoltageTier,
  count = 1,
  amps = DEFAULT_HATCH_AMPS,
): EnergyHatch => ({ tier, count, amps });

const multi = (patch: Partial<MultiblockRecipeData> = {}): RecipeNodeData =>
  ({
    name: 'Recipe',
    kind: 'multi',
    machine: 'Vacuum Freezer',
    inputs: [],
    outputs: [],
    hatches: [hatch('HV')],
    amperage: 1,
    multiplier: 1,
    // 128 EU/t over 1,200 ticks
    eu: 153600,
    time: 60,
    ...patch,
  }) as RecipeNodeData;

const single = (patch: Partial<SingleblockRecipeData> = {}): RecipeNodeData =>
  ({
    name: 'Recipe',
    kind: 'single',
    machine: 'Macerator',
    inputs: [],
    outputs: [],
    voltage: 'HV',
    amperage: 1,
    multiplier: 1,
    // 30 EU/t over 200 ticks
    eu: 6000,
    time: 10,
    ...patch,
  }) as RecipeNodeData;

describe('tier lookup', () => {
  it('maps a recipe to the lowest tier that can carry it', () => {
    expect(recipeTier(8)).toBe('ULV');
    expect(recipeTier(32)).toBe('LV');
    expect(recipeTier(33)).toBe('MV');
    expect(recipeTier(1e12)).toBe('MAX');
  });

  it('maps a supply to the highest tier it fully covers', () => {
    expect(suppliedTier(31)).toBe('ULV');
    expect(suppliedTier(32)).toBe('LV');
    expect(suppliedTier(127)).toBe('LV');
  });

  it('walks one step up the ladder and stops at the top', () => {
    expect(tierAbove('LV')).toBe('MV');
    expect(tierAbove('MAX')).toBeUndefined();
  });

  it('turns a recipe total into a draw', () => {
    expect(basePower(153600, 60)).toBe(128);
    expect(basePower(100, 0)).toBe(0);
  });
});

// The single correction that matters most: hatch voltages do NOT simply add up
// into the EU/t a machine may spend. GT keeps three numbers here and the old
// model conflated them.
describe('hatchSupply — GT’s three separate quantities', () => {
  it('gives a lone hatch one amp, per GT’s useSingleAmp rule', () => {
    expect(hatchSupply([hatch('LV')])).toMatchObject({
      voltage: 32,
      amps: 1,
      eut: 32,
    });
  });

  it('gives two hatches four amps — 2 A each, not one between them', () => {
    expect(hatchSupply([hatch('LV', 2)])).toMatchObject({
      voltage: 32,
      amps: 4,
      eut: 128,
    });
  });

  it('scales with hatch count, so four LV hatches deliver 256 EU/t', () => {
    // the old model said 128 for this, having summed the voltages
    expect(hatchSupply([hatch('LV', 4)]).eut).toBe(256);
  });

  it('averages the voltage across a mixed bank, and floors it', () => {
    // (32 + 128 + 128) / 3 = 96, and 3 hatches x 2 A = 6
    const supply = hatchSupply([hatch('LV'), hatch('MV', 2)]);
    expect(supply.voltage).toBe(96);
    expect(supply.amps).toBe(6);
    expect(supply.eut).toBe(576);
  });

  it('keeps the summed voltage separate — that is what parallel formulas read', () => {
    expect(hatchVoltage([hatch('LV', 4)])).toBe(128);
    expect(hatchSupply([hatch('LV', 4)]).maxVoltage).toBe(128);
  });

  it('does not collapse a lone exotic hatch to one amp', () => {
    // a laser hatch carries far more than 2 A, and GT's rule asks whether any
    // exotic hatch is fitted — the amp count is the only signal we have
    expect(hatchSupply([hatch('UV', 1, 256)])).toMatchObject({
      amps: 256,
      eut: 524288 * 256,
    });
  });

  it('survives a missing or empty hatch list', () => {
    expect(hatchSupply(undefined).eut).toBe(0);
    expect(hatchSupply([]).eut).toBe(0);
    expect(hatchSupply([hatch('LV', 0)]).eut).toBe(0);
  });

  it('feeds a singleblock from its own tier at one amp', () => {
    expect(suppliedPower(single({ voltage: 'HV' }))).toBe(512);
    expect(suppliedPower(multi({ hatches: [hatch('HV')] }))).toBe(512);
  });
});

describe('a plain multiblock', () => {
  // 128 EU/t against one HV hatch: 512 / 128 = 4, and log4(4) is one overclock
  it('takes the overclock the power ratio offers', () => {
    const result = overclock(multi());
    expect(result.oc.total).toBe(1);
    expect(result.oc.regular).toBe(1);
    expect(result.power).toBe(512);
    expect(result.time).toBe(30);
    expect(result.parallels).toBe(1);
    expect(result.parallel.limitedBy).toBe('machine');
  });

  it('runs at one parallel, because GT’s base class returns 1', () => {
    const result = overclock(multi());
    expect(result.machine.name).toBe('Vacuum Freezer');
    expect(result.parallel.machineCap).toBe(1);
    expect(result.parallel.powerCap).toBe(4);
  });

  it('leaves the figures as entered when the hatches cannot pay for one recipe', () => {
    const result = overclock(multi({ hatches: [hatch('LV')] }));
    expect(result.underpowered).toBe(true);
    expect(result.ranAsEntered).toBe(true);
    expect(result.power).toBe(128);
    expect(result.time).toBe(60);
    expect(result.supply).toBe('LV');
    expect(result.demand).toBe('MV');
    // the kernel says nothing runs; the planner still scales item I/O by one,
    // so an underpowered node does not silently empty the lines below it
    expect(result.parallel.running).toBe(0);
    expect(result.parallels).toBe(1);
  });

  it('calculates nothing for a node with no recipe in it yet', () => {
    const result = overclock(multi({ eu: 0, time: 0 }));
    expect(result.ranAsEntered).toBe(true);
    expect(result.underpowered).toBe(false);
    expect(result.power).toBe(0);
  });
});

// The biggest correction to the old model. Overclocks past the one-tick floor
// are not wasted: ParallelHelper multiplies the machine's cap by them.
describe('sub-tick parallels', () => {
  // 32 EU/t over 20 ticks on one UV hatch. 524,288 / 32 is 16,384 = 4^7, and
  // seven overclocks against a 20 tick recipe leave a x7 multiplier
  const subTick = multi({ hatches: [hatch('UV')], eu: 640, time: 1 });

  it('turns overclocks the tick floor cannot spend into parallels', () => {
    const result = overclock(subTick);
    expect(result.parallel.subTick).toBe(7);
    expect(result.parallel.effectiveCap).toBe(7);
    expect(result.parallels).toBe(7);
  });

  it('counts none of them as wasted — the machine ran them as parallels', () => {
    const result = overclock(subTick);
    expect(result.oc.wasted).toBe(0);
    expect(result.oc.floored).toBe(0);
  });

  it('re-overclocks against the parallel draw, and floors at one tick', () => {
    const result = overclock(subTick);
    // 32 x 7 = 224 EU/t of recipe, which only leaves five overclocks
    expect(result.oc.total).toBe(5);
    expect(result.power).toBe(229376);
    expect(result.durationTicks).toBe(1);
    expect(result.power).toBeLessThanOrEqual(result.availableEUt);
  });
});

describe('Volcanus — the full modifier stack', () => {
  // 480 EU/t over 100 ticks on one IV hatch, Cupronickel coils (1,801 K)
  // against a 0 K recipe: two 900 K discount steps
  const volcanus = multi({
    machine: 'Volcanus',
    hatches: [hatch('IV')],
    eu: 480 * 100,
    time: 5,
  });

  it('runs its declared eight parallels', () => {
    const result = overclock(volcanus);
    expect(result.parallel.machineCap).toBe(8);
    expect(result.parallels).toBe(8);
    expect(result.parallel.limitedBy).toBe('machine');
  });

  it('gets no overclock at all, because the long division truncates to 2', () => {
    const result = overclock(volcanus);
    // 480 x 8 x 0.9 x 0.95^2 = 3,119.04, and 8,192 / 3,119 is 2 by integer
    // division. log4(2) is 0 — four times the draw is not a tier of headroom
    expect(result.heat.discounts).toBe(2);
    expect(result.oc.available).toBe(0);
    expect(result.oc.total).toBe(0);
    expect(result.power).toBe(3120); // GT ceils what it charges
  });

  it('applies its 1/2.2 duration modifier before anything else', () => {
    // 100 / 2.2 = 45.45 ticks, truncated
    expect(overclock(volcanus).durationTicks).toBe(45);
  });
});

describe('a parallel formula read off the hatches', () => {
  // 6 x tier, and `tier` is the SUMMED hatch voltage: 4 EV hatches sum to
  // 8,192, which is IV, which GT numbers 5
  const centrifuge = multi({
    machine: 'Industrial Centrifuge',
    hatches: [hatch('EV', 4)],
    eu: 6000,
    time: 10,
  });

  it('reads the summed voltage, not the average the calculator is fed', () => {
    const result = overclock(centrifuge);
    expect(result.parallel.machineCap).toBe(30);
    expect(result.availableEUt).toBe(16384); // 2,048 average x 8 A
    expect(result.parallels).toBe(30);
  });

  it('spends the headroom the parallel draw leaves', () => {
    const result = overclock(centrifuge);
    // 30 x 30 x 0.9 = 810 EU/t, and 16,384 / 810 is 20, so log4 gives 2
    expect(result.oc.total).toBe(2);
    expect(result.power).toBe(12960);
    // 200 / 2.25 = 88.88 ticks, then two halvings
    expect(result.durationTicks).toBe(22);
  });

  it('honours a ceiling set on the node', () => {
    const result = overclock(
      multi({
        machine: 'Industrial Centrifuge',
        hatches: [hatch('EV', 4)],
        eu: 6000,
        time: 10,
        parallelLimit: 5,
      }),
    );
    expect(result.parallels).toBe(5);
    expect(result.parallel.limitedBy).toBe('node');
  });
});

describe('a perfect-overclock machine', () => {
  // the LCR sets durationDecreasePerOC to 4: same 4x power, four times the
  // speed, which is what makes its total energy cost flat
  const lcr = multi({
    machine: 'Large Chemical Reactor',
    hatches: [hatch('HV')],
    eu: 6000,
    time: 10,
  });

  it('quarters the duration per overclock instead of halving it', () => {
    const result = overclock(lcr);
    expect(result.machine.durationDecreasePerOC).toBe(4);
    expect(result.oc.total).toBe(2);
    expect(result.power).toBe(480);
    expect(result.durationTicks).toBe(12); // 200 / 16 = 12.5, truncated
  });

  it('costs the same total energy as it did unoverclocked', () => {
    const result = overclock(lcr);
    // 30 x 200 = 6,000 EU, and 480 x 12.5 is the same — the truncation to 12
    // whole ticks is the only difference, and it is the game's
    expect(result.power * 12.5).toBe(6000);
  });
});

describe('the EBF — heat discounts and heat overclocks off one surplus', () => {
  // HSS-G coils at 5,401 K, plus GT's 100 K per tier above MV, on one IV
  // hatch: 5,401 + 100 x (5 - 2) = 5,701 K against an 1,800 K recipe
  const ebf = multi({
    machine: 'Electric Blast Furnace',
    hatches: [hatch('IV')],
    config: { coil: 'hss_g' },
    recipeHeat: 1800,
    eu: 120 * 600,
    time: 30,
  });

  it('derives the machine heat from the coil and the hatch tier', () => {
    expect(overclock(ebf).heat.machine).toBe(5701);
  });

  it('takes four 900 K discounts and two 1,800 K overclocks from 3,901 K', () => {
    const result = overclock(ebf);
    expect(result.heat.discounts).toBe(4);
    expect(result.oc.heat).toBe(2);
    expect(result.oc.regular).toBe(1);
  });

  it('charges every overclock but quarters the duration for the heat ones', () => {
    const result = overclock(ebf);
    // 120 x 0.95^4 = 97.74, then 4^3; the duration takes 4^2 then 2^1
    expect(result.power).toBe(6256);
    expect(result.durationTicks).toBe(18); // 600 / 16 / 2 = 18.75, truncated
  });

  it('leaves a colder machine’s figures exactly as entered', () => {
    // GT would never match the recipe at all, and the kernel's heat divisions
    // go negative below it — so the facade gates what the kernel faithfully
    // does not
    const cold = overclock(
      multi({
        machine: 'Electric Blast Furnace',
        hatches: [hatch('IV')],
        config: { coil: 'cupronickel' },
        recipeHeat: 9000,
        eu: 120 * 600,
        time: 30,
      }),
    );
    expect(cold.underheated).toBe(true);
    expect(cold.ranAsEntered).toBe(true);
    expect(cold.heat.sufficient).toBe(false);
    expect(cold.power).toBe(120);
    expect(cold.durationTicks).toBe(600);
  });

  it('falls back to the declared default coil when the config is empty', () => {
    const result = overclock(
      multi({
        machine: 'Electric Blast Furnace',
        hatches: [hatch('IV')],
        recipeHeat: 1800,
        eu: 120 * 600,
        time: 30,
      }),
    );
    // Cupronickel, 1,801 + 300
    expect(result.heat.machine).toBe(2101);
  });
});

describe('a machine the catalog has never heard of', () => {
  const stranger = multi({ machine: 'Ender Quarry' });

  it('says so rather than pretending', () => {
    const result = overclock(stranger);
    expect(result.machine.known).toBe(false);
    expect(result.machine.notes).toContain('Not in the machine catalog');
  });

  it('still runs GT’s plain rules at one parallel', () => {
    const result = overclock(stranger);
    expect(result.parallel.machineCap).toBe(1);
    expect(result.oc.total).toBe(1);
    expect(result.power).toBe(512);
  });

  it('resolves a name by alias and by loose spelling', () => {
    expect(overclock(multi({ machine: 'LCR' })).machine.name).toBe(
      'Large Chemical Reactor',
    );
    expect(overclock(multi({ machine: 'vacuum  freezer' })).machine.name).toBe(
      'Vacuum Freezer',
    );
  });
});

// Decision 8: this is where the live data actually is, and single blocks never
// touch ParallelHelper or the catalog.
describe('a singleblock', () => {
  it('overclocks against its own tier at one amp', () => {
    const result = overclock(single());
    // 512 / max(30, 32) = 16, so two overclocks
    expect(result.oc.total).toBe(2);
    expect(result.power).toBe(480);
    expect(result.durationTicks).toBe(50); // 200 / 2^2
    expect(result.parallels).toBe(1);
  });

  it('never runs parallels, whatever tier it is', () => {
    const result = overclock(single({ voltage: 'UV' }));
    expect(result.parallel.machineCap).toBe(1);
    expect(result.parallel.subTick).toBe(1);
    expect(result.parallels).toBe(1);
  });

  it('is capped by voltage tiers, because it does not overclock across amps', () => {
    // 2,048 / max(30, 32) = 64, which log4 reads as three overclocks, but an
    // EV machine sits only three tiers above a 30 EU/t recipe's LV
    const result = overclock(single({ voltage: 'EV' }));
    expect(result.oc.available).toBe(3);
    expect(result.oc.total).toBe(3);
    expect(result.oc.clampedBy).toBe('none');
  });

  it('counts the overclocks the one tick floor swallows as pure waste', () => {
    // 128 EU/t over 20 ticks on UV: six overclocks are charged for, and the
    // duration reaches the floor after five. a multiblock would have turned
    // the sixth into a parallel; a singleblock just pays for it
    const result = overclock(single({ voltage: 'UV', eu: 2560, time: 1 }));
    expect(result.oc.total).toBe(6);
    expect(result.oc.floored).toBe(1);
    expect(result.parallel.subTick).toBe(1);
    expect(result.durationTicks).toBe(1);
  });

  it('reports being underpowered rather than overclocking backwards', () => {
    // 64 EU/t in an LV machine, which can only deliver 32
    const result = overclock(single({ voltage: 'LV', eu: 12800, time: 10 }));
    expect(result.underpowered).toBe(true);
    expect(result.power).toBe(64);
    expect(result.durationTicks).toBe(200);
  });

  it('is never reported as an unmodelled machine', () => {
    const result = overclock(single({ machine: 'Not A Real Machine' }));
    expect(result.machine.known).toBe(true);
    expect(result.machine.modeled).toBe(true);
  });
});

describe('memoisation', () => {
  it('returns the same object for the same node data', () => {
    const data = multi();
    expect(overclock(data)).toBe(overclock(data));
  });

  it('recomputes for a new object with the same contents', () => {
    expect(overclock(multi())).not.toBe(overclock(multi()));
    expect(overclock(multi()).power).toBe(overclock(multi()).power);
  });
});
