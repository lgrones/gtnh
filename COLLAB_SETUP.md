# Realtime collaboration (Yjs + Firebase)

Figma-style multiplayer editing of production lines. Live edits flow over
**Firebase Realtime Database** (bandwidth-billed, cheap); the durable graph is a
compacted **Yjs snapshot** written to **Firestore** only on Save + debounced
autosave. Auth is email/password (no public sign-up); every signed-in user shares
and edits every graph.

## Architecture

- A `Y.Doc` per active graph is the source of truth — `src/contexts/collab/`.
  - `doc.ts` — CRDT shape: `nodes`/`edges` `Y.Map`s + a `meta` `Y.Map` for
    per-graph settings (the generator selection), plus (de)serialization.
  - `binding.ts` — two-way mirror between the Yjs doc and the Zustand store XYFlow
    renders from. Origin-tagged to avoid echo loops; volatile UI fields (selection,
    measured size, drag state) are stripped so they never enter the CRDT.
  - `rtdbProvider.ts` — live transport over RTDB + presence (cursors/selection).
  - `persistence.ts` — load/save the Firestore snapshot.
  - `session.ts` — lifecycle, `Y.UndoManager` (local-only undo), debounced autosave.
- `src/contexts/productionLibrary.ts` — Firestore-backed list of every graph
  (`graphs/{id}`), plus the active-graph selection.
- `src/contexts/auth.ts` + `src/components/auth/` — email/password gate, change
  password, sign out.

## Cost model

Firestore writes happen **only** on Save click and the debounced autosave
(`AUTOSAVE_MS`, ~15s) — never per keystroke. RTDB carries the per-edit deltas
(tiny binary Yjs updates, base64-encoded). The RTDB update tail is cleared
(compacted) after every snapshot save, so it stays small and cheap.

## Access & security rules

- `firestore.rules` — `graphs/{id}` is readable/writable by any signed-in user.
  The account set is closed (sign-up disabled in the console), so "signed in" ==
  "added by hand".
- `database.rules.json` — the live channel requires auth; presence is pinned to the
  writer's uid. RTDB rules can't read Firestore, so durable-state security is
  enforced by the Firestore rules above.

Deploy both: `firebase deploy --only firestore:rules,database`.

## Known limitation — undo

The binding stores each node/edge as a single whole-object `Y.Map` value, so two
users editing the **same** node (even different fields) delete each other's
underlying Yjs items via last-write-wins. This corrupts per-user undo: an undo can
become a no-op while `canUndo` still reports true. The `UndoManager` itself is
correct — the fix is finer-grained binding (per-node nested `Y.Map`, per-field
writes). Deferred.
