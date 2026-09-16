import type { CountParam } from '@/domain/machines/types';

// Fields a controller fills in during `checkMachine` from the blocks the player
// actually built, and which its parallel formula then reads.
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
}

/**
 * Keyed by the identifier as it appears in Java — a bare field, or the getter
 * that returns it. Both spellings are listed because both occur.
 */
export const STRUCTURE_PARAMS: Record<string, StructureParam> = {
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
