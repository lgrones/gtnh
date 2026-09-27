import type { RawCatalog, OverrideFile } from '@/domain/machines/merge';
import type { Machine } from '@/domain/machines/types';

import type { ExtractReport } from './extract';

// What the extractor tells a human afterwards.
//
// The run is dry by default, so this text *is* the output most of the time. It
// is written to be read top to bottom before anyone decides to pass GT_WRITE=1:
// what was found, what moved since last time, what could not be read, and how
// many of the names a saved graph might hold still resolve.

const bar = (label: string, count: number, width = 34) =>
  `  ${label.padEnd(width)} ${String(count).padStart(5)}`;

const histogram = (title: string, counts: Record<string, number>) => {
  const rows = Object.entries(counts).sort(([, a], [, b]) => b - a);
  return [title, ...rows.map(([label, count]) => bar(label, count))].join('\n');
};

// ---------------------------------------------------------------------------
// legacy names
// ---------------------------------------------------------------------------

// The same loosening `catalog.ts` applies at runtime, repeated here rather than
// imported: catalog.ts resolves against the *shipped* JSON, and this has to ask
// the same question of a catalog that has not been written yet.
const normalize = (value: string) =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim();

const resolver = (machines: Machine[]) => {
  const byId = new Map(machines.map(machine => [machine.id, machine]));
  const byName = new Map(machines.map(machine => [machine.name, machine]));
  const loose = new Map<string, Machine>();
  for (const machine of machines)
    for (const key of [machine.name, ...machine.aliases]) {
      const folded = normalize(key);
      if (!loose.has(folded)) loose.set(folded, machine);
    }

  return (name: string) =>
    byId.get(name) ?? byName.get(name) ?? loose.get(normalize(name));
};

export interface LegacyCheck {
  resolved: number;
  total: number;
  missing: string[];
}

/**
 * How many of the names this app shipped before the catalog existed still
 * resolve. Those strings live inside saved Yjs documents as `data.machine`, and
 * one that stops resolving downgrades that node to "not in catalog".
 *
 * Reported, not enforced: the live graphs hold essentially no multiblock nodes,
 * so a name that cannot be mapped honestly is better left unmapped than aliased
 * to a guess. The ones that remain are machines from mods outside this repo.
 */
export const checkLegacyNames = (
  machines: Machine[],
  legacy: string[],
): LegacyCheck => {
  const find = resolver(machines);
  const missing = legacy.filter(name => find(name) === undefined);
  return {
    resolved: legacy.length - missing.length,
    total: legacy.length,
    missing,
  };
};

// ---------------------------------------------------------------------------
// what moved
// ---------------------------------------------------------------------------

export interface Rename {
  className: string;
  was: string;
  now: string;
}

/**
 * Display names that changed since the last extraction, keyed by controller
 * class — which survives a rename, and is why the catalog stores it.
 *
 * Each one needs an `aliases.json` entry or every graph holding the old name
 * stops resolving.
 */
export const renames = (
  previous: RawCatalog | undefined,
  current: RawCatalog,
): Rename[] => {
  if (previous === undefined) return [];
  const before = new Map(
    previous.machines.map(machine => [machine.source.className, machine.name]),
  );

  return current.machines
    .map(machine => ({
      className: machine.source.className,
      was: before.get(machine.source.className) ?? '',
      now: machine.name,
    }))
    .filter(entry => entry.was !== '' && entry.was !== entry.now);
};

/** Overrides keyed by a class the extraction no longer contains */
export const staleOverrides = (
  overrides: OverrideFile,
  current: RawCatalog,
): string[] => {
  const present = new Set(
    current.machines.map(machine => machine.source.className),
  );
  return [
    ...Object.keys(overrides.patch ?? {}),
    ...Object.keys(overrides.drop ?? {}),
  ]
    .filter(className => !present.has(className))
    .sort((a, b) => a.localeCompare(b));
};

// ---------------------------------------------------------------------------
// the text
// ---------------------------------------------------------------------------

export interface ReportInput {
  catalog: RawCatalog;
  report: ExtractReport;
  legacy: LegacyCheck;
  renamed: Rename[];
  stale: string[];
}

export const formatReport = (input: ReportInput): string => {
  const { catalog, report, legacy, renamed, stale } = input;
  const named = catalog.machines.filter(
    machine => machine.source.nameFrom === 'registration',
  ).length;

  const sections = [
    `GregTech ${catalog.gtVersion} — ${catalog.machines.length} controllers`,
    '',
    histogram('by mod', report.byMod),
    '',
    histogram('parallel model', report.parallelKinds),
    '',
    histogram('confidence', report.confidence),
    '',
    Object.keys(report.paramKinds).length === 0
      ? '  no machine parameters declared'
      : histogram('declared parameters', report.paramKinds),
    '',
    `names: ${named} of ${catalog.machines.length} from a registration site`,
  ];

  if (report.unnamed.length > 0)
    sections.push(
      '',
      `no registration found for ${report.unnamed.length} controllers — these keep their class name:`,
      ...report.unnamed.map(name => `  ${name}`),
    );

  if (report.duplicateNames.length > 0)
    sections.push(
      '',
      'two controllers share an id — one needs an override:',
      ...report.duplicateNames.map(entry => `  ${entry}`),
    );

  sections.push('', `legacy names: ${legacy.resolved}/${legacy.total} resolve`);
  if (legacy.missing.length > 0)
    sections.push(
      'unmapped — add an aliases.json entry for any that is really a rename:',
      ...legacy.missing.map(name => `  ${name}`),
    );

  if (renamed.length > 0)
    sections.push(
      '',
      `${renamed.length} display names changed since the last extraction — each needs an alias:`,
      ...renamed.map(
        entry => `  ${entry.was} -> ${entry.now}  (${entry.className})`,
      ),
    );

  if (stale.length > 0)
    sections.push(
      '',
      'overrides pointing at a class that no longer exists:',
      ...stale.map(name => `  ${name}`),
    );

  if (report.unresolved.length > 0) {
    const byMachine = new Map<string, typeof report.unresolved>();
    for (const entry of report.unresolved)
      byMachine.set(entry.machine, [
        ...(byMachine.get(entry.machine) ?? []),
        entry,
      ]);

    sections.push(
      '',
      `${report.unresolved.length} things could not be read, across ${byMachine.size} machines:`,
      ...[...byMachine.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([machine, entries]) => [
          `  ${machine}`,
          ...entries.map(
            entry =>
              `    ${entry.what}: ${entry.reason}\n      ${entry.java.replaceAll(/\s+/g, ' ').slice(0, 160)}\n      ${entry.file}:${entry.line}`,
          ),
        ]),
    );
  }

  return sections.join('\n');
};

/**
 * The counters `GT_FAIL_ON_REGRESSION` compares between runs. Lower is worse
 * for the first two, higher is worse for the last.
 */
export const counters = (input: ReportInput) => ({
  machines: input.catalog.machines.length,
  legacyResolved: input.legacy.resolved,
  unresolved: input.report.unresolved.length,
});
