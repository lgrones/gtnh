import type { RawCatalog } from '@/domain/machines/merge';
import type {
  CalculatorConfig,
  Confidence,
  Expr,
  HeatConfig,
  Machine,
  MachineParam,
  ModId,
  ParallelModel,
  ProcessingConfig,
  Provenance,
} from '@/domain/machines/types';

import {
  anonymousBody,
  callSites,
  constants,
  fieldAssignments,
  localDeclarations,
  methodBody,
  parseJavaFile,
  returnExpressions,
  type JavaClass,
  type JavaFile,
} from './classes';
import { JavaParseError, parseJava, type JavaExpr } from './javaExpr';
import { displayName, type Lang } from './lang';
import { MapError, mapJava, type MapOptions } from './mapExpr';
import { lineOf } from './scrub';
import type { SourceFile } from './source';

// The extractor proper: from 2834 Java files to one catalog record per
// controller, plus an honest list of everything it could not read.
//
// Every controller in GTNH — gregtech's own and all ten addons' — is a subclass
// of `MTEMultiBlockBase`, so the set of machines is not a hand-kept list but
// whatever that class graph contains. Adding a machine upstream adds it here.

/** Every mod in the repo, by the package its controllers live under */
const MODS: Record<string, ModId> = {
  gregtech: 'gregtech',
  gtPlusPlus: 'gtplusplus',
  tectech: 'tectech',
  bartworks: 'bartworks',
  bwcrossmod: 'bwcrossmod',
  gtnhintergalactic: 'gtnhintergalactic',
  kubatech: 'kubatech',
  goodgenerator: 'goodgenerator',
  kekztech: 'kekztech',
  gtnhlanth: 'gtnhlanth',
  ggfab: 'ggfab',
};

const ROOT_CONTROLLER = 'MTEMultiBlockBase';

export interface Unresolved {
  /** Display name if one was found, otherwise the class */
  machine: string;
  className: string;
  /** Which setting could not be read — `parallel`, `setEuModifier`, … */
  what: string;
  java: string;
  reason: string;
  file: string;
  line: number;
}

export interface ExtractReport {
  /** Controllers with no `new X(id, unloc, name)` call site anywhere */
  unnamed: string[];
  /** Two controllers registered under the same display name */
  duplicateNames: string[];
  unresolved: Unresolved[];
  parallelKinds: Record<string, number>;
  paramKinds: Record<string, number>;
  confidence: Record<Confidence, number>;
  byMod: Record<string, number>;
}

export interface Extraction {
  catalog: RawCatalog;
  report: ExtractReport;
}

// ---------------------------------------------------------------------------
// the class graph
// ---------------------------------------------------------------------------

interface Index {
  files: JavaFile[];
  byName: Map<string, JavaClass>;
  /** Simple names of every class that transitively extends the root */
  controllers: JavaClass[];
}

const indexSource = (files: SourceFile[]): Index => {
  const parsed = files.map(file => parseJavaFile(file.path, file.text));

  const byName = new Map<string, JavaClass>();
  for (const file of parsed)
    for (const klass of file.classes)
      // first definition wins; a duplicate simple name across mods is rare and
      // never a controller, so this does not need to be smarter
      if (!byName.has(klass.name)) byName.set(klass.name, klass);

  const children = new Map<string, JavaClass[]>();
  for (const klass of byName.values()) {
    if (klass.superName === undefined) continue;
    children.set(klass.superName, [
      ...(children.get(klass.superName) ?? []),
      klass,
    ]);
  }

  const descendants: JavaClass[] = [];
  const seen = new Set<string>();
  const queue = [ROOT_CONTROLLER];
  while (queue.length > 0) {
    const name = queue.pop();
    if (name === undefined) continue;
    for (const child of children.get(name) ?? []) {
      if (seen.has(child.name)) continue;
      seen.add(child.name);
      descendants.push(child);
      queue.push(child.name);
    }
  }

  return {
    files: parsed,
    byName,
    // an abstract class is a shared base, not a machine anyone builds
    controllers: descendants
      .filter(klass => !klass.isAbstract && !klass.isInterface)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
};

/** A class and its ancestors, nearest first, for resolving an inherited method */
const ancestry = (klass: JavaClass, byName: Map<string, JavaClass>) => {
  const chain: JavaClass[] = [klass];
  let current = klass;
  while (current.superName !== undefined) {
    const parent = byName.get(current.superName);
    if (parent === undefined || chain.includes(parent)) break;
    chain.push(parent);
    current = parent;
  }
  return chain;
};

// ---------------------------------------------------------------------------
// display names
// ---------------------------------------------------------------------------

export interface Registration {
  unlocalizedName: string;
  displayName: string;
  /** Repo-relative path of the `new MTEx(…)` call */
  file: string;
  line: number;
}

// `new MTEElectricBlastFurnace(EBF_CONTROLLER.ID, "multimachine.blastfurnace",
// "Electric Blast Furnace")` — the third argument is the name the game shows,
// which is the name saved graphs hold.
//
// The qualifier before the class name is optional and ignored: bartworks writes
// `new MTEVoidMiners.VMUV(…)` and gtnhintergalactic
// `new TileEntityModuleMiner.TileEntityModuleMinerT1(…)`, both nested classes
// whose registration would otherwise be invisible.
const registrations = (
  index: Index,
  wanted: ReadonlySet<string>,
): Map<string, Registration> => {
  const found = new Map<string, Registration>();

  for (const file of index.files) {
    const { text, literals } = file.scrubbed;

    for (const match of text.matchAll(/\bnew\s+(?:\w+\s*\.\s*)*(\w+)\s*\(/g)) {
      const name = match[1];
      if (name === undefined || !wanted.has(name) || found.has(name)) continue;

      // the constructor's arguments end at the first `;` — far cheaper than
      // matching brackets, and a registration is always one statement
      const end = text.indexOf(';', match.index);
      const window = text.slice(match.index, end === -1 ? undefined : end);

      const strings: string[] = [];
      for (const quote of window.matchAll(/"/g)) {
        const literal = literals.get(match.index + quote.index);
        if (literal !== undefined) strings.push(literal);
      }

      const [unlocalizedName, displayName] = strings;
      if (unlocalizedName === undefined || displayName === undefined) continue;

      found.set(name, {
        unlocalizedName,
        displayName,
        file: file.path,
        line: lineOf(text, match.index),
      });
    }
  }

  return found;
};

const slug = (name: string) =>
  name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '');

// ---------------------------------------------------------------------------
// reading one controller
// ---------------------------------------------------------------------------

// The two builder chains, and every setter worth reading out of them. Both live
// in one string per machine because GT puts calculator setters inside the
// anonymous ProcessingLogic as often as in createOverclockCalculator.
const PROCESSING_SETTERS = [
  'setMaxParallel',
  'setMaxParallelSupplier',
  'setBatchSize',
  'setEuModifier',
  'setSpeedBonus',
  'setMaxTierSkips',
  'setUnlimitedTierSkips',
  'setOverclock',
  'enablePerfectOverclock',
  'setVoidProtection',
];

const CALCULATOR_SETTERS = [
  'setEUtDiscount',
  'setDurationModifier',
  'setHeatOC',
  'setHeatDiscount',
  'setHeatDiscountMultiplier',
  'setMachineHeat',
  'setRecipeHeat',
  'setNoOverclock',
  'setMaxOverclocks',
  'setMaxRegularOverclocks',
  'setEUtIncreasePerOC',
  'setDurationDecreasePerOC',
  'setLaserOC',
  'setDurationUnderOneTickSupplier',
  'enablePerfectOC',
];

/**
 * The builder text for a controller, inherited from an ancestor when it has
 * none
 */
const builderText = (chain: JavaClass[]): string => {
  const parts: string[] = [];

  for (const method of ['createProcessingLogic', 'createOverclockCalculator']) {
    const owner = chain.find(klass => methodBody(klass, method) !== undefined);
    if (owner === undefined) continue;
    const body = methodBody(owner, method);
    if (body !== undefined) parts.push(body.text);
  }

  return parts.join('\n');
};

interface Reader {
  chain: JavaClass[];
  options: MapOptions;
  note: (what: string, java: string, reason: string, line?: number) => void;
}

/** Parse and map one snippet of Java, recording a failure rather than throwing */
const readExpr = (
  reader: Reader,
  what: string,
  java: string,
  /** Extra names in scope for this snippet alone — a method's own locals */
  scope?: Record<string, JavaExpr>,
): { expr: Expr; params: MachineParam[] } | undefined => {
  let parsed: JavaExpr;
  try {
    parsed = parseJava(java);
  } catch (error) {
    reader.note(
      what,
      java,
      error instanceof JavaParseError ? error.message : String(error),
    );
    return undefined;
  }

  const options =
    scope === undefined
      ? reader.options
      : { ...reader.options, fields: { ...reader.options.fields, ...scope } };

  try {
    return mapJava(parsed, options);
  } catch (error) {
    reader.note(
      what,
      java,
      error instanceof MapError ? error.message : String(error),
    );
    return undefined;
  }
};

const readNumber = (
  reader: Reader,
  what: string,
  java: string,
): number | undefined => {
  const mapped = readExpr(reader, what, java);
  if (mapped === undefined) return undefined;
  if (typeof mapped.expr !== 'number') {
    reader.note(what, java, 'expected a constant, got a formula');
    return undefined;
  }
  return mapped.expr;
};

/**
 * A boolean setter's value: `undefined` when the controller never calls it,
 * which is a different thing from calling it with an argument this cannot
 * read.
 *
 * The distinction matters more than it looks — reading "never called" as `true`
 * would switch heat overclocking on for every machine in the pack.
 */
const readFlag = (args: string[] | undefined): boolean | undefined => {
  if (args === undefined) return undefined;
  const [java] = args;
  if (java === undefined) return true; // `setHeatOC()` with no argument
  if (java === 'true') return true;
  if (java === 'false') return false;
  return undefined;
};

// ---------------------------------------------------------------------------
// parallels
// ---------------------------------------------------------------------------

const readParallel = (
  reader: Reader,
  calls: Map<string, string[]>,
): { model: ParallelModel; params: MachineParam[] } => {
  const params: MachineParam[] = [];

  // `setMaxParallel(8)` in the builder wins: it is the parallel the logic is
  // actually given, and a controller that sets it does not override
  // getMaxParallelRecipes as well
  const direct = calls.get('setMaxParallel')?.[0];
  if (direct !== undefined) {
    const mapped = readExpr(reader, 'setMaxParallel', direct);
    if (mapped === undefined)
      return {
        model: {
          kind: 'unknown',
          reason: `setMaxParallel(${direct})`,
          assume: 1,
        },
        params,
      };
    params.push(...mapped.params);
    return {
      model:
        typeof mapped.expr === 'number'
          ? { kind: 'constant', value: mapped.expr }
          : { kind: 'formula', expr: mapped.expr },
      params,
    };
  }

  // getTrueParallel() is getMaxParallelRecipes() clamped by the in-game power
  // panel's user limit, so a controller that supplies either method has the
  // same extraction target — the limiter is a runtime setting, not machine data
  const supplier = calls.get('setMaxParallelSupplier')?.[0];
  const suppliesSelf =
    supplier !== undefined &&
    (supplier.includes('getTrueParallel') ||
      supplier.includes('getMaxParallelRecipes'));
  if (supplier !== undefined && !suppliesSelf)
    return {
      model: {
        kind: 'unknown',
        reason: `setMaxParallelSupplier(${supplier}) is not this::getTrueParallel`,
        assume: 1,
      },
      params,
    };

  // getTrueParallel() is max(1, min(getMaxParallelRecipes(), user limit)), so
  // the supplier resolves to the override — or, when nothing overrides it, to
  // MTEMultiBlockBase's own `return 1`
  const owner = reader.chain.find(
    klass => methodBody(klass, 'getMaxParallelRecipes') !== undefined,
  );
  if (owner === undefined || owner.name === ROOT_CONTROLLER)
    return { model: { kind: 'none' }, params };

  const body = methodBody(owner, 'getMaxParallelRecipes');
  const returns = body === undefined ? [] : returnExpressions(body.text);
  if (returns.length !== 1) {
    const reason =
      returns.length === 0
        ? 'getMaxParallelRecipes has no plain return'
        : `getMaxParallelRecipes returns from ${returns.length} places`;
    reader.note('parallel', returns.join(' | '), reason, body?.line);
    return { model: { kind: 'unknown', reason, assume: 1 }, params };
  }

  const java = returns[0] ?? '';
  // the method's own locals, so `return … * tTier` can see what tTier was
  // declared as. Parsed here rather than in mapExpr because they are in scope
  // for this one body and nothing else
  const locals: Record<string, JavaExpr> = {};
  for (const [name, value] of Object.entries(
    localDeclarations(body?.text ?? ''),
  )) {
    try {
      locals[name] = parseJava(value);
    } catch {
      // an unparseable local leaves the name unresolved, which is reported
      // against the formula that uses it
    }
  }

  const mapped = readExpr(reader, 'parallel', java, locals);
  if (mapped === undefined)
    return {
      model: {
        kind: 'unknown',
        reason: `getMaxParallelRecipes: ${java}`,
        assume: 1,
      },
      params,
    };

  params.push(...mapped.params);
  return {
    model:
      typeof mapped.expr === 'number'
        ? { kind: 'constant', value: mapped.expr }
        : { kind: 'formula', expr: mapped.expr },
    params,
  };
};

// ---------------------------------------------------------------------------
// one machine
// ---------------------------------------------------------------------------

const readMachine = (
  klass: JavaClass,
  index: Index,
  registration: Registration | undefined,
  lang: Lang,
  configKeys: ReadonlySet<string>,
  unresolved: Unresolved[],
): Machine => {
  const chain = ancestry(klass, index.byName);
  const named = displayName(
    lang,
    registration?.unlocalizedName,
    registration?.displayName,
  );
  const name = named?.name ?? klass.name;

  const note = (what: string, java: string, reason: string, line?: number) => {
    unresolved.push({
      machine: name,
      className: klass.fqn,
      what,
      java,
      reason,
      file: klass.file,
      line: line ?? klass.line,
    });
  };

  // constants and resolvable fields from the whole chain, nearest first, so a
  // subclass's value shadows its parent's
  const folded: Record<string, number> = {};
  for (const ancestor of [...chain].reverse())
    Object.assign(folded, constants(ancestor));

  const fields: Record<string, JavaExpr> = {};
  for (const ancestor of chain)
    for (const field of ['mHeatingCapacity', 'mCoilTier', 'heatLevel']) {
      if (field in fields) continue;
      const assignments = fieldAssignments(ancestor, field);
      // more than one meaningful assignment means the field depends on a branch
      // this parser cannot see; leave it unresolved rather than picking one
      if (assignments.length !== 1) continue;
      try {
        fields[field] = parseJava(assignments[0] ?? '');
      } catch {
        // an unparseable assignment simply leaves the field unresolved, and any
        // formula using it is reported when it fails to map
      }
    }

  const reader: Reader = {
    chain,
    options: { constants: folded, configKeys, fields },
    note,
  };

  const text = builderText(chain);
  const scope =
    anonymousBody(text, 'ProcessingLogic') === undefined
      ? text
      : `${text}\n${anonymousBody(text, 'ProcessingLogic') ?? ''}`;

  const calls = new Map<string, string[]>();
  for (const site of callSites(scope, [
    ...PROCESSING_SETTERS,
    ...CALCULATOR_SETTERS,
  ]))
    if (!calls.has(site.name)) calls.set(site.name, site.args);

  const params = new Map<string, MachineParam>();
  const declare = (declared: MachineParam[]) => {
    for (const param of declared) params.set(param.id, param);
  };

  // --- parallels -----------------------------------------------------------
  const parallel = readParallel(reader, calls);
  declare(parallel.params);

  // --- the two shared modifiers -------------------------------------------
  // ProcessingLogic's setEuModifier/setSpeedBonus and OverclockCalculator's
  // setEUtDiscount/setDurationModifier are the same pair, forwarded by
  // assignment, so a controller setting both simply overwrites
  const modifier = (names: string[], what: string): Expr | undefined => {
    for (const setter of names) {
      const java = calls.get(setter)?.[0];
      if (java === undefined) continue;
      const mapped = readExpr(reader, `${what} (${setter})`, java);
      if (mapped === undefined) continue;
      declare(mapped.params);
      return mapped.expr;
    }
    return undefined;
  };

  const eutModifier = modifier(
    ['setEUtDiscount', 'setEuModifier'],
    'eutModifier',
  );
  const durationModifier = modifier(
    ['setDurationModifier', 'setSpeedBonus'],
    'durationModifier',
  );

  // --- the overclock ratio -------------------------------------------------
  let overclock: ProcessingConfig['overclock'];
  if (calls.has('enablePerfectOverclock') || calls.has('enablePerfectOC'))
    overclock = { durationDecreasePerOC: 4, eutIncreasePerOC: 4 };
  const explicit = calls.get('setOverclock');
  if (explicit !== undefined) {
    const duration = readNumber(reader, 'setOverclock', explicit[0] ?? '');
    const power = readNumber(reader, 'setOverclock', explicit[1] ?? '');
    if (duration !== undefined && power !== undefined)
      overclock = { durationDecreasePerOC: duration, eutIncreasePerOC: power };
  }
  const perOC = calls.get('setDurationDecreasePerOC')?.[0];
  const perEU = calls.get('setEUtIncreasePerOC')?.[0];
  if (perOC !== undefined || perEU !== undefined) {
    const duration =
      perOC === undefined
        ? undefined
        : readNumber(reader, 'setDurationDecreasePerOC', perOC);
    const power =
      perEU === undefined
        ? undefined
        : readNumber(reader, 'setEUtIncreasePerOC', perEU);
    overclock = {
      durationDecreasePerOC: duration ?? overclock?.durationDecreasePerOC ?? 2,
      eutIncreasePerOC: power ?? overclock?.eutIncreasePerOC ?? 4,
    };
  }

  // --- tier skips ----------------------------------------------------------
  let maxTierSkips: ProcessingConfig['maxTierSkips'];
  if (calls.has('setUnlimitedTierSkips')) maxTierSkips = 'unlimited';
  const skips = calls.get('setMaxTierSkips')?.[0];
  if (skips !== undefined)
    maxTierSkips = readNumber(reader, 'setMaxTierSkips', skips) ?? maxTierSkips;

  const batch = calls.get('setBatchSize')?.[0];

  const processing: ProcessingConfig = {
    parallel: parallel.model,
    ...(batch === undefined
      ? {}
      : { batchSize: readNumber(reader, 'setBatchSize', batch) ?? 1 }),
    ...(eutModifier === undefined ? {} : { eutModifier }),
    ...(durationModifier === undefined ? {} : { durationModifier }),
    ...(overclock === undefined ? {} : { overclock }),
    // MTEMultiBlockBase.setProcessingLogicPower calls setAmperageOC(true) for
    // every multiblock, every recipe. This is not per-controller
    amperageOC: true,
    ...(maxTierSkips === undefined ? {} : { maxTierSkips }),
  };

  // --- heat ----------------------------------------------------------------
  const heatOC = readFlag(calls.get('setHeatOC'));
  const heatDiscount = readFlag(calls.get('setHeatDiscount'));
  const machineHeatJava = calls.get('setMachineHeat')?.[0];
  const recipeHeatJava = calls.get('setRecipeHeat')?.[0];

  let heat: HeatConfig | undefined;
  if (machineHeatJava !== undefined && recipeHeatJava !== undefined) {
    const mapped = readExpr(reader, 'setMachineHeat', machineHeatJava);
    if (!recipeHeatJava.includes('mSpecialValue'))
      note(
        'setRecipeHeat',
        recipeHeatJava,
        'recipe heat comes from somewhere other than mSpecialValue',
      );
    else if (mapped !== undefined) {
      declare(mapped.params);
      const exponent = calls.get('setHeatDiscountMultiplier')?.[0];
      heat = {
        heatOC: heatOC ?? false,
        heatDiscount: heatDiscount ?? false,
        machineHeat: mapped.expr,
        recipeHeatFrom: 'recipe.heat',
        ...(exponent === undefined
          ? {}
          : {
              heatDiscountExponent:
                readNumber(reader, 'setHeatDiscountMultiplier', exponent) ??
                0.95,
            }),
      };
    }
  } else if (heatOC === true || heatDiscount === true)
    note(
      'heat',
      `setHeatOC/${String(heatOC)} setHeatDiscount/${String(heatDiscount)}`,
      'heat overclocks are enabled but machine or recipe heat could not be read',
    );

  // --- calculator ----------------------------------------------------------
  const maxOverclocksJava = calls.get('setMaxOverclocks')?.[0];
  const maxRegularJava = calls.get('setMaxRegularOverclocks')?.[0];
  const maxOverclocks =
    maxOverclocksJava === undefined
      ? undefined
      : readExpr(reader, 'setMaxOverclocks', maxOverclocksJava);
  const maxRegular =
    maxRegularJava === undefined
      ? undefined
      : readExpr(reader, 'setMaxRegularOverclocks', maxRegularJava);
  declare(maxOverclocks?.params ?? []);
  declare(maxRegular?.params ?? []);

  if (calls.has('setLaserOC'))
    note(
      'setLaserOC',
      calls.get('setLaserOC')?.join(', ') ?? '',
      'laser overclocking needs the hatch amperage, which is structure state',
    );

  const calculator: CalculatorConfig = {
    ...(readFlag(calls.get('setNoOverclock')) === true
      ? { noOverclock: true }
      : {}),
    ...(maxOverclocks === undefined
      ? {}
      : { maxOverclocks: maxOverclocks.expr }),
    ...(maxRegular === undefined
      ? {}
      : { maxRegularOverclocks: maxRegular.expr }),
    ...(calls.has('setDurationUnderOneTickSupplier')
      ? { durationUnderOneTick: true }
      : {}),
    ...(heat === undefined ? {} : { heat }),
  };

  // --- identity and confidence --------------------------------------------
  const mod = MODS[klass.packageName.split('.')[0] ?? ''] ?? 'gregtech';
  const failures = unresolved.filter(entry => entry.className === klass.fqn);

  const confidence: Confidence =
    parallel.model.kind === 'unknown'
      ? 'unknown'
      : failures.length > 0
        ? 'partial'
        : 'modelled';

  // Anything short of `modelled` has to say what is missing — the node UI shows
  // this text, and "we are not sure about this machine" with no reason is worse
  // than no warning at all. A parallel model can be `unknown` without producing
  // an entry in `failures`, so both sources are folded together here
  const gaps = [
    ...(parallel.model.kind === 'unknown' ? [parallel.model.reason] : []),
    ...failures.map(entry => entry.what),
  ];

  const provenance: Provenance = {
    identity: named === undefined ? 'manual' : 'generated',
    parallel: parallel.model.kind === 'none' ? 'default' : 'generated',
    processing: 'generated',
    calculator: Object.keys(calculator).length === 0 ? 'default' : 'generated',
    params: params.size === 0 ? 'none' : 'generated',
  };

  return {
    id: slug(name),
    name,
    aliases: [],
    role: 'recipe',
    source: {
      className: klass.fqn,
      ...(registration === undefined
        ? {}
        : {
            unlocalizedName: registration.unlocalizedName,
            registeredIn: registration.file,
          }),
      mod,
      nameFrom: named?.from ?? 'manual',
    },
    params: [...params.values()],
    processing,
    calculator,
    confidence,
    provenance,
    ...(gaps.length === 0
      ? {}
      : { notes: `Not fully read from source: ${gaps.join('; ')}.` }),
  };
};

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

const tally = <T extends string>(values: T[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
};

export const extract = (
  files: SourceFile[],
  lang: Lang,
  gtVersion: string,
  configKeys: ReadonlySet<string>,
  generatedAt: string,
): Extraction => {
  const index = indexSource(files);
  const wanted = new Set(index.controllers.map(klass => klass.name));
  const names = registrations(index, wanted);

  const unresolved: Unresolved[] = [];
  const machines = index.controllers.map(klass =>
    readMachine(
      klass,
      index,
      names.get(klass.name),
      lang,
      configKeys,
      unresolved,
    ),
  );

  const seen = new Map<string, string[]>();
  for (const machine of machines)
    seen.set(machine.id, [...(seen.get(machine.id) ?? []), machine.name]);

  const report: ExtractReport = {
    unnamed: machines
      .filter(machine => machine.source.nameFrom === 'manual')
      .map(machine => machine.source.className)
      .sort((a, b) => a.localeCompare(b)),
    duplicateNames: [...seen.entries()]
      .filter(([, held]) => held.length > 1)
      .map(([id, held]) => `${id}: ${held.join(', ')}`),
    unresolved,
    parallelKinds: tally(
      machines.map(machine => machine.processing.parallel.kind),
    ),
    paramKinds: tally(
      machines.flatMap(machine => machine.params.map(p => p.kind)),
    ),
    confidence: {
      modelled: 0,
      partial: 0,
      unknown: 0,
      ...tally(machines.map(machine => machine.confidence)),
    },
    byMod: tally(machines.map(machine => machine.source.mod)),
  };

  return {
    catalog: {
      schemaVersion: 1,
      gtVersion,
      generatedAt,
      // sorted by id so the generated file's diff between GT versions is
      // readable — a machine that moved is a rename, not a reshuffle
      machines: machines.sort((a, b) => a.id.localeCompare(b.id)),
    },
    report,
  };
};
