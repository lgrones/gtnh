/*
 * Dump every `graphs` document out of a RUNNING local emulator into
 * tools/graphs-emulator.json, the payload `tools/importGraphs.js` uploads to
 * production. The mirror image of `tools/exportGraphs.js` (prod -> file).
 *
 * This is NOT part of the app — nothing imports it.
 *
 *   1. pnpm emulators   (or: firebase emulators:start --import=./emulator-data)
 *   2. node tools/exportEmulatorGraphs.mjs
 *
 * Unlike the prod exporter it keeps Firestore's typed value envelopes verbatim
 * ({"stringValue": ...} and friends), so `createdAt`/`updatedAt` stay real
 * timestamps and `lockedOutputs`/`favorite` survive the round trip — the
 * importer can hand the fields straight back to Firestore with no guessing.
 */
import { writeFileSync } from 'node:fs';

const HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'gtnh-tools';
const OUT = new URL('./graphs-emulator.json', import.meta.url);

const base = `http://${HOST}/v1/projects/${PROJECT}/databases/(default)/documents/graphs`;
const docs = [];
let pageToken = '';

do {
  const url = `${base}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer owner' } });

  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);

  const page = await res.json();

  docs.push(...(page.documents ?? []));
  pageToken = page.nextPageToken ?? '';
} while (pageToken);

const dump = docs.map(d => ({
  id: d.name.split('/').pop(),
  fields: d.fields ?? {},
}));

writeFileSync(OUT, JSON.stringify(dump));
console.log(`exported ${dump.length} graphs to ${OUT.pathname}`);
