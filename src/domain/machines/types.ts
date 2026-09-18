// Shapes for the generated machine catalog in `src/data`.
//
// The catalog is extracted from GregTech source, so these types mirror what the
// Java sets rather than inventing an abstraction over it. When GT gains a
// setter, this gains a field, and the diff of the generated JSON says what
// changed between pack versions.

// ---------------------------------------------------------------------------
// expressions
// ---------------------------------------------------------------------------

// A formula, as data. Three encodings, picked so the JSON reads like the Java
// it came from:
//
//   number  a constant                      8
//   string  a reference                     "tier", "param.coil.heat"
//   object  a single-key operator node      { "mul": [8, "tier"] }
//
// `2 * getPipeCasingTier()` becomes `{ "mul": [2, "param.pipeCasing.tier"] }`,
// which a reviewer can check against the source without unpacking anything.
// Volcanus keeps `{ "div": [1, 2.2] }` rather than 0.4545…, because the Java
// says `setSpeedBonus(1F / 2.2F)`.
export type Expr = number | ExprRef | ExprOp;

// Everything an evaluation can name:
//
//   tier             GT voltage tier of the SUMMED hatch voltage
//   amps             total amperage the hatches deliver
//   recipe.heat      the recipe's mSpecialValue
//   recipe.eut       the recipe's EU/t, before modifiers
//   recipe.duration  the recipe's duration in ticks
//   param.<id>       a declared parameter's numeric value
//   param.<id>.<p>   a property of a tier-valued parameter: heat, tier, index
//   config.<key>     a pack config value from gtConfig.json
export type ExprRef = string;

export type ExprOp =
  | { add: Expr[] }
  | { sub: [Expr, Expr] }
  | { mul: Expr[] }
  | { div: [Expr, Expr] }
  | { pow: [Expr, Expr] }
  | { min: Expr[] }
  | { max: Expr[] }
  | { floor: Expr }
  | { ceil: Expr }
  | { sqrt: Expr }
  | { clamp: [Expr, Expr, Expr] }
  // table lookup on a parameter's string value, with an optional fallback
  | {
      lookup:
        | [ExprRef, Record<string, number>]
        | [ExprRef, Record<string, number>, number];
    }
  // condition, value to compare against, then, else
  | { when: [ExprRef, string | number | boolean, Expr, Expr] }
  // escape hatch into customFormulas.ts, for machines whose rule is genuinely
  // branchier than a tree can carry
  | { custom: string };

// A parameter's value once the node's config has been resolved against the
// machine's declaration. `numeric` is what arithmetic sees; `props` carries the
// extras a tier has, so a coil can offer both its heat and its tier
export interface ParamValue {
  raw: string | number | boolean;
  numeric: number;
  props?: Record<string, number>;
}

export interface ExprEnv {
  /** GT voltage tier of the summed hatch voltage — what N x tier formulas read */
  tier: number;
  amps: number;
  recipe: { heat: number; eut: number; duration: number };
  params: Record<string, ParamValue>;
  config: Record<string, number>;
  custom?: Record<string, (env: ExprEnv) => number>;
}

// ---------------------------------------------------------------------------
// parameters
// ---------------------------------------------------------------------------

export type ParamKind =
  | 'coilTier'
  | 'voltageTier'
  | 'pipeCasingTier'
  | 'itemPipeCasingTier'
  | 'count'
  | 'enum'
  | 'boolean';

interface ParamBase {
  id: string;
  label: string;
  help?: string;
  /** The single parameter shown inline on the node; the rest go behind the gear */
  primary?: boolean;
  /** An unset value is a graph issue rather than a silent default */
  required?: boolean;
}

export interface CoilTierParam extends ParamBase {
  kind: 'coilTier';
  default: string;
  allowed?: string[];
}

export interface VoltageTierParam extends ParamBase {
  kind: 'voltageTier';
  default: string;
  min?: string;
  max?: string;
}

export interface CasingTierParam extends ParamBase {
  kind: 'pipeCasingTier' | 'itemPipeCasingTier';
  default: string;
  allowed?: string[];
}

export interface CountParam extends ParamBase {
  kind: 'count';
  min: number;
  max: number;
  step?: number;
  default: number;
}

export interface EnumParam extends ParamBase {
  kind: 'enum';
  options: { value: string; label: string; numeric?: number }[];
  default: string;
}

export interface BooleanParam extends ParamBase {
  kind: 'boolean';
  default: boolean;
}

export type MachineParam =
  | CoilTierParam
  | VoltageTierParam
  | CasingTierParam
  | CountParam
  | EnumParam
  | BooleanParam;

// ---------------------------------------------------------------------------
// shared data files
// ---------------------------------------------------------------------------

export interface Coil {
  id: string;
  /** The HeatingCoilLevel constant this came from */
  enum: string;
  name: string;
  /** HeatingCoilLevel.getHeat() */
  heat: number;
  /** HeatingCoilLevel.getTier() — Cupronickel is 0 */
  tier: number;
  ordinal: number;
  /** False for None and the never-implemented ULV entry */
  available: boolean;
}

export interface CoilData {
  schemaVersion: number;
  source: string;
  coils: Coil[];
}

export interface GTConfigData {
  schemaVersion: number;
  source: string;
  values: Record<string, number>;
}

// ---------------------------------------------------------------------------
// the machine record
// ---------------------------------------------------------------------------

export type ModId =
  | 'gregtech'
  | 'gtplusplus'
  | 'tectech'
  | 'bartworks'
  | 'bwcrossmod'
  | 'gtnhintergalactic'
  | 'kubatech'
  | 'goodgenerator'
  | 'kekztech'
  | 'gtnhlanth'
  | 'ggfab'
  /** Not a GT machine at all — Ender Quarry, Stargate, Draconic Reactor */
  | 'external';

export interface MachineSource {
  /** Fully qualified controller class — the extractor's stable key */
  className: string;
  unlocalizedName?: string;
  mod: ModId;
  /** Repo-relative path of the `new MTEx(...)` call site */
  registeredIn?: string;
  nameFrom: 'registration' | 'lang' | 'override' | 'manual';
}

export type ParallelModel =
  /** The controller never calls setMaxParallel, so GT's default of 1 stands */
  | { kind: 'none' }
  | { kind: 'constant'; value: number }
  | { kind: 'formula'; expr: Expr }
  /** We could not read it. never silently treated as 1 */
  | { kind: 'unknown'; reason: string; assume: number };

/**
 * Mirrors `gregtech.api.logic.ProcessingLogic`. Every field is optional and an
 * absent one means GT's own default.
 *
 * Note that ProcessingLogic's setEuModifier/setSpeedBonus and
 * OverclockCalculator's setEUtDiscount/setDurationModifier are the SAME two
 * knobs — createOverclockCalculator forwards one to the other by assignment,
 * not by multiplication — so the catalog carries one field for each pair, and a
 * controller that sets both simply overwrites.
 */
export interface ProcessingConfig {
  parallel: ParallelModel;
  batchSize?: number;
  /** ProcessingLogic.setEuModifier / OverclockCalculator.setEUtDiscount */
  eutModifier?: Expr;
  /** ProcessingLogic.setSpeedBonus / OverclockCalculator.setDurationModifier */
  durationModifier?: Expr;
  /** SetOverclock(timeReduction, powerIncrease) / enablePerfectOverclock() */
  overclock?: { durationDecreasePerOC: number; eutIncreasePerOC: number };
  /** Multiblocks set this per recipe in setProcessingLogicPower, so it is true */
  amperageOC?: boolean;
  maxTierSkips?: number | 'unlimited';
  voidProtection?: boolean;
}

export interface HeatConfig {
  /** SetHeatOC — an overclock per 1800 K of surplus, dividing duration by 4 */
  heatOC: boolean;
  /** SetHeatDiscount — a power discount per 900 K of surplus */
  heatDiscount: boolean;
  heatDiscountExponent?: number;
  /** SetMachineHeat(...) — what the coil parameter feeds */
  machineHeat: Expr;
  /**
   * SetRecipeHeat(recipe.mSpecialValue); explicit so an exception stays
   * representable
   */
  recipeHeatFrom: 'recipe.heat';
}

export interface LaserConfig {
  enabled: true;
  amps: Expr;
}

/** Mirrors the `OverclockCalculator` setters a controller applies. */
export interface CalculatorConfig {
  noOverclock?: boolean;
  maxOverclocks?: Expr;
  maxRegularOverclocks?: Expr;
  /** The machine computes its own base duration, like the Neutron Activator */
  durationUnderOneTick?: boolean;
  heat?: HeatConfig;
  laser?: LaserConfig;
}

export type Confidence = 'modelled' | 'partial' | 'unknown';

/**
 * Where each section of a machine's data came from. `generated` is the
 * extractor, `override` a curated patch, `manual` a hand-written entry,
 * `default` GT's own default for a setter the controller never calls.
 */
export interface Provenance {
  identity: 'generated' | 'override' | 'manual';
  parallel: 'generated' | 'override' | 'manual' | 'default';
  processing: 'generated' | 'override' | 'manual' | 'default';
  calculator: 'generated' | 'override' | 'manual' | 'default';
  params: 'generated' | 'override' | 'manual' | 'none';
}

export interface Machine {
  /** Stable slug, the primary key. never changes, even when the name does */
  id: string;
  name: string;
  /** Legacy names, wiki shorthand, tier family names — also feeds search */
  aliases: string[];
  role: 'recipe' | 'generator' | 'passive';
  source: MachineSource;
  params: MachineParam[];
  processing: ProcessingConfig;
  calculator: CalculatorConfig;
  confidence: Confidence;
  provenance: Provenance;
  /** Why something is partial or unknown; surfaced in the UI */
  notes?: string;
}

export interface MachineCatalog {
  schemaVersion: number;
  gtVersion: string;
  generatedAt: string;
  machines: Machine[];
}

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

/**
 * A node's machine parameter values, keyed by the ids the machine declares.
 *
 * A bag rather than named fields because the machine DATA declares which
 * parameters exist; typing them here would put that declaration in two places
 * and make adding a machine a TypeScript change. Safety comes back at the one
 * read boundary, resolveMachine, which validates and defaults every value.
 */
export type MachineConfig = Record<string, string | number | boolean>;

/** What the engine needs before a machine's formulas can be evaluated */
export interface MachineContext {
  /** GT voltage tier of the SUMMED hatch voltage */
  tier: number;
  amps: number;
  recipe: { heat: number; eut: number; duration: number };
}

/** A machine with every formula evaluated against one node's configuration */
export interface ResolvedMachine {
  id: string;
  name: string;
  aliases: string[];
  /** False when the name matched nothing and this is the fallback */
  known: boolean;
  /** False when GT's own rules do not apply — values pass through as entered */
  modeled: boolean;

  eutIncreasePerOC: number;
  durationDecreasePerOC: number;
  durationDecreasePerHeatOC: number;
  eutModifier: number;
  durationModifier: number;
  amperageOC: boolean;
  laserOC: boolean;
  heatOC: boolean;
  heatDiscount: boolean;
  heatDiscountExponent: number;
  maxOverclocks: number;
  maxRegularOverclocks: number;
  maxTierSkip: number;
  noOverclock: boolean;

  machineHeat: number;
  maxParallel: number;
  /** False when the parallel model is `unknown` and maxParallel is a guess */
  parallelKnown: boolean;
  laserAmps?: number;
  /** The machine reads recipe heat, so the node should offer the field */
  requiresHeat: boolean;

  parameters: MachineParam[];
  /** Every parameter's resolved value, for the UI and for error messages */
  values: Record<string, ParamValue>;
  confidence: Confidence;
  notes?: string;
}
