import { describe, expect, it } from 'vitest';

import aliasFile from '@/data/gt/aliases.json';
import legacyNames from '@/data/gt/legacyNames.json';
import overrideFile from '@/data/gt/overrides.machines.json';
import rawFile from '@/data/gt/raw.machines.json';
import shipped from '@/data/machines.json';

import {
  findMachine,
  MACHINE_OPTIONS,
  MACHINES,
  matchesMachine,
  resolveMachine,
  searchTerms,
} from './catalog';
import { CUSTOM_FORMULA_LIMIT, CUSTOM_FORMULAS } from './customFormulas';
import { validateExpr } from './expr';
import {
  merge,
  type AliasFile,
  type OverrideFile,
  type RawCatalog,
} from './merge';
import type { Expr, Machine, MachineContext } from './types';

// The catalog is generated, so this file is where the generator's output gets
// held to account. Everything here runs against the shipped JSON — no fixtures,
// no mocks — because the thing being tested is the data.

const raw = rawFile as unknown as RawCatalog;
const overrides = overrideFile as unknown as OverrideFile;
const aliases = aliasFile as unknown as AliasFile;

const CONFIG_KEYS = new Set(['megaMachinesMax', 'bioVatMaxParallelBonus']);

// every formula a machine carries, with a path so a failure names the field
const expressionsOf = (machine: Machine): [string, Expr][] => {
  const found: [string, Expr][] = [];
  const { processing, calculator } = machine;
  if (processing.parallel.kind === 'formula')
    found.push(['processing.parallel', processing.parallel.expr]);
  if (processing.eutModifier !== undefined)
    found.push(['processing.eutModifier', processing.eutModifier]);
  if (processing.durationModifier !== undefined)
    found.push(['processing.durationModifier', processing.durationModifier]);
  if (calculator.maxOverclocks !== undefined)
    found.push(['calculator.maxOverclocks', calculator.maxOverclocks]);
  if (calculator.maxRegularOverclocks !== undefined)
    found.push([
      'calculator.maxRegularOverclocks',
      calculator.maxRegularOverclocks,
    ]);
  if (calculator.heat !== undefined)
    found.push(['calculator.heat.machineHeat', calculator.heat.machineHeat]);
  if (calculator.laser !== undefined)
    found.push(['calculator.laser.amps', calculator.laser.amps]);
  return found;
};

const context = (tier: number): MachineContext => ({
  tier,
  amps: 2,
  recipe: { heat: 1800, eut: 480, duration: 200 },
});

describe('the shipped catalog file', () => {
  it('is the merge of the extractor output and the overrides', () => {
    // a hand edit to the generated artifact fails here rather than surviving
    // quietly until the next extraction wipes it
    expect(shipped).toEqual(
      JSON.parse(JSON.stringify(merge(raw, overrides, aliases))),
    );
  });

  it('records which GT version it came from', () => {
    expect(shipped.schemaVersion).toBe(1);
    expect(shipped.gtVersion).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(Number.isNaN(Date.parse(shipped.generatedAt))).toBe(false);
  });
});

describe('machine identity', () => {
  it('gives every machine a slug id, unique and sorted', () => {
    const ids = MACHINES.map(machine => machine.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
  });

  it('keeps display names and controller classes unique', () => {
    const names = MACHINES.map(machine => machine.name);
    const classes = MACHINES.map(machine => machine.source.className);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(classes).size).toBe(classes.length);
  });

  // an alias that collides with another machine's name would make a saved
  // graph's `data.machine` ambiguous, which is the one thing migration cannot
  // survive
  it('never lets an alias collide with another machine', () => {
    const names = new Set(MACHINES.map(machine => machine.name));
    const seen = new Set<string>();
    for (const machine of MACHINES) {
      for (const alias of machine.aliases) {
        expect(names.has(alias)).toBe(false);
        expect(seen.has(alias)).toBe(false);
        seen.add(alias);
      }
    }
  });
});

describe('finding a machine by whatever a graph saved', () => {
  it('resolves an id, a display name and an alias alike', () => {
    expect(findMachine('volcanus')?.id).toBe('volcanus');
    expect(findMachine('Volcanus')?.id).toBe('volcanus');
    expect(findMachine('Adv EBF')?.id).toBe('volcanus');
  });

  it('forgives punctuation and spacing drift', () => {
    expect(findMachine('large  chemical reactor')?.id).toBe(
      'large_chemical_reactor',
    );
  });

  it('returns nothing rather than guessing', () => {
    expect(findMachine('Definitely Not A Machine')).toBeUndefined();
  });

  // RATCHET. Every one of these strings is persisted inside saved Yjs graphs.
  // Per decision 7 they are reported, not gated: the 14 that do not resolve are
  // machines from mods outside GT5-Unofficial (Ender Quarry, Stargate, Draconic
  // Reactor, Forestry Multifarm) or ones it no longer ships, and aliasing them
  // to a plausible-looking neighbour would be a guess. The number only ever
  // goes up: the extractor fills the catalog, and anything whose name merely
  // moved gets an entry in aliases.json
  it('resolves at least as many legacy names as it did last time', () => {
    const resolved = legacyNames.names.filter(
      name => findMachine(name) !== undefined,
    ).length;
    expect(resolved).toBeGreaterThanOrEqual(131);
    expect(legacyNames.names).toHaveLength(145);
  });
});

describe('searching', () => {
  it('matches everything on an empty query', () => {
    for (const name of MACHINE_OPTIONS)
      expect(matchesMachine(name, '')).toBe(true);
  });

  it('finds a machine by its initials, which is what people type', () => {
    expect(matchesMachine('Large Chemical Reactor', 'lcr')).toBe(true);
    expect(matchesMachine('Electric Blast Furnace', 'ebf')).toBe(true);
  });

  it('finds a machine by any of its aliases', () => {
    expect(matchesMachine('Volcanus', 'adv ebf')).toBe(true);
  });

  // `cr` must not drag in every machine whose initials merely contain those two
  it('matches initials and aliases by prefix, not by substring', () => {
    expect(matchesMachine('Large Chemical Reactor', 'cr')).toBe(false);
  });

  // but a legacy display name kept as an alias should still be searchable by
  // any word in it, the way the real name is
  it('matches a word inside a multi-word alias', () => {
    expect(matchesMachine('Volcanus', 'blast')).toBe(true);
  });

  it('gives every machine at least one search term', () => {
    for (const machine of MACHINES)
      expect(searchTerms(machine).length).toBeGreaterThan(0);
  });
});

describe('parameter declarations', () => {
  it('keeps parameter ids unique within a machine', () => {
    for (const machine of MACHINES) {
      const ids = machine.params.map(param => param.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('names at most one parameter as the inline one', () => {
    for (const machine of MACHINES) {
      expect(
        machine.params.filter(param => param.primary === true).length,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('gives every parameter a default it will accept', () => {
    for (const machine of MACHINES) {
      for (const param of machine.params) {
        if (param.kind === 'count')
          expect(param.default).toBeGreaterThanOrEqual(param.min);
        if (param.kind === 'enum')
          expect(
            param.options.some(option => option.value === param.default),
          ).toBe(true);
      }
    }
  });

  // resolveMachine throws for these on purpose — the GT++ casing ladders have
  // not been extracted yet. Catching it here means it can never reach a render
  it('declares no parameter whose ladder is still unextracted', () => {
    for (const machine of MACHINES) {
      for (const param of machine.params) {
        expect(param.kind).not.toBe('pipeCasingTier');
        expect(param.kind).not.toBe('itemPipeCasingTier');
      }
    }
  });
});

describe('formulas', () => {
  it('references only things that exist', () => {
    for (const machine of MACHINES) {
      const declared = new Set(machine.params.map(param => param.id));
      const custom = new Set(Object.keys(CUSTOM_FORMULAS));
      for (const [field, expr] of expressionsOf(machine)) {
        expect(
          validateExpr(expr, declared, CONFIG_KEYS, custom),
          `${machine.id}.${field}`,
        ).toEqual([]);
      }
    }
  });

  // One sweep that catches divide-by-zero, missing lookup keys, typo'd
  // references and sign errors across the whole catalog at once
  it('evaluates to sane numbers at default parameters across the tier range', () => {
    for (const machine of MACHINES) {
      for (const tier of [1, 2, 8]) {
        const resolved = resolveMachine(machine, undefined, context(tier));
        const where = `${machine.id} @ tier ${tier}`;

        expect(Number.isFinite(resolved.maxParallel), where).toBe(true);
        expect(resolved.maxParallel, where).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(resolved.maxParallel), where).toBe(true);

        expect(Number.isFinite(resolved.machineHeat), where).toBe(true);
        // zero is legal and real: the Algae Farm calls setEuModifier(0F) and
        // runs for free. A negative one would be the bug
        expect(resolved.eutModifier, where).toBeGreaterThanOrEqual(0);
        expect(resolved.durationModifier, where).toBeGreaterThan(0);
        expect(resolved.durationDecreasePerOC, where).toBeGreaterThan(1);
        expect(resolved.eutIncreasePerOC, where).toBeGreaterThan(1);
      }
    }
  });
});

describe('honesty ratchets', () => {
  it('keeps the custom formula registry small and fully wired', () => {
    const registered = Object.keys(CUSTOM_FORMULAS);
    expect(registered.length).toBeLessThanOrEqual(CUSTOM_FORMULA_LIMIT);

    const referenced = new Set(
      MACHINES.flatMap(machine =>
        expressionsOf(machine)
          .map(([, expr]) =>
            typeof expr === 'object' && 'custom' in expr
              ? expr.custom
              : undefined,
          )
          .filter((id): id is string => id !== undefined),
      ),
    );
    for (const id of referenced) expect(registered).toContain(id);
    for (const id of registered) expect(referenced.has(id)).toBe(true);
  });

  it('makes every unmodelled machine say why', () => {
    for (const machine of MACHINES) {
      if (machine.processing.parallel.kind === 'unknown') {
        expect(machine.processing.parallel.reason.length).toBeGreaterThan(0);
        expect(machine.processing.parallel.assume).toBeGreaterThanOrEqual(1);
      }
      if (machine.confidence !== 'modelled')
        expect(machine.notes ?? '', machine.id).not.toBe('');
    }
  });

  it('lets a machine claim it is modelled only when nothing about it is unknown', () => {
    for (const machine of MACHINES) {
      if (machine.confidence === 'modelled')
        expect(machine.processing.parallel.kind, machine.id).not.toBe(
          'unknown',
        );
    }
  });
});

describe('overrides', () => {
  it('makes every entry state why it exists', () => {
    for (const [key, patch] of Object.entries(overrides.patch ?? {}))
      expect(patch.why, key).not.toBe('');
    for (const entry of overrides.add ?? []) expect(entry.why).not.toBe('');
    for (const [key, why] of Object.entries(overrides.drop ?? {}))
      expect(why, key).not.toBe('');
  });

  // a patch whose class disappeared in a GT bump is curation that silently
  // stopped applying, which is exactly what a version bump needs to surface
  it('leaves no patch pointing at a class the extractor did not find', () => {
    const classes = new Set(
      raw.machines.map(machine => machine.source.className),
    );
    for (const key of Object.keys(overrides.patch ?? {}))
      expect(classes.has(key)).toBe(true);
    for (const key of Object.keys(overrides.drop ?? {}))
      expect(classes.has(key)).toBe(true);
  });
});

describe('resolving a machine against a node', () => {
  const ebf = findMachine('Electric Blast Furnace');
  const volcanus = findMachine('Volcanus');

  it('builds the EBF heat capacity from its coils and its voltage tier', () => {
    // Nichrome is 3,601 K, and the EBF adds 100 K per tier above MV
    const resolved = resolveMachine(ebf, { coil: 'nichrome' }, context(5));
    expect(resolved.machineHeat).toBe(3601 + 300);
    expect(resolved.heatOC).toBe(true);
    expect(resolved.heatDiscount).toBe(true);
    expect(resolved.maxParallel).toBe(1);
  });

  it('gives Volcanus its coil heat without the EBF voltage bonus', () => {
    const resolved = resolveMachine(volcanus, { coil: 'nichrome' }, context(5));
    expect(resolved.machineHeat).toBe(3601);
    expect(resolved.maxParallel).toBe(8);
    expect(resolved.eutModifier).toBeCloseTo(0.9, 12);
    expect(resolved.durationModifier).toBeCloseTo(1 / 2.2, 12);
  });

  it('reads the LCR perfect overclock off its data', () => {
    const resolved = resolveMachine(findMachine('LCR'), undefined, context(5));
    expect(resolved.durationDecreasePerOC).toBe(4);
    expect(resolved.eutIncreasePerOC).toBe(4);
  });

  it('falls back to the declared default when the saved value is gone', () => {
    // a coil id that no longer exists must not blank the machine out
    const resolved = resolveMachine(ebf, { coil: 'unobtainium' }, context(5));
    expect(resolved.values.coil?.raw).toBe('cupronickel');
  });

  it('reports an unknown machine instead of inventing one', () => {
    const resolved = resolveMachine(
      undefined,
      undefined,
      context(5),
      'Some Old Name',
    );
    expect(resolved.known).toBe(false);
    expect(resolved.modeled).toBe(false);
    expect(resolved.maxParallel).toBe(1);
    expect(resolved.name).toBe('Some Old Name');
  });
});
