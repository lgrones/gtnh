/*
 * Dump every production graph the signed-in user can see to a JSON file, for
 * feeding `src/tools/auditGraphs.test.ts` or reloading into the emulator.
 *
 * This is NOT part of the app — nothing imports it. Paste it into the devtools
 * console of the DEPLOYED site, https://gtnh-tools.web.app. It cannot run
 * against `pnpm dev`: the browser API key is referrer-restricted and rejects
 * https://localhost:5173.
 *
 *   1. open https://gtnh-tools.web.app, sign in, then RELOAD (so the cached ID
 *      token is fresh — it expires after an hour)
 *   2. paste this whole file into the console
 *   3. it downloads graphs-prod.json
 *
 * It reads the ID token the Firebase SDK parks in IndexedDB and calls the
 * Firestore REST API with it, so it needs nothing from the app bundle and gets
 * exactly the access the security rules give you. Read-only — it never writes.
 *
 * Caveat: this captures id/name/groupName/createdAt/snapshot. `ownerId`,
 * `groupId`, `favorite` and `lockedOutputs` are NOT captured, so an emulator
 * re-import has to reconstruct them (group by groupName, oldest alternative
 * owns the groupId and the favorite flag). Widen `dump` below if you need
 * those verbatim.
 */
(async () => {
  const idb = await new Promise((res, rej) => {
    const r = indexedDB.open('firebaseLocalStorageDb');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

  const rows = await new Promise((res, rej) => {
    const q = idb
      .transaction('firebaseLocalStorage', 'readonly')
      .objectStore('firebaseLocalStorage')
      .getAll();
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });

  const entry = rows.find(r =>
    String(r.fbase_key).startsWith('firebase:authUser:'),
  );
  const token = entry?.value?.stsTokenManager?.accessToken;
  if (!token) throw new Error('no ID token — sign in, reload, retry');

  const base =
    'https://firestore.googleapis.com/v1/projects/gtnh-tools/databases/(default)/documents/graphs';
  const docs = [];
  let pageToken = '';

  do {
    const url = `${base}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const page = await res.json();
    docs.push(...(page.documents ?? []));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);

  // unwrap Firestore's typed value envelopes into plain JS
  const val = v => {
    const k = Object.keys(v)[0];
    if (k === 'arrayValue') return (v[k].values ?? []).map(val);
    if (k === 'integerValue') return Number(v[k]);
    if (k === 'nullValue') return null;
    return v[k];
  };

  const dump = docs.map(d => {
    const f = Object.fromEntries(
      Object.entries(d.fields ?? {}).map(([k, v]) => [k, val(v)]),
    );

    return {
      id: d.name.split('/').pop(),
      name: f.name,
      groupName: f.groupName,
      createdAt: f.createdAt,
      snapshot: f.snapshot ?? null,
    };
  });

  const url = URL.createObjectURL(
    new Blob([JSON.stringify(dump)], { type: 'application/json' }),
  );
  const a = document.createElement('a');

  a.href = url;
  a.download = 'graphs-prod.json';
  a.click();
  URL.revokeObjectURL(url);

  // oxlint-disable-next-line no-console -- the devtools console is this tool's only UI
  console.log(`exported ${dump.length} graphs`);
})();
