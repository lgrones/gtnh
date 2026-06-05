# Realtime collaboration setup (Yjs + Firebase)

This app supports Figma-style multiplayer editing of production lines. Live edits
flow over **Firebase Realtime Database** (bandwidth-billed, cheap); the durable
graph is a compacted **Yjs snapshot** written to **Firestore** only on Save +
debounced autosave. Auth is Google sign-in.

## Architecture

- `Y.Doc` per active graph is the source of truth — `src/contexts/collab/`.
  - `doc.ts` — CRDT shape (`nodes`/`edges` `Y.Map`s) + (de)serialization.
  - `binding.ts` — two-way mirror between the Yjs doc and the Zustand store XYFlow
    renders from (origin-tagged to avoid echo; volatile UI fields excluded).
  - `rtdbProvider.ts` — live transport over RTDB + presence (cursors).
  - `persistence.ts` — load/save the Firestore snapshot.
  - `session.ts` — lifecycle, `Y.UndoManager` (local-only undo), autosave.
- `productionLibrary.ts` — Firestore-backed list of graphs + sharing/roles.
- `auth.ts` + `components/auth/authGate.tsx` — Google sign-in gate.

### Cost model

Firestore writes happen **only** on Save click and the debounced autosave
(`AUTOSAVE_MS`, ~15s) — never per keystroke. RTDB carries the per-edit deltas
(tiny binary updates). The RTDB update tail is cleared (compacted) after every
snapshot save, so it stays small.

## One-time Firebase setup

1. Create a Firebase project; enable **Authentication → Google**, **Firestore**,
   and **Realtime Database**.
2. Add a Web App, copy its config into `.env.local` (see `.env.example`).
3. Deploy security rules:
   ```sh
   firebase deploy --only firestore:rules,database
   ```
   - `firestore.rules` — graph read/write gated by membership; invitees can read +
     claim by email.
   - `database.rules.json` — live channel requires auth; presence is pinned to the
     writer's uid. (RTDB rules can't read Firestore, so durable-state security is
     enforced by Firestore + unguessable random graph ids.)

## Local development

```sh
cp .env.example .env.local      # fill Firebase config; set VITE_USE_EMULATORS=true
firebase emulators:start         # auth + firestore + rtdb (+ UI)
pnpm dev
```

With `VITE_USE_EMULATORS=true`, `src/infrastructure/firebase.ts` points the SDK at
the local emulators.

## Deploy

```sh
pnpm firebase:deploy             # vite build + firebase deploy (hosting + rules)
```

## Sharing model

- Owner clicks the share icon on a line → invite by email as **editor** or
  **viewer**; manage/remove existing members.
- Invites are stored on the graph keyed by email; on the invitee's next sign-in
  they're claimed automatically (`claimInvites`) and the line appears in their
  library.
- Viewers get a read-only canvas (no drag/connect/save, no edit hotkeys).
