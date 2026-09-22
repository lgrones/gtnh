// Rebuilds src/domain/gt/__fixtures__/oracleOverclock.json from the GTNH Factory
// Flow dataset (https://github.com/jackwrichards/gtnh-factory-flow, MIT).
//
// Why that dataset: every recipe in it carries a `runtimeCalculation` block
// produced by `gregtech.api.util.OverclockCalculator` itself, run inside a
// headless GTNH client against the live registries. It is GregTech's own answer
// to "what does this recipe cost at tier X", which makes it an oracle for our
// transcription of that class — the one check reading the Java cannot give us.
//
//   node tools/buildOracleFixture.mjs
//   ORACLE_GZ=/path/to/recipes.json.gz node tools/buildOracleFixture.mjs
//
// The first 25 MB of the gzip stream is cached in .gt-cache and decompresses to
// ~680 MB, which is far past a JS string but fine to walk: the scan below holds
// one chunk at a time. That slice carries ~70k recipes, enough for every tier,
// every coil and four decades of EU/t.

import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATASET_VERSION = 'local-2.9.0-beta-2';
const DATASET_URL = `https://gtnhplanner.com/datasets/gtnh/${DATASET_VERSION}/recipes.json.gz`;
const OUT = join(ROOT, 'src/domain/gt/__fixtures__/oracleOverclock.json');
const CACHE = join(ROOT, '.gt-cache/oracle-recipes-head.json.gz');
const FETCH_BYTES = 25_000_000;

// how many distinct shapes to keep. the fixture is committed, so this trades
// file size against coverage; every kept shape expands to one row per tier, and
// every kept heat recipe to one row per tier PER COIL
const PLAIN_SHAPES = 150;
const HEAT_RECIPES = 6;

const RECIPE_START = '{"id":"oracle:';

const ensureCached = async () => {
  const given = process.env.ORACLE_GZ;
  if (given) return given;
  try {
    await access(CACHE);
    return CACHE;
  } catch {
    // not cached yet
  }
  process.stderr.write(`fetching ${FETCH_BYTES} bytes of ${DATASET_URL}\n`);
  const res = await fetch(DATASET_URL, {
    headers: { Range: `bytes=0-${FETCH_BYTES - 1}` },
  });
  if (!res.ok && res.status !== 206) {
    throw new Error(`dataset fetch failed: ${res.status}`);
  }
  await mkdir(dirname(CACHE), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(CACHE));
  return CACHE;
};

// The slice stops mid-array, so it is not JSON. Recipes are cut out one at a
// time on the `{"id":"oracle:` boundary and parsed individually; the one that
// straddles the cut fails to parse and is dropped, as is the trailing partial
// chunk. Nothing is ever held but the current chunk and its tail.
const forEachRecipe = async (path, onRecipe) => {
  let pending = '';
  let started = false;
  const gunzip = createGunzip();
  createReadStream(path).pipe(gunzip);
  try {
    for await (const chunk of gunzip.setEncoding('utf8')) {
      pending += chunk;
      if (!started) {
        const at = pending.indexOf('"recipes"');
        if (at === -1) {
          pending = pending.slice(-32);
          continue;
        }
        pending = pending.slice(at);
        started = true;
      }
      let from = pending.indexOf(RECIPE_START);
      if (from === -1) {
        pending = pending.slice(-RECIPE_START.length);
        continue;
      }
      for (;;) {
        const next = pending.indexOf(RECIPE_START, from + 1);
        if (next === -1) break;
        const text = pending.slice(from, next).trimEnd().replace(/,$/, '');
        try {
          onRecipe(JSON.parse(text));
        } catch {
          // a recipe straddling a chunk edge; the next pass sees it whole
        }
        from = next;
      }
      pending = pending.slice(from);
    }
  } catch (error) {
    // the slice ends mid-member, so the stream is expected to end unhappily
    const code = error?.code;
    if (code !== 'Z_BUF_ERROR' && code !== 'ERR_STREAM_PREMATURE_CLOSE')
      throw error;
  }
};

const usable = recipe => {
  const rc = recipe.runtimeCalculation;
  return (
    rc?.status === 'computed' &&
    rc.sourceClass === 'gregtech.api.util.OverclockCalculator' &&
    rc.strict === true &&
    Array.isArray(rc.variants) &&
    rc.variants.length > 0 &&
    recipe.eut > 0
  );
};

// GT's own ladder tops out at `Integer.MAX_VALUE - 7`; the oracle's MAX column
// is computed against roughly 2^63 instead (a base of 1920 EU/t comes back as
// 1920 * 2^52), so those rows describe a tier the game does not have
const REAL_TIER = variant => variant.overclockTier !== 'MAX';

const main = async () => {
  const path = await ensureCached();
  const plainByShape = new Map();
  const heatByShape = new Map();
  let seen = 0;

  await forEachRecipe(path, recipe => {
    if (!usable(recipe)) return;
    seen += 1;
    const variants = recipe.runtimeCalculation.variants.filter(REAL_TIER);
    if (variants.length === 0) return;

    if (variants.some(v => v.coilTier !== undefined)) {
      if (typeof recipe.specialValue !== 'number' || recipe.specialValue <= 0)
        return;
      const key = `${recipe.specialValue}:${recipe.eut}:${recipe.durationTicks}`;
      if (!heatByShape.has(key)) heatByShape.set(key, { recipe, variants });
      return;
    }
    // a discounted or parallelised first step means the machine brought
    // something of its own to the calculation, which this fixture cannot state
    if (variants[0].eut !== recipe.eut) return;
    if (variants.some(v => v.parallel !== 1)) return;
    const key = `${recipe.eut}:${recipe.durationTicks}`;
    if (!plainByShape.has(key)) plainByShape.set(key, { recipe, variants });
  });

  // spread each sample across its whole range rather than taking the head of
  // it, which is ordered by machine name
  const pick = (map, keep, sort) => {
    const all = [...map.values()].sort(sort);
    const stride = Math.max(1, Math.floor(all.length / keep));
    const out = [];
    for (let i = 0; i < all.length && out.length < keep; i += stride)
      out.push(all[i]);
    return out;
  };

  const plain = [];
  for (const { recipe, variants } of pick(
    plainByShape,
    PLAIN_SHAPES,
    (a, b) =>
      a.recipe.eut - b.recipe.eut ||
      a.recipe.durationTicks - b.recipe.durationTicks,
  )) {
    for (const v of variants) {
      plain.push([
        recipe.eut,
        recipe.durationTicks,
        v.overclockTier,
        v.eut,
        v.durationTicks,
      ]);
    }
  }

  const heat = [];
  for (const { recipe, variants } of pick(
    heatByShape,
    HEAT_RECIPES,
    (a, b) =>
      a.recipe.specialValue - b.recipe.specialValue ||
      a.recipe.eut - b.recipe.eut,
  )) {
    for (const v of variants) {
      if (v.coilTier === undefined) continue;
      heat.push([
        recipe.eut,
        recipe.durationTicks,
        recipe.specialValue,
        v.coilTier,
        v.overclockTier,
        v.eut,
        v.durationTicks,
      ]);
    }
  }

  const fixture = {
    source: {
      project: 'https://github.com/jackwrichards/gtnh-factory-flow',
      licence: 'MIT',
      dataset: DATASET_URL,
      datasetVersionId: DATASET_VERSION,
      gtnhVersion: '2.9.0-beta-2',
      exporter: 'dev.gtnhplanner.oracle.v1',
      sourceClass: 'gregtech.api.util.OverclockCalculator',
      note:
        'Numbers produced by GregTech itself, inside a headless GTNH client. ' +
        'The MAX tier is dropped: the oracle computes it against roughly 2^63 ' +
        'rather than GTValues.V[14] (Integer.MAX_VALUE - 7).',
      rebuild: 'node tools/buildOracleFixture.mjs',
    },
    plainColumns: [
      'recipeEUt',
      'duration',
      'tier',
      'euPerTick',
      'durationTicks',
    ],
    plain,
    heatColumns: [
      'recipeEUt',
      'duration',
      'recipeHeat',
      'coil',
      'tier',
      'euPerTick',
      'durationTicks',
    ],
    heat,
  };

  // hand-rolled so each row stays on one line; `JSON.stringify` with an indent
  // would put every number on its own, and the repo's formatter wants it this
  // way round anyway
  const block = value => JSON.stringify(value, null, 2).replace(/\n/g, '\n  ');
  const rows = list =>
    list
      .map(row => `    [${row.map(cell => JSON.stringify(cell)).join(', ')}]`)
      .join(',\n');
  const text = [
    '{',
    `  "source": ${block(fixture.source)},`,
    `  "plainColumns": ${block(fixture.plainColumns)},`,
    '  "plain": [',
    rows(fixture.plain),
    '  ],',
    `  "heatColumns": ${block(fixture.heatColumns)},`,
    '  "heat": [',
    rows(fixture.heat),
    '  ]',
    '}',
    '',
  ].join('\n');

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, text);
  process.stderr.write(
    `scanned ${seen} recipes -> ${plain.length} plain rows, ${heat.length} heat rows\n`,
  );
};

await main();
