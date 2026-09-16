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
