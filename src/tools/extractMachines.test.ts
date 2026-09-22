// @vitest-environment node
//
// The extractor's entry point: GregTech source in, `src/data/gt/raw.machines.json`
// and a coverage report out.
//
//   GT_VERSION=5.09.51.482 pnpm gt:extract          # report only
//   GT_VERSION=5.09.51.482 GT_WRITE=1 pnpm gt:extract
//
// A node script wearing a vitest costume, the same trick as auditGraphs.test.ts
// and buildCatalog.test.ts: it inherits the `@/` aliases and the TypeScript
// pipeline for free and stays skipped in an ordinary `pnpm test` run.
//
// Dry by default because the interesting output is the report. Reading what
// moved, what could not be parsed and which legacy names stopped resolving is
// the point of running it; overwriting the shipped data is a decision taken
// afterwards.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import legacyNames from '@/data/gt/legacyNames.json';
import overridesFile from '@/data/gt/overrides.machines.json';
import gtConfig from '@/data/gtConfig.json';
import {
  merge,
  type AliasFile,
  type OverrideFile,
  type RawCatalog,
} from '@/domain/machines/merge';

import { extract } from './gtSource/extract';
import { readLang } from './gtSource/lang';
import {
  checkLegacyNames,
  counters,
  formatReport,
  renames,
  staleOverrides,
} from './gtSource/report';
import { fetchSource, readJavaFiles } from './gtSource/source';

const RAW_PATH = 'src/data/gt/raw.machines.json';
const ALIASES_PATH = 'src/data/gt/aliases.json';
const CATALOG_PATH = 'src/data/machines.json';
const REPORT_PATH = '.gt-cache/extract-report.txt';

// oxlint-disable-next-line no-console -- this is a script; the report is the point
const say = (line: string) => console.log(line);

// The generated JSON goes through the repo's own formatter, so that re-running
// the extractor leaves `pnpm validate` green. Without it every extraction
// produces a file oxfmt wants to rewrite, and the next person has to remember
// a second command.
const format = (...paths: string[]) => {
  execFileSync('pnpm', ['exec', 'oxfmt', ...paths], { stdio: 'ignore' });
};

const readJson = <T>(path: string): T | undefined =>
  existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : undefined;

test.skipIf(!process.env.GT_VERSION)(
  'extracts the machine catalog from GregTech source',
  async () => {
    const version = process.env.GT_VERSION!;

    const checkout = await fetchSource(version);
    const files = readJavaFiles(checkout);
    expect(files.length).toBeGreaterThan(2000);

    const previous = readJson<RawCatalog>(RAW_PATH);
    const overrides = overridesFile as unknown as OverrideFile;

    const { catalog, report } = extract(
      files,
      // the addons' lang files ship in the checkout; GT_LANG optionally adds a
      // pack instance's GregTech.lang on top
      readLang(checkout.root, process.env.GT_LANG),
      version,
      new Set(Object.keys(gtConfig.values)),
      // a re-extraction that finds nothing new should produce no diff, so the
      // timestamp is carried over unless the machines actually changed
      new Date().toISOString(),
    );

    const aliases = readJson<AliasFile>(ALIASES_PATH) ?? {
      schemaVersion: 1,
      byName: {},
    };
    const merged = merge(catalog, overrides, aliases);

    const input = {
      catalog,
      report,
      // the legacy check asks the *merged* catalog, because an alias is exactly
      // how a renamed machine is meant to keep resolving
      legacy: checkLegacyNames(merged.machines, legacyNames.names),
      renamed: renames(previous, catalog),
      stale: staleOverrides(overrides, catalog),
    };

    // written to a file as well as logged: it runs to a few hundred lines, and
    // vitest's console capture is not where anyone wants to read that
    const text = formatReport(input);
    writeFileSync(REPORT_PATH, `${text}\n`);
    say(text);
    say(`\nreport also written to ${REPORT_PATH}`);

    const now = counters(input);
    if (previous !== undefined && process.env.GT_FAIL_ON_REGRESSION) {
      const before = readJson<typeof now>('.gt-cache/counters.json');
      if (before !== undefined) {
        expect(now.legacyResolved).toBeGreaterThanOrEqual(
          before.legacyResolved,
        );
        expect(now.machines).toBeGreaterThanOrEqual(before.machines);
        expect(now.unresolved).toBeLessThanOrEqual(before.unresolved);
      }
    }

    if (!process.env.GT_WRITE) {
      say('\ndry run — pass GT_WRITE=1 to write raw.machines.json');
      return;
    }

    // an unchanged extraction keeps the old timestamp so re-running produces no
    // diff at all; it is the machines that matter, not when the script last ran
    const unchanged =
      previous !== undefined &&
      JSON.stringify(previous.machines) === JSON.stringify(catalog.machines);
    const written: RawCatalog = unchanged
      ? { ...catalog, generatedAt: previous.generatedAt }
      : catalog;

    writeFileSync(RAW_PATH, `${JSON.stringify(written, null, 2)}\n`);
    writeFileSync(
      CATALOG_PATH,
      `${JSON.stringify(merge(written, overrides, aliases), null, 2)}\n`,
    );
    writeFileSync(
      '.gt-cache/counters.json',
      `${JSON.stringify(now, null, 2)}\n`,
    );
    format(RAW_PATH, CATALOG_PATH);
    say(`\nwrote ${RAW_PATH} and ${CATALOG_PATH}`);
  },
  // 2834 files, parsed three ways
  120_000,
);
