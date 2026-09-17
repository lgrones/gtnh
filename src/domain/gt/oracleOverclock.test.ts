import { describe, expect, it } from 'vitest';

import { findMachine, resolveMachine } from '../machines/catalog';
import { RECIPE_TIER_EU, RECIPE_TIERS, type RecipeTier } from '../tiers';
import fixture from './__fixtures__/oracleOverclock.json';
import { calculateOverclock } from './overclockCalculator';

// Every row here is GregTech's own answer, taken from a headless GTNH client —
// see the fixture's `source` block and tools/buildOracleFixture.mjs. Reading the
// Java tells us what the class says; only this tells us we read it right.

const tierOf = (tier: string): RecipeTier => {
  const found = RECIPE_TIERS.find(candidate => candidate === tier);
  if (found === undefined)
    throw new Error(`fixture names an unknown tier: ${tier}`);
  return found;
};

const tierEU = (tier: string): number => RECIPE_TIER_EU[tierOf(tier)];

// GTUtility.getTier numbers the ladder from ULV at 0, which is the order
// RECIPE_TIERS is already in
const tierIndex = (tier: string): number => RECIPE_TIERS.indexOf(tierOf(tier));

const EBF = findMachine('Electric Blast Furnace');

describe('the GTNH oracle', () => {
  it('has rows to check', () => {
    expect(fixture.plain.length).toBeGreaterThan(1000);
    expect(fixture.heat.length).toBeGreaterThan(500);
  });

  it('agrees on the plain overclock ladder', () => {
    const wrong: string[] = [];
    for (const [
      recipeEUt,
      duration,
      tier,
      euPerTick,
      durationTicks,
    ] of fixture.plain) {
      const got = calculateOverclock({
        recipeEUt: recipeEUt as number,
        machineVoltage: tierEU(tier as string),
        machineAmperage: 1,
        duration: duration as number,
      });
      if (got.euPerTick !== euPerTick || got.durationTicks !== durationTicks) {
        wrong.push(
          `${recipeEUt}EU/t ${duration}t @${tier}: ours ${got.euPerTick}/${got.durationTicks}, GT ${euPerTick}/${durationTicks}`,
        );
      }
    }
    expect(wrong.slice(0, 10)).toEqual([]);
  });

  // The EBF's own two mechanics: 0.95 off the draw per 900 K of surplus heat,
  // and a perfect overclock per 1800 K of it. The machine's heat is not the
  // coil's — `MTEElectricBlastFurnace` adds 100 K per voltage tier above MV —
  // so this runs through the catalog and checks that formula at the same time.
  it('agrees on the blast furnace heat matrix', () => {
    const wrong: string[] = [];
    for (const [
      recipeEUt,
      duration,
      recipeHeat,
      coil,
      tier,
      euPerTick,
      durationTicks,
    ] of fixture.heat) {
      const machine = resolveMachine(
        EBF,
        { coil: coil as string },
        {
          tier: tierIndex(tier as string),
          amps: 1,
          recipe: {
            heat: recipeHeat as number,
            eut: recipeEUt as number,
            duration: duration as number,
          },
        },
      );
      const got = calculateOverclock({
        recipeEUt: recipeEUt as number,
        machineVoltage: tierEU(tier as string),
        machineAmperage: 1,
        duration: duration as number,
        recipeHeat: recipeHeat as number,
        machineHeat: machine.machineHeat,
        heatOC: machine.heatOC,
        heatDiscount: machine.heatDiscount,
        heatDiscountExponent: machine.heatDiscountExponent,
      });
      if (got.euPerTick !== euPerTick || got.durationTicks !== durationTicks) {
        wrong.push(
          `${recipeEUt}EU/t ${duration}t heat ${recipeHeat} on ${coil} @${tier}: ours ${got.euPerTick}/${got.durationTicks}, GT ${euPerTick}/${durationTicks}`,
        );
      }
    }
    expect(wrong.slice(0, 10)).toEqual([]);
  });
});
