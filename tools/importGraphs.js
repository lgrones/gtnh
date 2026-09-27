/*
 * Replace EVERY production graph with the contents of a
 * `tools/graphs-emulator.json` dump. Destructive: the prod `graphs` collection
 * is deleted and rewritten from the file.
 *
 * This is NOT part of the app — nothing imports it. Paste it into the devtools
 * console of the DEPLOYED site, https://gtnh-tools.web.app. It cannot run
 * against `pnpm dev`: the browser API key is referrer-restricted and rejects
 * https://localhost:5173.
 *
 *   1. node tools/exportEmulatorGraphs.mjs   (with the emulators running)
 *   2. open https://gtnh-tools.web.app, sign in, then RELOAD (so the cached ID
 *      token is fresh — it expires after an hour)
 *   3. paste this whole file into the console
 *   4. it downloads graphs-prod-backup-<stamp>.json FIRST, then opens a file
 *      picker — choose tools/graphs-emulator.json
 *   5. confirm the prompt; it deletes, writes, then wipes the live tails
 *
 * It uses the ID token the Firebase SDK parks in IndexedDB, so it gets exactly
 * the access the security rules give you and needs nothing from the app bundle.
 *
 * The live Yjs tail in Realtime Database (`live/{graphId}/updates`) is deltas
 * against the OLD snapshots. Replaying it over an imported snapshot smears one
 * graph's nodes into another, so the tail of every id touched — the ones
 * removed and the ones written — is deleted at the end. Presence is left alone:
 * the rules only let a user clear their own, and it is ephemeral anyway.
 */
(async () => {
  const PROJECT = 'gtnh-tools';
  const RTDB =
    'https://gtnh-tools-default-rtdb.europe-west1.firebasedatabase.app';
  const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

  // ---- ID token + uid out of the SDK's IndexedDB -------------------------
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
  const uid = entry?.value?.uid;
  if (!token || !uid) throw new Error('no ID token — sign in, reload, retry');

  const auth = { Authorization: `Bearer ${token}` };
  const log = (...a) =>
    // oxlint-disable-next-line no-console -- the devtools console is this tool's only UI
    console.log('[import]', ...a);

  const call = async (url, init) => {
    const res = await fetch(url, {
      ...init,
      headers: { ...auth, ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };

  // ---- read what is there now -------------------------------------------
  const existing = [];
  let pageToken = '';

  do {
    const page = await call(
      `${DOCS}/graphs?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`,
    );
    existing.push(...(page.documents ?? []));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);

  const oldIds = existing.map(d => d.name.split('/').pop());
  log(`${oldIds.length} graphs live now`);

  // ---- back them up before anything is touched ---------------------------
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = existing.map(d => ({
    id: d.name.split('/').pop(),
    fields: d.fields ?? {},
  }));
  const blobUrl = URL.createObjectURL(
    new Blob([JSON.stringify(backup)], { type: 'application/json' }),
  );
  const a = document.createElement('a');

  a.href = blobUrl;
  a.download = `graphs-prod-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(blobUrl);
  log(`backup of ${backup.length} graphs downloaded — keep it`);

  // ---- pick the dump to import ------------------------------------------
  const file = await new Promise(res => {
    const input = document.createElement('input');

    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => res(input.files?.[0] ?? null);
    input.click();
  });
  if (!file) throw new Error('no file chosen — aborted, nothing changed');

  const incoming = JSON.parse(await file.text());
  if (!Array.isArray(incoming) || !incoming.length)
    throw new Error('that file holds no graphs — aborted, nothing changed');

  for (const g of incoming)
    if (!g?.id || !g.fields?.name)
      throw new Error(
        `malformed entry ${JSON.stringify(g?.id)} — aborted, nothing changed`,
      );

  // the emulator's uids are throwaway; ownerId is bookkeeping only (the rules
  // ignore it), so stamp the importing account on every doc rather than ship
  // uids that belong to no real account
  for (const g of incoming) g.fields.ownerId = { stringValue: uid };

  const lines = new Set(incoming.map(g => g.fields.groupId?.stringValue));
  if (
    !confirm(
      `DELETE all ${oldIds.length} production graphs and replace them with ` +
        `${incoming.length} graphs (${lines.size} lines) from ${file.name}?\n\n` +
        `A backup of the current ${oldIds.length} was just downloaded.`,
    )
  )
    throw new Error('cancelled — nothing changed');

  // ---- delete + write in batched commits ---------------------------------
  // one commit per chunk; Firestore caps a commit at 500 writes and ~10MiB, and
  // a snapshot blob runs to tens of KB, so chunk on both
  const commit = async writes => {
    if (writes.length)
      await call(`${DOCS}:commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writes }),
      });
  };

  const chunked = async (items, toWrite, label) => {
    let batch = [];
    let bytes = 0;
    let done = 0;

    for (const item of items) {
      const write = toWrite(item);
      const size = JSON.stringify(write).length;

      if (batch.length >= 400 || bytes + size > 6_000_000) {
        await commit(batch);
        done += batch.length;
        log(`${label} ${done}/${items.length}`);
        batch = [];
        bytes = 0;
      }

      batch.push(write);
      bytes += size;
    }

    await commit(batch);
    log(`${label} ${done + batch.length}/${items.length}`);
  };

  await chunked(
    oldIds,
    id => ({
      delete: `projects/${PROJECT}/databases/(default)/documents/graphs/${id}`,
    }),
    'deleted',
  );

  await chunked(
    incoming,
    g => ({
      update: {
        name: `projects/${PROJECT}/databases/(default)/documents/graphs/${g.id}`,
        fields: g.fields,
      },
    }),
    'written',
  );

  // ---- drop the live Yjs tails these ids carry ---------------------------
  const touched = new Set([...oldIds, ...incoming.map(g => g.id)]);
  let wiped = 0;

  for (const id of touched) {
    const res = await fetch(`${RTDB}/live/${id}/updates.json`, {
      method: 'DELETE',
      headers: auth,
    });
    if (res.ok) wiped += 1;
    else log(`tail ${id}: ${res.status} ${await res.text()}`);
  }

  log(`live tails cleared for ${wiped}/${touched.size} ids`);
  log(`done — ${incoming.length} graphs are live. Reload the page.`);
})();
