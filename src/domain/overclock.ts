import {
  type EnergyHatch,
  type RecipeNodeData,
} from '@/contexts/productionStore/types';

import { findMultiblock, type OverclockMode } from './multiblocks';
import {
  RECIPE_TIERS,
  RECIPE_TIER_EU,
  TICKS_PER_SECOND,
  TIER_EU,
  type RecipeTier,
} from './tiers';

// speed divisor per overclock step. both types cost 4x power per step; only the
// time saved differs, which is why imperfect doubles a recipe's total energy
// and perfect leaves it unchanged
const SPEED_DIVISOR: Record<'imperfect' | 'perfect', number> = {
  imperfect: 2,
  perfect: 4,
};
const POWER_FACTOR = 4;

// a recipe's own draw (EU/t) from its stored total EU over its base duration.
// any machine energy discount is assumed already baked into the entered EU —
// the wiki applies the discount before parallels, which is where this sits
export const basePower = (eu: number, time: number): number =>
  time > 0 ? eu / (time * TICKS_PER_SECOND) : 0;

// the lowest tier that can carry the given draw — the tier a recipe "requires"
export const recipeTier = (euPerTick: number): RecipeTier =>
  RECIPE_TIERS.find(tier => RECIPE_TIER_EU[tier] >= euPerTick) ?? 'MAX';

// EU/t a bank of energy hatches delivers. 4 LV hatches is 128 EU/t = 1A of MV,
// exactly as the EBF does it
// tolerates a missing list: a multiblock persisted before hatches existed can
// reach here if it slipped past normalizeNodes
export const hatchPower = (hatches: EnergyHatch[] | undefined): number =>
  (hatches ?? []).reduce(
    (total, hatch) => total + TIER_EU[hatch.tier] * Math.max(0, hatch.count),
    0,
  );

// EU/t a machine is fed. a singleblock is fed by its own tier alone — the wiki
// is explicit that it overclocks only via a higher tier machine, never by amps
export const suppliedPower = (data: RecipeNodeData): number =>
  data.kind === 'multi' ? hatchPower(data.hatches) : TIER_EU[data.voltage];

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

export interface Overclock {
  mode: OverclockMode; // resolved mode, after a `mixed` node's own override
  recipe: RecipeTier; // tier the recipe demands once parallels are applied
  supplied: RecipeTier; // tier the machine is fed
  steps: number; // overclock steps applied to the duration
  surplus: number; // steps the 1 tick floor left nothing to spend on
  parallels: number; // concurrent recipes — scales item I/O as well as power
  offeredParallels: number; // parallels entered on the node, before power caps
  divisor: number; // what one step divides the duration by (2 or 4)
  underpowered: boolean; // supply cannot even run the recipe unoverclocked
  power: number; // EU/t after parallels and overclocking
  time: number; // seconds per cycle after overclocking
}

// resolve which of the two real behaviours applies. `mixed` machines can do
// both, so the node carries the choice; anything we cannot model runs unchanged
const resolveMode = (data: RecipeNodeData): Exclude<OverclockMode, 'mixed'> => {
  // singleblocks are always imperfect — 2x speed for 4x power
  if (data.kind !== 'multi') return 'imperfect';

  // legacy graphs may hold a name that predates the catalog; most multiblocks
  // are imperfect, so that is the safer assumption than silently not
  // overclocking at all
  const mode = findMultiblock(data.machine)?.overclock ?? 'imperfect';
  return mode === 'mixed' ? (data.overclock ?? 'imperfect') : mode;
};

// concurrent recipes entered on the node. only multiblocks have them; what
// actually runs is this capped by the supply, which parallelCount does
const offeredParallels = (data: RecipeNodeData): number =>
  data.kind === 'multi' ? Math.max(1, Math.floor(data.parallels ?? 1)) : 1;

// how many of those the supplied power can actually pay for
const parallelCount = (
  data: RecipeNodeData,
  power: number,
  supply: number,
): number => {
  if (data.kind !== 'multi' || power <= 0) return 1;
  return Math.max(
    1,
    Math.min(offeredParallels(data), Math.floor(supply / power)),
  );
};

// overclock a recipe against the power its machine is fed, following the wiki's
// order: energy discount (already in the entered EU), then parallels, then
// overclocks — EU/t = base x parallels x 4^steps
export const overclock = (data: RecipeNodeData): Overclock => {
  const power = basePower(data.eu, data.time);
  const supply = suppliedPower(data);
  const mode = resolveMode(data);

  const flat: Overclock = {
    mode,
    recipe: recipeTier(power),
    supplied: suppliedTier(supply),
    steps: 0,
    surplus: 0,
    parallels: 1,
    offeredParallels: offeredParallels(data),
    divisor:
      mode === 'perfect' ? SPEED_DIVISOR.perfect : SPEED_DIVISOR.imperfect,
    underpowered: power > 0 && supply < power,
    power,
    time: data.time,
  };

  // `none` cannot overclock; `unique` follows rules we do not model, so its
  // numbers stay exactly as the user entered them
  if (mode === 'none' || mode === 'unique' || flat.underpowered || power <= 0)
    return flat;

  // parallels are paid for before any overclock, so they raise the tier the
  // recipe effectively demands and can eat the headroom an overclock needed
  const parallels = parallelCount(data, power, supply);
  const recipe = recipeTier(power * parallels);
  const supplied = suppliedTier(supply);
  const available =
    RECIPE_TIERS.indexOf(supplied) - RECIPE_TIERS.indexOf(recipe);

  if (available <= 0)
    return {
      ...flat,
      recipe,
      supplied,
      parallels,
      power: power * parallels,
    };

  // a step normally halves (imperfect) or quarters (perfect) the duration, but
  // it cannot go below one tick — the smallest unit of time in the game. steps
  // left over past that floor buy nothing: the machine cannot run more recipes
  // than the node's parallel count, which is set by what its buses and hatches
  // can push in per cycle, not by how much spare power sits in the wall
  const divisor = SPEED_DIVISOR[mode];
  const ticks = data.time * TICKS_PER_SECOND;

  let steps = 0;
  while (steps < available && ticks / divisor ** (steps + 1) >= 1) steps += 1;

  return {
    ...flat,
    recipe,
    supplied,
    steps,
    surplus: available - steps,
    parallels,
    power: power * parallels * POWER_FACTOR ** steps,
    time: data.time / divisor ** steps,
  };
};
