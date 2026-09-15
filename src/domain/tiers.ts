import {
  VOLTAGE_TIERS,
  type VoltageTier,
} from '@/contexts/productionStore/types';

// EU/t carried by 1A at each GregTech voltage tier. Singleblock generators
// always output exactly 1A at their rated tier, so this is their gross output.
export const TIER_EU: Record<VoltageTier, number> = {
  LV: 32,
  MV: 128,
  HV: 512,
  EV: 2048,
  IV: 8192,
  LuV: 32768,
  ZPM: 131072,
  UV: 524288,
  UHV: 2097152,
  UEV: 8388608,
  UIV: 33554432,
  UMV: 134217728,
  UXV: 536870912,
  MAX: 2147483648,
};

// a RECIPE's tier can be ULV (8 EU/t) even though no ULV generator exists, so
// overclock math needs its own ladder. VOLTAGE_TIERS stays generator-only —
// see the note on it in the store's types
export const RECIPE_TIERS = ['ULV', ...VOLTAGE_TIERS] as const;
export type RecipeTier = (typeof RECIPE_TIERS)[number];

export const RECIPE_TIER_EU: Record<RecipeTier, number> = {
  ULV: 8,
  ...TIER_EU,
};

export const TICKS_PER_SECOND = 20;
