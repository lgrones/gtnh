import type { Machine, MachineCatalog } from './types';

// Folding the extractor's output together with human curation.
//
// The split matters more than the mechanics: the extractor writes
// `raw.machines.json` and never touches `overrides.machines.json`, so re-running
// it against a new GT version cannot clobber a decision someone made by hand.
// And because this function is pure, the guard test recomputes the shipped
// `machines.json` and asserts equality — which means a hand edit to the
// generated artifact fails the build instead of silently surviving until the
// next extraction wipes it.

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : DeepPartial<T[K]>;
};

export interface RawCatalog {
  schemaVersion: number;
  gtVersion: string;
  generatedAt: string;
  machines: Machine[];
}

export interface MachinePatch extends DeepPartial<Machine> {
  /** Required: an override with no stated reason is unreviewable */
  why: string;
}

export interface OverrideFile {
  schemaVersion: number;
  /** Keyed by controller class FQN, which survives a display-name change */
  patch?: Record<string, MachinePatch>;
  add?: { why: string; machine: Machine }[];
  drop?: Record<string, string>;
}

export interface AliasFile {
  schemaVersion: number;
  /** Legacy or shorthand name -> machine id */
  byName: Record<string, string>;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// deep merge on objects, wholesale replace on arrays. patching `params[2].default`
// would be unreviewable in a diff, so an array override restates the whole list
const deepMerge = <T>(base: T, patch: unknown): T => {
  if (!isPlainObject(patch)) return (patch === undefined ? base : patch) as T;
  if (!isPlainObject(base)) return patch as T;

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    result[key] = isPlainObject(value) ? deepMerge(result[key], value) : value;
  }
  return result as T;
};

export const merge = (
  raw: RawCatalog,
  overrides: OverrideFile,
  aliases: AliasFile,
): MachineCatalog => {
  const dropped = new Set(Object.keys(overrides.drop ?? {}));
  const patches = overrides.patch ?? {};

  const patched = raw.machines
    .filter(machine => !dropped.has(machine.source.className))
    .map(machine => {
      const patch = patches[machine.source.className];
      if (patch === undefined) return machine;

      const { why: _why, ...fields } = patch;
      const merged = deepMerge(machine, fields);

      // record which sections a human touched, so the UI and the coverage
      // report can tell extracted values from curated ones
      return {
        ...merged,
        provenance: {
          ...merged.provenance,
          ...(fields.source !== undefined || fields.name !== undefined
            ? { identity: 'override' as const }
            : {}),
          ...(fields.params !== undefined
            ? { params: 'override' as const }
            : {}),
          ...(fields.processing !== undefined
            ? { processing: 'override' as const }
            : {}),
          ...(fields.processing?.parallel !== undefined
            ? { parallel: 'override' as const }
            : {}),
          ...(fields.calculator !== undefined
            ? { calculator: 'override' as const }
            : {}),
        },
      };
    });

  const added = (overrides.add ?? []).map(entry => entry.machine);
  const all = [...patched, ...added];

  // aliases.json is the migration record: it maps a name saved in someone's
  // graph to the machine it became. folding it into `aliases` here means
  // lookup and search both get it for free
  const extra = new Map<string, string[]>();
  for (const [name, id] of Object.entries(aliases.byName)) {
    extra.set(id, [...(extra.get(id) ?? []), name]);
  }

  const machines = all
    .map(machine => {
      const additions = extra.get(machine.id) ?? [];
      if (additions.length === 0) return machine;
      return {
        ...machine,
        aliases: [...new Set([...machine.aliases, ...additions])],
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    schemaVersion: raw.schemaVersion,
    gtVersion: raw.gtVersion,
    generatedAt: raw.generatedAt,
    machines,
  };
};
