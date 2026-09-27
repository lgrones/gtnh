import coilData from '@/data/coils.json';
import gtConfig from '@/data/gtConfig.json';
import catalogData from '@/data/machines.json';

import { RECIPE_TIERS, RECIPE_TIER_EU, type RecipeTier } from '../tiers';
import { CUSTOM_FORMULAS } from './customFormulas';
import { evaluate } from './expr';
import type {
  Coil,
  CoilData,
  Expr,
  ExprEnv,
  GTConfigData,
  Machine,
  MachineCatalog,
  MachineConfig,
  MachineContext,
  MachineParam,
  ParamValue,
  ResolvedMachine,
} from './types';

// The app's view of the generated catalog: look a machine up by whatever name a
// saved graph happens to hold, then resolve its formulas against one node's
// configuration.

// JSON imports widen literal types, so the shape is asserted once here. What
// actually checks it is catalog.test.ts, at runtime, against these same files
const CATALOG = catalogData as unknown as MachineCatalog;
const COILS = (coilData as unknown as CoilData).coils;
const CONFIG = (gtConfig as unknown as GTConfigData).values;

export const MACHINES: Machine[] = CATALOG.machines;
export const GT_VERSION = CATALOG.gtVersion;
export const COIL_LADDER: Coil[] = COILS;
export const AVAILABLE_COILS: Coil[] = COILS.filter(coil => coil.available);

// ---------------------------------------------------------------------------
// lookup and search
// ---------------------------------------------------------------------------

// nobody types `Large Chemical Reactor` — they type `lcr`. every machine is
// therefore searchable by its initials, which is what the community's short
// forms almost always are

// words nobody voices as an initial. `Eye of Harmony` is EoH, not EH, so both
// the with- and without-minor-words spellings are generated
const MINOR_WORDS = new Set(['and', 'of', 'the', 'with']);

const initials = (name: string, keepMinor: boolean) =>
  name
    .split(/[\s-]+/)
    .filter(
      word =>
        word !== '' && (keepMinor || !MINOR_WORDS.has(word.toLowerCase())),
    )
    .map(word => word[0])
    .join('')
    .toLowerCase();

/**
 * Initials and short forms, derived rather than stored — a rename regenerates
 * them
 */
export const searchTerms = (machine: Machine): string[] => [
  ...new Set([
    initials(machine.name, true),
    initials(machine.name, false),
    ...machine.aliases.map(alias => alias.toLowerCase()),
  ]),
];

// punctuation and spacing drift between the wiki, the game and what people type
const normalize = (value: string) =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim();

const BY_ID = new Map(MACHINES.map(machine => [machine.id, machine]));

const BY_NAME = new Map<string, Machine>();
for (const machine of MACHINES) {
  BY_NAME.set(machine.name, machine);
}

// aliases and normalized spellings are a fallback, so a real name always wins
const BY_LOOSE = new Map<string, Machine>();
for (const machine of MACHINES) {
  for (const key of [machine.name, ...machine.aliases]) {
    const loose = normalize(key);
    if (!BY_LOOSE.has(loose)) BY_LOOSE.set(loose, machine);
  }
}

const TERMS = new Map(
  MACHINES.map(machine => [machine.name, searchTerms(machine)]),
);

/**
 * Resolve whatever a node is holding. Tried in order: the machine id, then an
 * exact display name, then an alias or a loosened spelling.
 *
 * Saved graphs persist the display name as `data.machine`, and names drift
 * between pack versions, so this is the compatibility seam — a name that moved
 * gets an entry in aliases.json and keeps resolving forever.
 */
export const findMachine = (name: string): Machine | undefined =>
  BY_ID.get(name) ?? BY_NAME.get(name) ?? BY_LOOSE.get(normalize(name));

/** Flat, name-sorted — the order the machine Select renders in */
export const MACHINE_OPTIONS: string[] = MACHINES.map(
  machine => machine.name,
).sort((a, b) => a.localeCompare(b));

// a machine matches if the search appears anywhere in its name or one of its
// aliases, or starts one of its initials. initials match by prefix rather than
// substring so that `cr` doesn't drag in every machine whose initials merely
// contain those two
export const matchesMachine = (name: string, search: string): boolean => {
  const query = search.trim().toLowerCase();
  if (query === '') return true;
  if (name.toLowerCase().includes(query)) return true;

  const machine = BY_NAME.get(name);
  if (machine === undefined) return false;

  // aliases match on a word boundary rather than anywhere inside, so searching
  // `sifter` still finds a machine aliased `Large Sifter`, while `cr` does not
  // drag in everything aliased `LCR`
  const aliasHit = machine.aliases.some(alias => {
    const lower = alias.toLowerCase();
    return (
      lower.startsWith(query) ||
      lower.split(/[\s-]+/).some(word => word.startsWith(query))
    );
  });
  if (aliasHit) return true;

  return (TERMS.get(name) ?? []).some(term => term.startsWith(query));
};

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

const coilById = (id: string): Coil | undefined =>
  COILS.find(coil => coil.id === id);

const countClamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

// Resolve one declared parameter against what the node saved, falling back to
// the declared default whenever the saved value is missing or no longer valid —
// a coil that was renamed, an enum option that was dropped.
const resolveParam = (param: MachineParam, saved: unknown): ParamValue => {
  switch (param.kind) {
    case 'coilTier': {
      const chosen =
        (typeof saved === 'string' ? coilById(saved) : undefined) ??
        coilById(param.default);
      if (chosen === undefined)
        throw new ReferenceError(
          `coil parameter "${param.id}" has no valid value and its default "${param.default}" is not in coils.json`,
        );
      return {
        raw: chosen.id,
        numeric: chosen.heat,
        // both are read in the wild: the EBF wants heat, the Pyrolyse Oven tier
        props: { heat: chosen.heat, tier: chosen.tier, index: chosen.ordinal },
      };
    }

    case 'voltageTier': {
      const candidate = typeof saved === 'string' ? saved : param.default;
      const tier = (RECIPE_TIERS as readonly string[]).includes(candidate)
        ? (candidate as RecipeTier)
        : (param.default as RecipeTier);
      const index = RECIPE_TIERS.indexOf(tier);
      return {
        raw: tier,
        // GT numbers tiers with LV at 1, which is this ladder's index
        numeric: index,
        props: { index, eu: RECIPE_TIER_EU[tier] },
      };
    }

    case 'count': {
      const candidate = typeof saved === 'number' ? saved : param.default;
      const value = countClamp(Math.floor(candidate), param.min, param.max);
      return { raw: value, numeric: value };
    }

    case 'enum': {
      const chosen =
        param.options.find(option => option.value === saved) ??
        param.options.find(option => option.value === param.default);
      if (chosen === undefined)
        throw new ReferenceError(
          `enum parameter "${param.id}" has no option matching its default "${param.default}"`,
        );
      return {
        raw: chosen.value,
        numeric: chosen.numeric ?? param.options.indexOf(chosen),
      };
    }

    case 'boolean': {
      const value = typeof saved === 'boolean' ? saved : param.default;
      return { raw: value, numeric: value ? 1 : 0 };
    }

    // The GT++ casing ladders are read out of structure-check code the
    // extractor does not parse yet, so there is no data to resolve against.
    // Throwing is deliberate: the guard test asserts no machine declares one,
    // so this surfaces at build time rather than in front of a user
    default:
      throw new ReferenceError(
        `parameter "${param.id}" is a ${param.kind}, and that ladder has not been extracted yet`,
      );
  }
};

/** GT's own defaults, for a machine we have no data for */
const FALLBACK = {
  eutIncreasePerOC: 4,
  durationDecreasePerOC: 2,
  durationDecreasePerHeatOC: 4,
  eutModifier: 1,
  durationModifier: 1,
  laserOC: false,
  heatOC: false,
  heatDiscount: false,
  heatDiscountExponent: 0.95,
  maxOverclocks: Number.MAX_SAFE_INTEGER,
  maxRegularOverclocks: Number.MAX_SAFE_INTEGER,
  maxTierSkip: 1,
  noOverclock: false,
  machineHeat: 0,
  requiresHeat: false,
} as const;

/**
 * A machine the catalog has never heard of — a name from an older graph, or one
 * the extractor could not reach. It runs GT's plain rules at one parallel, and
 * `known: false` is what the issue panel reports rather than pretending.
 */
export const unknownMachine = (
  name: string,
  amperageOC: boolean,
): ResolvedMachine => ({
  ...FALLBACK,
  id: '',
  name,
  aliases: [],
  known: false,
  modeled: false,
  amperageOC,
  maxParallel: 1,
  parallelKnown: false,
  parameters: [],
  values: {},
  confidence: 'unknown',
  notes: 'Not in the machine catalog — its numbers are left as entered.',
});

const evaluateOr = (
  expr: Expr | undefined,
  env: ExprEnv,
  fallback: number,
): number => (expr === undefined ? fallback : evaluate(expr, env));

const parallelOf = (
  machine: Machine,
  env: ExprEnv,
): { maxParallel: number; known: boolean } => {
  const model = machine.processing.parallel;
  switch (model.kind) {
    case 'none':
      return { maxParallel: 1, known: true };
    case 'constant':
      return { maxParallel: model.value, known: true };
    case 'formula':
      return {
        maxParallel: Math.max(0, Math.floor(evaluate(model.expr, env))),
        known: true,
      };
    // never silently 1: the caller reports that this is a guess
    case 'unknown':
      return { maxParallel: model.assume, known: false };
  }
};

/**
 * Evaluate every formula a machine carries against one node's parameter values,
 * producing the flat set of numbers the overclock engine consumes.
 */
export const resolveMachine = (
  machine: Machine | undefined,
  config: MachineConfig | undefined,
  context: MachineContext,
  fallbackName = '',
): ResolvedMachine => {
  if (machine === undefined) return unknownMachine(fallbackName, true);

  const values: Record<string, ParamValue> = {};
  for (const param of machine.params) {
    values[param.id] = resolveParam(param, config?.[param.id]);
  }

  const env: ExprEnv = {
    tier: context.tier,
    amps: context.amps,
    recipe: context.recipe,
    params: values,
    config: CONFIG,
    custom: CUSTOM_FORMULAS,
  };

  const { processing, calculator } = machine;
  const { maxParallel, known: parallelKnown } = parallelOf(machine, env);
  const heat = calculator.heat;

  return {
    id: machine.id,
    name: machine.name,
    aliases: machine.aliases,
    known: true,
    modeled: machine.confidence !== 'unknown',

    eutIncreasePerOC:
      processing.overclock?.eutIncreasePerOC ?? FALLBACK.eutIncreasePerOC,
    durationDecreasePerOC:
      processing.overclock?.durationDecreasePerOC ??
      FALLBACK.durationDecreasePerOC,
    durationDecreasePerHeatOC: FALLBACK.durationDecreasePerHeatOC,
    eutModifier: evaluateOr(processing.eutModifier, env, FALLBACK.eutModifier),
    durationModifier: evaluateOr(
      processing.durationModifier,
      env,
      FALLBACK.durationModifier,
    ),
    amperageOC: processing.amperageOC ?? false,
    laserOC: calculator.laser !== undefined,
    heatOC: heat?.heatOC ?? FALLBACK.heatOC,
    heatDiscount: heat?.heatDiscount ?? FALLBACK.heatDiscount,
    heatDiscountExponent:
      heat?.heatDiscountExponent ?? FALLBACK.heatDiscountExponent,
    maxOverclocks: evaluateOr(
      calculator.maxOverclocks,
      env,
      FALLBACK.maxOverclocks,
    ),
    maxRegularOverclocks: evaluateOr(
      calculator.maxRegularOverclocks,
      env,
      FALLBACK.maxRegularOverclocks,
    ),
    maxTierSkip:
      processing.maxTierSkips === 'unlimited'
        ? Number.MAX_SAFE_INTEGER
        : (processing.maxTierSkips ?? FALLBACK.maxTierSkip),
    noOverclock: calculator.noOverclock ?? FALLBACK.noOverclock,

    machineHeat:
      heat === undefined
        ? FALLBACK.machineHeat
        : evaluate(heat.machineHeat, env),
    maxParallel,
    parallelKnown,
    laserAmps:
      calculator.laser === undefined
        ? undefined
        : evaluate(calculator.laser.amps, env),
    requiresHeat: heat !== undefined,

    parameters: machine.params,
    values,
    confidence: machine.confidence,
    notes: machine.notes,
  };
};
