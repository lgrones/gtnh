# GTNH Planner

A factory planner for **GregTech: New Horizons**. Lay out production lines as a
node graph, fill in recipes (items, machine, voltage, EU, time), and the app
sizes the power generation and surfaces problems for you — with **realtime,
Figma-style multiplayer** so several people can edit the same line at once.

## What it does

- **Visual production graph** — recipe / input / output / disposal nodes wired
  together on an [XYFlow](https://reactflow.dev) canvas. Right-click or hotkeys to
  place nodes; drag to connect.
- **Energy planning** — the Energy panel reads demand per voltage tier and sizes a
  bank of generators for a chosen generator type + fuel. The generator choice is
  **saved per graph**.
- **Stats & issues** — live totals and a validation panel that flags broken or
  inconsistent wiring.
- **Realtime collaboration** — edits stream live between users with presence
  cursors; the durable graph is a compacted Yjs snapshot in Firestore. See
  [COLLAB_SETUP.md](COLLAB_SETUP.md) for the architecture.
- **Closed access** — email/password sign-in with **no public sign-up**. Accounts
  are created by hand in the Firebase console; every signed-in user shares and
  edits every graph.

## Tech stack

React 19 · TypeScript · Vite · Mantine · TanStack Router · XYFlow · Zustand ·
Yjs · Firebase (Auth, Firestore, Realtime Database, Hosting).

## Local development

Prereqs: **pnpm** (see `packageManager` in [package.json](package.json)) and the
**Firebase CLI** (`npm i -g firebase-tools`) with a JRE for the emulators.

```sh
pnpm install
pnpm emulators        # Auth + Firestore + RTDB (+ UI on :4000), state persisted
pnpm dev              # Vite dev server
```

Env files (Firebase web config is public, so these are committed):

- `.env` — the real Firebase web config, loaded in **every** mode.
- `.env.development` — sets `VITE_USE_EMULATORS=true`, so `pnpm dev` points the SDK
  at the local emulators ([src/infrastructure/firebase.ts](src/infrastructure/firebase.ts)).
  Keep `VITE_USE_EMULATORS=false` in `.env` so production builds hit the real
  backend. See [.env.example](.env.example) for the full key list.

The emulator script imports/exports to `./emulator-data` (gitignored) so your
local auth users + data survive restarts — stop with **Ctrl+C** to trigger the
export.

### Useful scripts

| Command          | What                                                     |
| ---------------- | -------------------------------------------------------- |
| `pnpm dev`       | Vite dev server (emulators)                              |
| `pnpm emulators` | Firebase emulators, state persisted to `./emulator-data` |
| `pnpm build`     | Production build to `dist/`                              |
| `pnpm preview`   | Serve the built app                                      |
| `pnpm test`      | Run the Vitest suite                                     |
| `pnpm validate`  | Lint + styles + format-check + typecheck (CI gate)       |

## One-time Firebase setup

1. Create a Firebase project (the default here is `gtnh-tools`, see
   [.firebaserc](.firebaserc)). Enable **Authentication → Email/Password**,
   **Firestore**, and **Realtime Database**.
2. **Disable sign-up:** Authentication → Settings → User actions → uncheck
   **Enable create (sign-up)**. Add each user by hand under Authentication → Users.
3. Copy the Web App config into `.env`.
4. Deploy security rules: `firebase deploy --only firestore:rules,database`.

## Deploy

Pushes to `main` build and deploy automatically — see
[.github/workflows/deploy.yml](.github/workflows/deploy.yml). It needs one repo
secret, `FIREBASE_SERVICE_ACCOUNT` (Firebase console → Project settings →
Service accounts → Generate new private key).

Manual deploy:

```sh
pnpm firebase:deploy   # vite build + firebase deploy (hosting + rules)
```

Firebase Hosting is static-only; the app is a client-side SPA, so no server
runtime is required.
