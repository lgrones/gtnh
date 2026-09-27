import {
  clamp,
  intDiv,
  javaInt,
  javaLong,
  log4,
  log4ceil,
  MAX_INT,
  powInt,
} from './num';

// A transcription of `gregtech.api.util.OverclockCalculator` at GT 5.09.51.482.
//
// This module knows nothing about the app: numbers in, numbers out. That is
// deliberate — it is the only way the port stays checkable line by line against
// the Java, and it keeps the tests readable as statements about GregTech rather
// than about our node data. Everything that decides WHICH numbers to feed it
// lives in `src/domain/overclock.ts`.
//
// Quirks that look like bugs have been left exactly as they are. They are the
// game: players have built around them, so reproducing them is the point.

export const HEAT_DISCOUNT_THRESHOLD = 900;
export const HEAT_OVERCLOCK_THRESHOLD = 1800;

export interface OverclockInput {
  recipeEUt: number;
  machineVoltage: number;
  /** Total amps the machine is fed. GT defaults to 1. */
  machineAmperage?: number;
  /** Base duration in TICKS, before any modifier */
  duration: number;
  parallel?: number;
  /** Multiplies the recipe's draw before anything else — GT++ machines */
  eutModifier?: number;
  /** Multiplies the duration before anything else — GT++ machines */
  durationModifier?: number;
  eutIncreasePerOC?: number;
  durationDecreasePerOC?: number;
  /** GT declares this final at 4; it is an input here only for symmetry */
  durationDecreasePerHeatOC?: number;
  laserOC?: boolean;
  amperageOC?: boolean;
  maxOverclocks?: number;
  maxRegularOverclocks?: number;
  noOverclock?: boolean;
  recipeHeat?: number;
  machineHeat?: number;
  heatOC?: boolean;
  heatDiscount?: boolean;
  heatDiscountExponent?: number;
  /** Machines with their own base-duration rule, like the Neutron Activator */
  durationUnderOneTick?: number;
}

export interface OverclockResult {
  /** EU/t the whole machine draws, every parallel included */
  euPerTick: number;
  /** Whole ticks, never below 1 */
  durationTicks: number;
  overclocks: number;
  regularOverclocks: number;
  heatOverclocks: number;
  laserOverclocks: number;
  /** How many the power ratio offered, before any cap — the UI's "why not more" */
  tiersAbove: number;
  /** May be negative when the machine is colder than the recipe */
  heatDiscounts: number;
  heatDiscountMultiplier: number;
  /** What stopped it going further */
  clampedBy: 'none' | 'maxOverclocks' | 'voltageTier' | 'noOverclock' | 'laser';
}

interface Resolved extends Required<
  Omit<OverclockInput, 'durationUnderOneTick'>
> {
  durationUnderOneTick: number | undefined;
}

// GT's own field defaults, in the same order the Java declares them
const resolve = (input: OverclockInput): Resolved => ({
  recipeEUt: input.recipeEUt,
  machineVoltage: input.machineVoltage,
  machineAmperage: input.machineAmperage ?? 1,
  duration: input.duration,
  parallel: input.parallel ?? 1,
  eutModifier: input.eutModifier ?? 1,
  durationModifier: input.durationModifier ?? 1,
  eutIncreasePerOC: input.eutIncreasePerOC ?? 4,
  durationDecreasePerOC: input.durationDecreasePerOC ?? 2,
  durationDecreasePerHeatOC: input.durationDecreasePerHeatOC ?? 4,
  laserOC: input.laserOC ?? false,
  amperageOC: input.amperageOC ?? false,
  maxOverclocks: input.maxOverclocks ?? MAX_INT,
  maxRegularOverclocks: input.maxRegularOverclocks ?? MAX_INT,
  noOverclock: input.noOverclock ?? false,
  recipeHeat: input.recipeHeat ?? 0,
  machineHeat: input.machineHeat ?? 0,
  heatOC: input.heatOC ?? false,
  heatDiscount: input.heatDiscount ?? false,
  heatDiscountExponent: input.heatDiscountExponent ?? 0.95,
  durationUnderOneTick: input.durationUnderOneTick,
});

// one discount step per 900 K above the recipe's requirement. the division
// truncates toward zero, so a machine BELOW the recipe's heat gets a negative
// count and a multiplier above 1 — the recipe costs more. unreachable in game,
// because GT never matches the recipe at all; reproduced anyway
const heatDiscounts = (r: Resolved): number =>
  r.heatDiscount
    ? intDiv(r.machineHeat - r.recipeHeat, HEAT_DISCOUNT_THRESHOLD)
    : 0;

export const calculateHeatDiscountMultiplier = (
  input: OverclockInput,
): number => {
  const r = resolve(input);
  return powInt(r.heatDiscountExponent, heatDiscounts(r));
};

// the recipe's draw once the machine's own modifiers and its heat discount are
// applied. `parallel` is in here, so this is the whole machine, not one recipe
const recipePowerOf = (r: Resolved): number =>
  r.recipeEUt *
  r.parallel *
  r.eutModifier *
  powInt(r.heatDiscountExponent, heatDiscounts(r));

// what the hatches can actually put behind the recipe. without amperage
// overclocking a machine may only draw as many amps as it runs parallels
const machinePowerOf = (r: Resolved): number =>
  r.machineVoltage *
  (r.amperageOC ? r.machineAmperage : Math.min(r.machineAmperage, r.parallel));

const baseDurationOf = (r: Resolved): number =>
  r.durationUnderOneTick ?? r.duration * r.durationModifier;

const tiersAboveOf = (r: Resolved): number =>
  log4(
    intDiv(
      javaLong(machinePowerOf(r)),
      Math.max(javaLong(recipePowerOf(r)), 32),
    ),
  );

// how many tiers the machine's voltage sits above the recipe's, counted the way
// GT numbers them — LV is 1, and anything below LV still counts as LV
const voltageTiersAboveOf = (r: Resolved): number =>
  Math.max(log4ceil(intDiv(r.machineVoltage, 8)), 1) -
  Math.max(log4ceil(intDiv(r.recipeEUt, 8)), 1);

export const calculateOverclock = (input: OverclockInput): OverclockResult => {
  const r = resolve(input);

  let duration = baseDurationOf(r);
  const recipePower = recipePowerOf(r);
  const machinePower = machinePowerOf(r);
  const tiersAbove = tiersAboveOf(r);

  const discounts = heatDiscounts(r);
  const flat = {
    tiersAbove,
    heatDiscounts: discounts,
    heatDiscountMultiplier: powInt(r.heatDiscountExponent, discounts),
  };

  if (r.noOverclock)
    return {
      ...flat,
      // note the asymmetry with every other exit: the duration is CEILED here
      // and truncated everywhere else, so 18.75 ticks is 19 on this path and 18
      // on the others
      euPerTick: Math.ceil(recipePower),
      durationTicks: javaInt(Math.ceil(duration)),
      overclocks: 0,
      regularOverclocks: 0,
      heatOverclocks: 0,
      laserOverclocks: 0,
      clampedBy: 'noOverclock',
    };

  if (r.laserOC) {
    let eutOverclock = recipePower;

    // spend plain 4x overclocks until one more would exceed the supply
    let regularOverclocks = 0;
    while (
      eutOverclock * 4 < machinePower &&
      regularOverclocks < r.maxRegularOverclocks
    ) {
      eutOverclock *= 4;
      regularOverclocks += 1;
    }

    // then laser overclocks, each costing a little more than the last
    const durationPerSlice = r.durationUnderOneTick ?? duration;
    let laserOverclocks = 0;
    for (;;) {
      const multiplier = 4 + 0.3 * (laserOverclocks + 1);
      const potentialEU = eutOverclock * multiplier;
      const estimatedDuration =
        duration /
        r.durationDecreasePerOC ** (regularOverclocks + laserOverclocks + 1);

      if (potentialEU >= machinePower) break;
      // with no custom supplier `durationPerSlice === duration`, so this reads
      // as "stop before the next one would push us under a tick". with one, it
      // is a different question entirely — which is why it is written this way
      if (estimatedDuration <= duration / durationPerSlice) break;

      eutOverclock = potentialEU;
      laserOverclocks += 1;
    }

    const overclocks = regularOverclocks + laserOverclocks;
    return {
      ...flat,
      euPerTick: Math.ceil(eutOverclock),
      durationTicks: javaInt(
        Math.max(duration / powInt(r.durationDecreasePerOC, overclocks), 1),
      ),
      overclocks,
      regularOverclocks,
      heatOverclocks: 0,
      laserOverclocks,
      clampedBy: 'laser',
    };
  }

  let overclocks = Math.min(r.maxOverclocks, tiersAbove);
  const cappedByMax = r.maxOverclocks < tiersAbove;

  let cappedByVoltage = false;
  if (!r.amperageOC) {
    const voltageTiersAbove = voltageTiersAboveOf(r);
    cappedByVoltage = voltageTiersAbove < overclocks;
    overclocks = Math.min(overclocks, voltageTiersAbove);
  }
  // a recipe needing more than 1A from a single hatch lands here negative
  overclocks = Math.max(overclocks, 0);

  const heatOverclocks = Math.min(
    r.heatOC
      ? intDiv(r.machineHeat - r.recipeHeat, HEAT_OVERCLOCK_THRESHOLD)
      : 0,
    overclocks,
  );
  const regularOverclocks = overclocks - heatOverclocks;

  // every overclock is charged for, including ones the tick floor below will
  // stop from buying any time
  const euPerTick = Math.ceil(
    recipePower * powInt(r.eutIncreasePerOC, overclocks),
  );
  duration /= powInt(r.durationDecreasePerHeatOC, heatOverclocks);
  duration /= powInt(r.durationDecreasePerOC, regularOverclocks);

  return {
    ...flat,
    euPerTick,
    durationTicks: javaInt(Math.max(duration, 1)),
    overclocks,
    regularOverclocks,
    heatOverclocks,
    laserOverclocks: 0,
    clampedBy: cappedByVoltage
      ? 'voltageTier'
      : cappedByMax
        ? 'maxOverclocks'
        : 'none',
  };
};

// How many more times over the recipe could run in the tick the overclocks
// compressed it into. ParallelHelper multiplies the machine's parallel cap by
// this BEFORE every other clamp, so it is the mechanic that turns spare voltage
// on a short recipe into real throughput instead of waste.
//
// Returns 1 when sub-tick is not reached, so it is safe to apply to every
// machine — there is no per-machine switch in GT and there is none here.
export const calculateMultiplierUnderOneTick = (
  input: OverclockInput,
): number => {
  const r = resolve(input);
  if (r.noOverclock) return 1;

  const duration = baseDurationOf(r);

  if (r.laserOC) {
    const recipePower = recipePowerOf(r);
    const machinePower = machinePowerOf(r);
    let eutOverclock = recipePower;
    let neededOverclocks = 0;

    // `overclocks` inside both loops refers to the calculator's FIELD, not to
    // the local declared after them — Java resolves the name that way, and the
    // field is still 0 here because ParallelHelper calls this before
    // calculate(). So the guard is `duration < 2`, constant across iterations.
    // Almost certainly not what was intended; it is what runs
    const performedOverclocks = 0;

    let regularOverclocks = 0;
    while (
      eutOverclock * 4 < machinePower &&
      regularOverclocks < r.maxRegularOverclocks
    ) {
      eutOverclock *= 4;
      regularOverclocks += 1;
      if (
        duration / powInt(r.durationDecreasePerOC, performedOverclocks) < 2 &&
        neededOverclocks === 0
      )
        neededOverclocks = regularOverclocks;
    }

    let laserOverclocks = 0;
    while (eutOverclock * (4 + 0.3 * (laserOverclocks + 1)) < machinePower) {
      eutOverclock *= 4 + 0.3 * (laserOverclocks + 1);
      laserOverclocks += 1;
      if (
        duration / powInt(r.durationDecreasePerOC, performedOverclocks) < 2 &&
        neededOverclocks === 0
      )
        neededOverclocks = performedOverclocks + laserOverclocks;
    }

    const overclocks = regularOverclocks + laserOverclocks;
    return powInt(
      r.durationDecreasePerOC,
      Math.max(neededOverclocks - overclocks, 0),
    );
  }

  // note the clamp form: `clamp(maxOverclocks, 0, available)`. Because the
  // upper bound is applied last, a machine with no headroom lands on 0 even
  // though maxOverclocks defaults to int max. calculateOverclock spells the
  // same idea as a min then a max, and the two are NOT interchangeable
  const overclocks = clamp(
    r.maxOverclocks,
    0,
    r.amperageOC ? tiersAboveOf(r) : voltageTiersAboveOf(r),
  );

  const heatOverclocks = Math.min(
    r.heatOC
      ? intDiv(r.machineHeat - r.recipeHeat, HEAT_OVERCLOCK_THRESHOLD)
      : 0,
    overclocks,
  );
  const regularOverclocks = overclocks - heatOverclocks;

  const durationAfterHeatOC =
    duration / powInt(r.durationDecreasePerHeatOC, heatOverclocks);

  // how many of each it would take to reach one tick
  const neededHeatOverclocks = Math.ceil(
    Math.log(duration) / Math.log(r.durationDecreasePerHeatOC),
  );
  const neededRegularOverclocks = Math.ceil(
    Math.log(durationAfterHeatOC) / Math.log(r.durationDecreasePerOC),
  );

  // the ones past that point buy parallels instead of time
  const extraHeat = Math.max(heatOverclocks - neededHeatOverclocks, 0);
  const extraRegular = Math.max(regularOverclocks - neededRegularOverclocks, 0);
  const heatMultiplier = powInt(r.durationDecreasePerHeatOC, extraHeat);
  const regularMultiplier = powInt(r.durationDecreasePerOC, extraRegular);

  // and a fractional term for the speedup lost to landing on whole overclocks
  let correctionMultiplier: number;
  if (heatOverclocks >= neededHeatOverclocks)
    correctionMultiplier =
      powInt(r.durationDecreasePerHeatOC, neededHeatOverclocks) / duration;
  else if (regularOverclocks >= neededRegularOverclocks)
    correctionMultiplier =
      powInt(r.durationDecreasePerOC, neededRegularOverclocks) /
      durationAfterHeatOC;
  else return 1;

  return Math.ceil(heatMultiplier * regularMultiplier * correctionMultiplier);
};
