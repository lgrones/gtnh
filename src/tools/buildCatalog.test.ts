// Rebuilds `src/data/machines.json` from the extractor's output plus curation.
//
//   CATALOG_WRITE=1 pnpm vitest run src/tools/buildCatalog.test.ts
//
// A node script wearing a vitest costume, the same trick as auditGraphs.test.ts:
// it inherits the `@/` aliases and the TypeScript pipeline for free, and it
// stays skipped in an ordinary `pnpm test` run.
//
// The merge itself lives in `@/domain/machines/merge` rather than here, so the
// guard test can recompute the shipped artifact and prove it was not hand
// edited. Once the extractor lands it writes raw.machines.json and then calls
// this same merge.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import aliases from '@/data/gt/aliases.json';
import overrides from '@/data/gt/overrides.machines.json';
import raw from '@/data/gt/raw.machines.json';
import {
  merge,
  type AliasFile,
  type OverrideFile,
  type RawCatalog,
} from '@/domain/machines/merge';

// JSON imports widen every string to `string`, so the literal unions in the
// machine record need asserting. The guard test is what actually checks the
// shape, at runtime, against the same files
const catalog = merge(
  raw as unknown as RawCatalog,
  overrides as unknown as OverrideFile,
  aliases as unknown as AliasFile,
);

test.skipIf(!process.env.CATALOG_WRITE)(
  'writes the merged machine catalog',
  () => {
    const path = 'src/data/machines.json';
    writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`);
    // through the repo formatter, so a rebuild leaves `pnpm validate` green
    execFileSync('pnpm', ['exec', 'oxfmt', path], { stdio: 'ignore' });

    expect(catalog.machines.length).toBeGreaterThan(0);
    // oxlint-disable-next-line no-console -- this is a script; the report is the point
    console.log(
      `${path}: ${catalog.machines.length} machines from GT ${catalog.gtVersion}`,
    );
  },
);
