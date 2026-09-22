import type { CountParam } from '@/domain/machines/types';

// Fields a controller fills in at runtime — from the blocks the player actually
// built during `checkMachine`, or from an upgrade they installed — and which
// its parallel formula then reads.
//
// The parser cannot follow these — the value exists only at runtime, in a world
// — so each one becomes a machine *parameter* instead: the player tells the
// planner what they built, exactly as they would tell it which coils they used.
//
// Every entry states where its bounds come from, and an entry is only added
// once those bounds have been read out of the source. A field with no entry
// stays unresolved and its machine's parallel model stays `unknown`, which is
// the honest answer and shows up in the coverage report. Guessing a range here
// would produce a number the UI presents as fact.
//
// `count` rather than a named ladder: the parser has no data file mapping a
// casing block to a display name yet, and a plain "which tier did you build"
// number is both truthful and usable. A named `pipeCasingTier` ladder is the
// upgrade, and the ParamKind is already reserved for it.

export interface StructureParam {
  param: CountParam;
  /** Where the bounds were read from, quoted in the coverage report */
  source: string;
  /**
   * Controller classes this entry applies to. Absent means every class, which
   * is safe for a name only one machine family uses (`mAnvilTier`). A name as
   * common as `tier` has to be scoped, or it would hijack the same field on
   * every other controller that happens to spell it that way.
   */
  only?: string[];
}

/**
 * Keyed by the identifier as it appears in Java — a bare field, or the getter
 * that returns it. Both spellings are listed because both occur.
 */
export const STRUCTURE_PARAMS: Record<string, StructureParam> = {
  controllerTier: {
    param: {
      id: 'controllerTier',
      kind: 'count',
      label: 'Controller tier',
      help: 'The Industrial Maceration Stack starts at 1 and becomes 2 once a Maceration Upgrade Chip is inserted, which multiplies its parallels from 2 per voltage tier to 8. The chip is consumed and cannot be taken back out.',
      min: 1,
      max: 2,
      default: 1,
      primary: true,
      required: true,
    },
    source:
      'MTEIndustrialMacerator — controllerTier starts at 1 and onRightclick/onPostTick set it to 2 for a Maceration_Upgrade_Chip; checkMachine then demands structureTier >= controllerTier',
  },

  tier: {
    param: {
      id: 'cokeOvenCasing',
      kind: 'count',
      label: 'Coke oven casing tier',
      help: 'Heat Resistant Coke Oven Casings are 1 (18 parallels), Heat Proof 2 (30).',
      min: 1,
      max: 2,
      default: 1,
      primary: true,
      required: true,
    },
    source:
      'MTEIndustrialCokeOven.checkMachine — tier is 1 for 8 Heat Resistant casings, 2 for 8 Heat Proof ones, and the structure is refused at 0',
    only: ['MTEIndustrialCokeOven'],
  },

  mAnvilTier: {
    param: {
      id: 'anvil',
      kind: 'count',
      label: 'Anvil tier',
      help: 'Vanilla anvil is 1, Railcraft 2, dark steel and thaumic 3, void 4.',
      min: 1,
      max: 4,
      default: 1,
      primary: true,
      required: true,
    },
    source:
      'MTEIndustrialForgeHammer — anvilTiers maps four blocks to 1 through 4',
  },

  itemPipeTier: {
    param: {
      id: 'itemPipe',
      kind: 'count',
      label: 'Item pipe casing tier',
      help: 'Tin is 1 through to Black Plutonium at 8.',
      min: 1,
      max: 8,
      default: 1,
      primary: true,
      required: true,
    },
    source:
      'MTEMultiAutoclave.getItemPipeTierFromMeta — sBlockCasings11 meta 0..7, plus one',
  },

  mPipeCasingTier: {
    param: {
      id: 'pipeCasing',
      kind: 'count',
      label: 'Pipe casing tier',
      help: 'Bronze is 0, then Steel, Titanium and Tungstensteel at 3.',
      min: 0,
      max: 3,
      default: 0,
      primary: true,
      required: true,
    },
    source:
      'MTEChemicalPlant — addTieredBlock(sBlockCasings2, 12, 16) and mPipeCasingTier = checkPipe - 12',
  },
};

/** The getters that return one of the fields above, by field name */
export const STRUCTURE_GETTERS: Record<string, string> = {
  getAnvilTier: 'mAnvilTier',
  getItemPipeTier: 'itemPipeTier',
  getPipeCasingTier: 'mPipeCasingTier',
};
