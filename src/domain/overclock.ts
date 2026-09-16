import {
  DEFAULT_HATCH_AMPS,
  type EnergyHatch,
  type RecipeNodeData,
} from '@/contexts/productionStore/types';

import {
  calculateHeatDiscountMultiplier,
  calculateMultiplierUnderOneTick,
  calculateOverclock,
  type OverclockInput,
  type OverclockResult,
} from './gt/overclockCalculator';
import { determineParallel, type ParallelLimit } from './gt/parallel';
import {
  findMachine,
  resolveMachine,
  unknownMachine,
} from './machines/catalog';
import type { MachineContext, ResolvedMachine } from './machines/types';
import {
  RECIPE_TIERS,
  RECIPE_TIER_EU,
  TICKS_PER_SECOND,
  TIER_EU,
  type RecipeTier,
} from './tiers';

// The app's side of the GregTech port. Everything here is about turning one
// node's data into the numbers `src/domain/gt/` takes, and turning what comes
// back into something the UI can explain — the arithmetic itself lives there
// and is checked line by line against the Java.
//
// Two rules decide almost everything below, both read out of
// `MTEMultiBlockBase.setProcessingLogicPower`:
//
//   a multiblock is fed by its hatches, always amperage-overclocks, and runs
//   ParallelHelper
//
//   a single block is fed by its own tier at 1 A, never amperage-overclocks,
//   and never touches ParallelHelper at all

// ---------------------------------------------------------------------------
// display helpers
// ---------------------------------------------------------------------------

// a recipe's own draw (EU/t) from its stored total EU over its base duration
export const basePower = (eu: number, time: number): number =>
  time > 0 ? eu / (time * TICKS_PER_SECOND) : 0;

// the lowest tier that can carry the given draw — the tier a recipe "requires",
// and the same rule GT's `GTUtility.getTier` uses
export const recipeTier = (euPerTick: number): RecipeTier =>
  RECIPE_TIERS.find(tier => RECIPE_TIER_EU[tier] >= euPerTick) ?? 'MAX';

// GT numbers its tiers with ULV at 0 and LV at 1, which is this ladder's index
const gtTier = (euPerTick: number): number =>
  RECIPE_TIERS.indexOf(recipeTier(euPerTick));

// the highest tier fully covered by the supplied EU/t. anything below ULV still
// reports ULV; being underpowered is reported separately, not clamped here
export const suppliedTier = (euPerTick: number): RecipeTier => {
  let tier: RecipeTier = RECIPE_TIERS[0];
  for (const candidate of RECIPE_TIERS)
    if (RECIPE_TIER_EU[candidate] <= euPerTick) tier = candidate;
  return tier;
};

// the tier one step above the given one, or undefined at the top of the ladder
export const tierAbove = (tier: RecipeTier): RecipeTier | undefined =>
  RECIPE_TIERS[RECIPE_TIERS.indexOf(tier) + 1];

// ---------------------------------------------------------------------------
// hatches → GT's three separate quantities
// ---------------------------------------------------------------------------

export interface HatchSupply {
  /** GetAverageInputVoltage — Σ hatch voltage / hatch count, floored */
  voltage: number;
  /** What the overclock calculator is given: 1 under GT's single-hatch rule */
  amps: number;
  /** GetMaxInputAmps — Σ amps, whatever the single-hatch rule says */
  totalAmps: number;
  /** Voltage x amps: the EU/t budget every clamp is measured against */
  eut: number;
  /** GetMaxInputVoltage — the SUM. what the `N x tier` formulas read */
  maxVoltage: number;
  /** How many physical hatches are fitted */
  count: number;
}

const EMPTY_SUPPLY: HatchSupply = {
  voltage: 0,
  amps: 0,
  totalAmps: 0,
  eut: 0,
  maxVoltage: 0,
  count: 0,
};

/**
 * The three quantities GT keeps separate and this app used to conflate.
 *
 * `voltage x amps` is what pays for the recipe, and it is NOT the sum of the
 * hatch voltages: one LV hatch delivers 32 EU/t, two deliver 32 x 4 A = 128,
 * four deliver 256. The sum is a different number with a different job — it is
 * the "tier" the parallel formulas read.
 *
 * Tolerates a missing list: a multiblock persisted before hatches existed can
 * reach here if it slipped past normalizeNodes.
 */
export const hatchSupply = (
  hatches: EnergyHatch[] | undefined,
): HatchSupply => {
  const groups = (hatches ?? []).filter(hatch => hatch.count > 0);
  if (groups.length === 0) return EMPTY_SUPPLY;

  let count = 0;
  let maxVoltage = 0;
  let totalAmps = 0;
  let exotic = false;
  for (const hatch of groups) {
    // normalizeNodes is the one place a hatch acquires its amperage, and it
    // backfills every persisted hatch that predates the field
    const { amps } = hatch;
    count += hatch.count;
    maxVoltage += TIER_EU[hatch.tier] * hatch.count;
    totalAmps += amps * hatch.count;
    // GT's `useSingleAmp` asks whether any EXOTIC hatch is fitted, and a laser
    // or wireless hatch is exactly the thing that carries more than 2 A. That
    // is the only signal a hatch group gives us, so it is the one we read
    if (amps > DEFAULT_HATCH_AMPS) exotic = true;
  }

  // `boolean useSingleAmp = mEnergyHatches.size() == 1 && mExoticEnergyHatches.isEmpty()`
  const amps = count === 1 && !exotic ? 1 : totalAmps;
  // long division in the Java
  const voltage = Math.floor(maxVoltage / count);

  return { voltage, amps, totalAmps, eut: voltage * amps, maxVoltage, count };
};

/**
 * GetMaxInputVoltage — the summed hatch voltage. Exported because the energy
 * panel splits a multiblock's load across tiers in proportion to it.
 */
export const hatchVoltage = (hatches: EnergyHatch[] | undefined): number =>
  hatchSupply(hatches).maxVoltage;

// EU/t a machine is fed. a singleblock is fed by its own tier at one amp — the
// only way it overclocks is by being a higher tier machine
export const suppliedPower = (data: RecipeNodeData): number =>
  data.kind === 'multi' ? hatchSupply(data.hatches).eut : TIER_EU[data.voltage];

// ---------------------------------------------------------------------------
// the result
// ---------------------------------------------------------------------------

export interface Overclock {
  /** The catalog entry behind the numbers, for the UI and the issue panel */
  machine: ResolvedMachine;

  /** One recipe's draw as entered, EU/t, before any modifier */
  recipeEUt: number;
  /** What the machine is fed */
  availableEUt: number;
  supply: RecipeTier; // tier of availableEUt
  demand: RecipeTier; // tier the machine's whole draw lands on

  oc: {
    total: number;
    regular: number;
    heat: number;
    laser: number;
    /** TiersAbove — how many the power ratio offered, before any cap */
    available: number;
    /** Offered but not taken, because a cap stopped them */
    wasted: number;
    /**
     * Taken and charged for, but the one-tick floor swallowed the time they
     * would have saved. On a multiblock these come back as parallels, which is
     * what `parallel.subTick` counts; on a single block they are pure waste
     */
    floored: number;
    clampedBy: OverclockResult['clampedBy'];
  };

  heat: {
    recipe: number;
    machine: number;
    discounts: number;
    multiplier: number;
    overclocks: number;
    sufficient: boolean;
  };

  parallel: {
    /** The kernel's own answer — 0 when the supply cannot pay for one recipe */
    running: number;
    machineCap: number;
    /** The cap after the sub-tick multiplier; can exceed machineCap */
    effectiveCap: number;
    powerCap: number;
    subTick: number;
    nodeLimit?: number;
    limitedBy: ParallelLimit;
  };

  modifiers: { eut: number; duration: number };

  /**
   * `parallel.running` floored at 1 — what item I/O is scaled by. A machine
   * that cannot run at all is reported through `underpowered`; zeroing it here
   * would silently empty every downstream line instead
   */
  parallels: number;

  power: number; // EU/t the whole machine draws
  durationTicks: number;
  time: number; // seconds per cycle

  underpowered: boolean; // the supply cannot pay for a single recipe
  underheated: boolean; // the machine is colder than the recipe requires
  /** The figures are exactly as the user entered them */
  ranAsEntered: boolean;
}

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

/**
 * Single blocks never touch the catalog. GT hands them the plain calculator at
 * one parallel and one amp, so there is nothing to look up and nothing to
 * report as unmodelled — see decision 8 in MULTIBLOCK_PORT.md.
 */
const singleblockMachine = (name: string): ResolvedMachine => ({
  ...unknownMachine(name, false),
  known: true,
  modeled: true,
  parallelKnown: true,
  confidence: 'modelled',
  notes: undefined,
});

const machineFor = (
  data: RecipeNodeData,
  supply: HatchSupply,
  recipeEUt: number,
  durationTicks: number,
): ResolvedMachine => {
  if (data.kind !== 'multi') return singleblockMachine(data.machine);

  const context: MachineContext = {
    // the SUMMED hatch voltage, not the average — `6 * tier` on an Industrial
    // Centrifuge counts the whole bank
    tier: gtTier(supply.maxVoltage),
    amps: supply.totalAmps,
    recipe: {
      heat: data.recipeHeat ?? 0,
      eut: recipeEUt,
      duration: durationTicks,
    },
  };

  return resolveMachine(
    findMachine(data.machine),
    data.config,
    context,
    data.machine,
  );
};

const overclockInput = (
  machine: ResolvedMachine,
  supply: HatchSupply,
  recipeEUt: number,
  recipeHeat: number,
  durationTicks: number,
  parallel: number,
  multi: boolean,
): OverclockInput => ({
  recipeEUt,
  machineVoltage: supply.voltage,
  machineAmperage: supply.amps,
  duration: durationTicks,
  parallel,
  eutModifier: machine.eutModifier,
  durationModifier: machine.durationModifier,
  eutIncreasePerOC: machine.eutIncreasePerOC,
  durationDecreasePerOC: machine.durationDecreasePerOC,
  durationDecreasePerHeatOC: machine.durationDecreasePerHeatOC,
  laserOC: machine.laserOC,
  // `logic.setAmperageOC(true)` is unconditional for every multiblock, and a
  // single block is never given a ProcessingLogic that could set it
  amperageOC: multi || machine.amperageOC,
  maxOverclocks: machine.maxOverclocks,
  maxRegularOverclocks: machine.maxRegularOverclocks,
  noOverclock: machine.noOverclock,
  recipeHeat,
  machineHeat: machine.machineHeat,
  heatOC: machine.heatOC,
  heatDiscount: machine.heatDiscount,
  heatDiscountExponent: machine.heatDiscountExponent,
});

// the recipe exactly as entered: no overclocks, no parallels, no modifiers.
// what every bail-out path returns, so they all agree on the shape
const asEntered = (
  machine: ResolvedMachine,
  supply: HatchSupply,
  recipeEUt: number,
  recipeHeat: number,
  durationTicks: number,
  underpowered: boolean,
  underheated: boolean,
): Overclock => ({
  machine,
  recipeEUt,
  availableEUt: supply.eut,
  supply: suppliedTier(supply.eut),
  demand: recipeTier(recipeEUt),
  oc: {
    total: 0,
    regular: 0,
    heat: 0,
    laser: 0,
    available: 0,
    wasted: 0,
    floored: 0,
    clampedBy: 'none',
  },
  heat: {
    recipe: recipeHeat,
    machine: machine.machineHeat,
    discounts: 0,
    multiplier: 1,
    overclocks: 0,
    sufficient: !underheated,
  },
  parallel: {
    running: underpowered ? 0 : 1,
    machineCap: machine.maxParallel,
    effectiveCap: machine.maxParallel,
    powerCap: 0,
    subTick: 1,
    limitedBy: 'power',
  },
  modifiers: { eut: 1, duration: 1 },
  parallels: 1,
  power: recipeEUt,
  durationTicks,
  time: durationTicks / TICKS_PER_SECOND,
  underpowered,
  underheated,
  ranAsEntered: true,
});

/**
 * How many of the overclocks GT charged for bought no time at all, because the
 * duration had already reached the one-tick floor.
 *
 * The calculator does not report this: it applies every overclock the power
 * ratio allows and then floors the duration, so the last few can cost 4x each
 * and save nothing. Heat overclocks are counted first, the order GT divides
 * in.
 */
const flooredOverclocks = (
  machine: ResolvedMachine,
  result: OverclockResult,
  durationTicks: number,
): number => {
  let duration = durationTicks * machine.durationModifier;
  let spent = 0;

  while (spent < result.heatOverclocks && duration > 1) {
    duration /= machine.durationDecreasePerHeatOC;
    spent += 1;
  }
  while (spent < result.overclocks && duration > 1) {
    duration /= machine.durationDecreasePerOC;
    spent += 1;
  }

  return result.overclocks - spent;
};

// what determineParallel returns, minus the fields only it needs
type ParallelShape = Omit<Overclock['parallel'], 'nodeLimit'> & {
  insufficientPower: boolean;
};

const compute = (data: RecipeNodeData): Overclock => {
  const multi = data.kind === 'multi';
  const feed: HatchSupply = multi
    ? hatchSupply(data.hatches)
    : // a single block is its own hatch: its tier, one amp, no overclocking
      // across amps. `maxVoltage` is the same number here, which is why the
      // distinction only ever matters for multiblocks
      {
        voltage: TIER_EU[data.voltage],
        amps: 1,
        totalAmps: 1,
        eut: TIER_EU[data.voltage],
        maxVoltage: TIER_EU[data.voltage],
        count: 1,
      };

  const recipeEUt = basePower(data.eu, data.time);
  const durationTicks = data.time * TICKS_PER_SECOND;
  const recipeHeat = multi ? (data.recipeHeat ?? 0) : 0;
  const machine = machineFor(data, feed, recipeEUt, durationTicks);

  // an incomplete node has nothing to calculate — the missing fields are their
  // own issue, and running the kernel on a zero would only manufacture noise
  if (recipeEUt <= 0 || durationTicks <= 0)
    return asEntered(
      machine,
      feed,
      recipeEUt,
      recipeHeat,
      durationTicks,
      false,
      false,
    );

  // The kernel deliberately does not gate this: below the recipe's heat the
  // heat divisions go negative, the discount multiplier climbs above 1 and the
  // power goes UP. That is faithful to the Java and unreachable in game,
  // because GT never matches the recipe at all. So the gate lives here
  if (machine.requiresHeat && machine.machineHeat < recipeHeat)
    return asEntered(
      machine,
      feed,
      recipeEUt,
      recipeHeat,
      durationTicks,
      false,
      true,
    );

  const single = overclockInput(
    machine,
    feed,
    recipeEUt,
    recipeHeat,
    durationTicks,
    1,
    multi,
  );

  // ParallelHelper is a multiblock mechanism. A single block runs exactly one
  // recipe, so all that is left of the helper is its power check
  const singleDraw = Math.ceil(recipeEUt * machine.eutModifier);
  const parallel: ParallelShape = multi
    ? determineParallel({
        machineMaxParallel: machine.maxParallel,
        recipeEUt,
        eutModifier: machine.eutModifier,
        heatDiscountMultiplier: calculateHeatDiscountMultiplier(single),
        availableEUt: feed.eut,
        // applied before every other clamp: overclocks past the one-tick floor
        // buy parallels rather than nothing
        subTickMultiplier: calculateMultiplierUnderOneTick(single),
        nodeLimit: data.parallelLimit,
      })
    : {
        running: feed.eut < singleDraw ? 0 : 1,
        machineCap: 1,
        effectiveCap: 1,
        powerCap: 1,
        subTick: 1,
        limitedBy: 'machine',
        insufficientPower: feed.eut < singleDraw,
      };

  if (parallel.insufficientPower || parallel.running < 1)
    return asEntered(
      machine,
      feed,
      recipeEUt,
      recipeHeat,
      durationTicks,
      true,
      false,
    );

  const result = calculateOverclock(
    overclockInput(
      machine,
      feed,
      recipeEUt,
      recipeHeat,
      durationTicks,
      parallel.running,
      multi,
    ),
  );

  return {
    machine,
    recipeEUt,
    availableEUt: feed.eut,
    supply: suppliedTier(feed.eut),
    demand: recipeTier(result.euPerTick),
    oc: {
      total: result.overclocks,
      regular: result.regularOverclocks,
      heat: result.heatOverclocks,
      laser: result.laserOverclocks,
      available: result.tiersAbove,
      // what a cap refused
      wasted: Math.max(0, result.tiersAbove - result.overclocks),
      floored: flooredOverclocks(machine, result, durationTicks),
      clampedBy: result.clampedBy,
    },
    heat: {
      recipe: recipeHeat,
      machine: machine.machineHeat,
      discounts: result.heatDiscounts,
      multiplier: result.heatDiscountMultiplier,
      overclocks: result.heatOverclocks,
      sufficient: true,
    },
    parallel: {
      running: parallel.running,
      machineCap: parallel.machineCap,
      effectiveCap: parallel.effectiveCap,
      powerCap: parallel.powerCap,
      subTick: parallel.subTick,
      nodeLimit: multi ? data.parallelLimit : undefined,
      limitedBy: parallel.limitedBy,
    },
    modifiers: { eut: machine.eutModifier, duration: machine.durationModifier },
    parallels: Math.max(1, parallel.running),
    power: result.euPerTick,
    durationTicks: result.durationTicks,
    time: result.durationTicks / TICKS_PER_SECOND,
    underpowered: false,
    underheated: false,
    ranAsEntered: false,
  };
};

// `validateGraph`, `lineMetrics`, `lineEnergy`, `demandByTier` and `recipeScale`
// each call this per node, several times per render, and it now does a catalog
// lookup and a formula evaluation. Node data objects are identity-stable
// between renders — that is what normalizeNodes' identity return guarantees —
// so the cache is free and cannot go stale
const CACHE = new WeakMap<RecipeNodeData, Overclock>();

/**
 * Run one node through GregTech's own overclock and parallel maths.
 *
 * The order is GT's: resolve the machine, take the sub-tick multiplier from a
 * one-parallel calculator, let ParallelHelper decide how many recipes run, then
 * overclock with that parallel count.
 */
export const overclock = (data: RecipeNodeData): Overclock => {
  const cached = CACHE.get(data);
  if (cached !== undefined) return cached;

  const result = compute(data);
  CACHE.set(data, result);
  return result;
};
