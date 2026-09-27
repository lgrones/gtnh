import { intDiv, safeInt } from './num';

// The planning-relevant slice of `gregtech.api.util.ParallelHelper`'s
// determineParallel(), at GT 5.09.51.482.
//
// Three of GT's clamps are deliberately absent, because they model in-game
// inventory states rather than steady-state throughput and a planner assumes
// those away:
//
//   batch mode      throughput-neutral by construction — more recipes per
//                   iteration over a proportionally longer duration at the
//                   same EU/t. It trades TPS for nothing we measure
//   output limits   truncation to the bus/hatch slot count
//   void protection models a failure whose avoidance is the planner's job
//
// The input bound (GT's maxParallelCalculator, the last clamp) is not
// implemented either, but its seam is: pass `inputLimit`. See TODO.md.

export type ParallelLimit = 'machine' | 'power' | 'node' | 'input';

export interface ParallelInput {
  /** The controller's declared cap, already resolved for this machine's build */
  machineMaxParallel: number;
  /** The recipe's own EU/t, before any modifier */
  recipeEUt: number;
  eutModifier?: number;
  heatDiscountMultiplier?: number;
  /** EU/t the hatches deliver — voltage x amps */
  availableEUt: number;
  /** From calculateMultiplierUnderOneTick(); 1 when sub-tick is not reached */
  subTickMultiplier?: number;
  /** Set only for machines with their own base-duration rule */
  durationUnderOneTick?: number;
  /** What the buses and hatches can feed per cycle. not yet modelled */
  inputLimit?: number;
  /** A ceiling the user set on the node */
  nodeLimit?: number;
}

export interface ParallelResult {
  /** How many recipes actually run */
  running: number;
  machineCap: number;
  /** The cap after the sub-tick multiplier, which can exceed machineCap */
  effectiveCap: number;
  powerCap: number;
  subTick: number;
  /** GT's tRecipeEUt — one recipe's draw after modifier and heat discount */
  recipeEUt: number;
  limitedBy: ParallelLimit;
  /** The supply cannot even pay for a single recipe */
  insufficientPower: boolean;
}

const none: Omit<
  ParallelResult,
  'machineCap' | 'recipeEUt' | 'insufficientPower'
> = {
  running: 0,
  effectiveCap: 0,
  powerCap: 0,
  subTick: 1,
  limitedBy: 'power',
};

export const determineParallel = (input: ParallelInput): ParallelResult => {
  const machineCap = input.machineMaxParallel;
  const eutModifier = input.eutModifier ?? 1;
  const heatDiscount = input.heatDiscountMultiplier ?? 1;
  const subTick = input.subTickMultiplier ?? 1;
  const inputLimit = input.inputLimit ?? Infinity;
  const nodeLimit = input.nodeLimit ?? Infinity;

  // one recipe's draw, rounded up — GT charges the ceiling
  const recipeEUt = Math.ceil(input.recipeEUt * eutModifier * heatDiscount);

  if (machineCap <= 0)
    return { ...none, machineCap, recipeEUt, insufficientPower: false };

  // GT bails out here with insufficientPower before any clamp runs
  if (input.availableEUt < recipeEUt)
    return { ...none, machineCap, recipeEUt, insufficientPower: true };

  // the sub-tick multiplier is applied FIRST and multiplies straight past the
  // declared cap — a machine capped at 1 can still run 4 of a recipe its
  // overclocks squeezed into a quarter of a tick
  const effectiveCap =
    input.durationUnderOneTick !== undefined
      ? input.durationUnderOneTick < 1
        ? safeInt(Math.trunc(machineCap / input.durationUnderOneTick), 0)
        : machineCap
      : safeInt(Math.trunc(machineCap * subTick), 0);

  const powerCap =
    recipeEUt > 0 ? intDiv(input.availableEUt, recipeEUt) : Infinity;

  const running = Math.max(
    0,
    Math.min(effectiveCap, powerCap, inputLimit, nodeLimit),
  );

  // report the binding constraint the user can most usefully act on. a node
  // limit they set themselves outranks anything the game imposed, and the
  // machine's own cap outranks power, because when the two are equal more
  // hatches would buy nothing
  const limitedBy: ParallelLimit =
    running === nodeLimit
      ? 'node'
      : running === inputLimit
        ? 'input'
        : running === effectiveCap
          ? 'machine'
          : 'power';

  return {
    running,
    machineCap,
    effectiveCap,
    powerCap,
    subTick,
    recipeEUt,
    limitedBy,
    insufficientPower: false,
  };
};
