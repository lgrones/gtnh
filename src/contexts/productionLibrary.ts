import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { useMemo } from 'react';
import { create } from 'zustand';

import { useAuth } from '@/contexts/auth';
import { decodeGraph } from '@/contexts/collab/decode';
import { isInFolder, normalizeFolder, parentFolder } from '@/contexts/lineTree';
import { db } from '@/infrastructure/firebase';

// metadata only — the node/edge payload lives in the Yjs doc + Firestore
// `snapshot` field, never here. this store drives the library list + which
// graph is active. every signed-in user sees and edits every graph; there is
// no per-graph membership or role anymore.
//
// a "line" is a group of alternatives: sibling graphs sharing `groupId`. the
// first graph of a line owns `groupId === id`. `lockedOutputs` is the set of
// item names the line commits to producing (captured the first time it branches)
// so alternatives stay comparable. `favorite` floats an alternative to the front
// of the line's tab strip.
//
// `folder` is the line's path in the library tree ('' is the root) and is a
// property of the line, so every alternative of a line carries the same one —
// see `@/contexts/lineTree` for why folders are a string rather than documents.
export interface GraphMeta {
  id: string;
  name: string;
  ownerId: string;
  groupId: string;
  groupName: string;
  favorite: boolean;
  lockedOutputs: string[];
  folder: string;
}

// shape of a Firestore `graphs/{id}` document (the fields we read)
interface GraphDoc {
  ownerId: string;
  name: string;
  snapshot?: string | null;
  groupId?: string;
  groupName?: string;
  favorite?: boolean;
  lockedOutputs?: string[];
  folder?: string;
}

// the durable Yjs snapshot per graph, kept off the reactive store (it's a large
// blob and churns on every save) but populated from the same live subscription
// that drives the list. the collab session reads it here when opening a graph,
// which avoids a second Firestore read that would race a just-created doc.
const snapshotCache = new Map<string, string | null>();
export const graphSnapshot = (id: string): string | null =>
  snapshotCache.get(id) ?? null;

// a line: one or more alternatives grouped by `groupId`. alternatives are sorted
// favorites-first, then by creation order (the underlying `graphs` array is
// already ordered by `createdAt`).
export interface Line {
  groupId: string;
  name: string;
  lockedOutputs: string[];
  folder: string;
  alternatives: GraphMeta[];
}

interface LibraryState {
  graphs: GraphMeta[];
  activeId: string | null;
  loading: boolean;
  // per graph, how many times its durable snapshot has changed. The snapshots
  // themselves live in a plain Map off the store (they are large and churn), so
  // nothing reactive would otherwise notice a sub-line's source being edited —
  // see `@/contexts/subLine`, which re-reads and caches on this counter rather
  // than on the base64 blob it stands for
  snapshotVersions: Record<string, number>;

  // graphs drilled through to get to the active one, oldest first. A collapsed
  // sub-line node opens the line it stands for in this same canvas, and this is
  // the trail back out of it. Per-browser and not persisted: it is where THIS
  // user is looking, not a property of the graph
  drillPath: string[];
  drillInto: (id: string) => void;
  drillOut: () => void;

  createGraph: (folder?: string) => Promise<void>;
  selectGraph: (id: string) => void;
  renameGraph: (id: string, name: string) => Promise<void>;
  removeGraph: (id: string) => Promise<void>;

  // alternatives
  addAlternative: (
    sourceId: string,
    name: string,
    snapshot: string | null,
  ) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  renameLine: (groupId: string, name: string) => Promise<void>;
  removeLine: (groupId: string) => Promise<void>;

  // folders (see `@/contexts/lineTree`): all three rewrite the `folder` field of
  // the graphs concerned, since that field is the only place a folder exists
  moveLine: (groupId: string, folder: string) => Promise<void>;
  renameFolder: (path: string, next: string) => Promise<void>;
  removeFolder: (path: string) => Promise<void>;
}

const graphsCol = collection(db, 'graphs');

// output-leaf item names of a decoded graph, deduped + order-preserved. these
// become the line's locked outputs when it first branches.
const outputNames = (snapshot: string | null): string[] => {
  const { nodes } = decodeGraph(snapshot);
  const names: string[] = [];

  for (const node of nodes)
    if (node.type === 'outputNode') {
      const name = node.data.name.trim();
      if (name && !names.includes(name)) names.push(name);
    }

  return names;
};

export const useProductionLibrary = create<LibraryState>()((set, get) => ({
  graphs: [],
  activeId: null,
  loading: true,
  snapshotVersions: {},
  drillPath: [],

  drillInto: id => {
    const { activeId, drillPath } = get();
    if (id === activeId) return;

    set({
      activeId: id,
      // re-entering a line already on the trail (a diamond, not a cycle) rewinds
      // to it rather than growing the path forever
      drillPath: drillPath.includes(id)
        ? drillPath.slice(0, drillPath.indexOf(id))
        : activeId === null
          ? drillPath
          : [...drillPath, activeId],
    });
  },

  drillOut: () => {
    const drillPath = [...get().drillPath];
    const back = drillPath.pop();
    if (back === undefined) return;

    set({ activeId: back, drillPath });
  },

  createGraph: async (folder = '') => {
    const user = useAuth.getState().user;

    if (!user) return;

    const lineCount = new Set(get().graphs.map(g => g.groupId)).size;
    const ref = doc(graphsCol);

    await setDoc(ref, {
      ownerId: user.uid,
      name: 'Base',
      groupId: ref.id,
      groupName: `Line ${lineCount + 1}`,
      favorite: true,
      lockedOutputs: [],
      folder: normalizeFolder(folder),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      snapshot: null,
    });

    // seed the cache before activating so the collab session, which reacts to
    // the activeId change synchronously, opens this graph instead of racing the
    // Firestore round-trip that would otherwise deliver the snapshot
    snapshotCache.set(ref.id, null);
    set({ activeId: ref.id });
  },

  // picking a line out of the library is leaving whatever line was drilled
  // into, so the trail back through it goes too
  selectGraph: id => set({ activeId: id, drillPath: [] }),

  renameGraph: async (id, name) => {
    await updateDoc(doc(db, 'graphs', id), {
      name,
      updatedAt: serverTimestamp(),
    });
  },

  removeGraph: async id => {
    const { graphs, activeId } = get();

    // when deleting the active alternative, fall back to a sibling first, then
    // any other line — so the canvas never blanks out mid-edit
    if (id === activeId) {
      const me = graphs.find(g => g.id === id);
      const sibling = graphs.find(
        g => g.id !== id && g.groupId === me?.groupId,
      );
      const fallback = sibling ?? graphs.find(g => g.id !== id);
      set({ activeId: fallback?.id ?? null });
    }

    await deleteDoc(doc(db, 'graphs', id));
  },

  addAlternative: async (sourceId, name, snapshot) => {
    const user = useAuth.getState().user;
    if (!user) return;

    const { graphs } = get();
    const source = graphs.find(g => g.id === sourceId);
    if (!source) return;

    const siblings = graphs.filter(g => g.groupId === source.groupId);

    // lock the line's outputs at its first branch (item types only — quantities
    // stay free per alternative). already-locked lines keep their set.
    const lockedOutputs =
      source.lockedOutputs.length > 0
        ? source.lockedOutputs
        : outputNames(snapshot);

    const ref = doc(graphsCol);

    await setDoc(ref, {
      ownerId: user.uid,
      name,
      groupId: source.groupId,
      groupName: source.groupName,
      favorite: false,
      lockedOutputs,
      // the folder belongs to the line, so a new alternative lands in it too
      folder: source.folder,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      snapshot,
    });

    // seed the cache before activating (see createGraph) so the session opens
    // the copied state rather than an empty doc
    snapshotCache.set(ref.id, snapshot);

    // persist a freshly-captured lock back onto the existing alternatives so the
    // whole line remembers it (at first branch this is just the source)
    if (source.lockedOutputs.length === 0 && lockedOutputs.length > 0) {
      const batch = writeBatch(db);
      for (const sib of siblings)
        batch.update(doc(db, 'graphs', sib.id), { lockedOutputs });
      await batch.commit();
    }

    set({ activeId: ref.id });
  },

  toggleFavorite: async id => {
    const graph = get().graphs.find(g => g.id === id);
    if (!graph) return;

    await updateDoc(doc(db, 'graphs', id), {
      favorite: !graph.favorite,
      updatedAt: serverTimestamp(),
    });
  },

  renameLine: async (groupId, name) => {
    const members = get().graphs.filter(g => g.groupId === groupId);
    const batch = writeBatch(db);

    for (const member of members)
      batch.update(doc(db, 'graphs', member.id), {
        groupName: name,
        updatedAt: serverTimestamp(),
      });

    await batch.commit();
  },

  moveLine: async (groupId, folder) => {
    const members = get().graphs.filter(g => g.groupId === groupId);
    const batch = writeBatch(db);

    for (const member of members)
      batch.update(doc(db, 'graphs', member.id), {
        folder: normalizeFolder(folder),
        updatedAt: serverTimestamp(),
      });

    await batch.commit();
  },

  // rename in place ("Base Items" -> "Ores") or move the whole subtree
  // ("Base Items/Metals" -> "Ores/Metals"): both are the same prefix rewrite of
  // the folder itself and everything under it. Rewriting onto an existing path
  // merges the two folders, which is what dropping one onto the other means.
  renameFolder: async (path, next) => {
    const from = normalizeFolder(path);
    const to = normalizeFolder(next);
    // moving a folder inside itself would rewrite the paths it is being
    // measured against halfway through, which loses the subtree
    if (from === '' || from === to || isInFolder(to, from)) return;

    const members = get().graphs.filter(g => isInFolder(g.folder, from));
    const batch = writeBatch(db);

    for (const member of members)
      batch.update(doc(db, 'graphs', member.id), {
        folder: normalizeFolder(to + member.folder.slice(from.length)),
        updatedAt: serverTimestamp(),
      });

    await batch.commit();
  },

  // deleting a folder deletes no lines: everything in it moves up one level.
  // (Which is the same rewrite as renaming it to its own parent.)
  removeFolder: async path => {
    const from = normalizeFolder(path);
    if (from === '') return;

    await get().renameFolder(from, parentFolder(from));
  },

  removeLine: async groupId => {
    const { graphs, activeId } = get();
    const members = graphs.filter(g => g.groupId === groupId);

    if (members.some(g => g.id === activeId)) {
      const fallback = graphs.find(g => g.groupId !== groupId);
      set({ activeId: fallback?.id ?? null });
    }

    const batch = writeBatch(db);
    for (const member of members) batch.delete(doc(db, 'graphs', member.id));
    await batch.commit();
  },
}));

// group the flat graph list into lines, alternatives sorted favorites-first.
// the input array is already ordered by `createdAt`, so a stable favorites
// partition preserves creation order within each bucket.
const buildLines = (graphs: GraphMeta[]): Line[] => {
  const byGroup = new Map<string, Line>();

  for (const graph of graphs) {
    let line = byGroup.get(graph.groupId);
    if (line === undefined)
      byGroup.set(
        graph.groupId,
        (line = {
          groupId: graph.groupId,
          name: graph.groupName,
          lockedOutputs: graph.lockedOutputs,
          folder: normalizeFolder(graph.folder),
          alternatives: [],
        }),
      );
    line.alternatives.push(graph);
  }

  for (const line of byGroup.values())
    line.alternatives.sort((a, b) => Number(b.favorite) - Number(a.favorite));

  return [...byGroup.values()];
};

// the production lines (grouped alternatives). memoized on the raw `graphs`
// reference so the derived array is stable between unrelated renders.
export const useLines = (): Line[] => {
  const graphs = useProductionLibrary(state => state.graphs);
  return useMemo(() => buildLines(graphs), [graphs]);
};

// the line containing the active alternative, or undefined when none is active
export const useActiveLine = (): Line | undefined => {
  const lines = useLines();
  const activeId = useProductionLibrary(state => state.activeId);

  return useMemo(
    () =>
      lines.find(line => line.alternatives.some(alt => alt.id === activeId)),
    [lines, activeId],
  );
};

// the currently active graph's metadata, or undefined when none is selected
export const useActiveGraph = (): GraphMeta | undefined => {
  const activeId = useProductionLibrary(state => state.activeId);
  const graphs = useProductionLibrary(state => state.graphs);

  return graphs.find(graph => graph.id === activeId);
};

// (re)subscribe the library to every graph. all graphs are shared between all
// users, so the only thing auth gates is whether we subscribe at all (the list
// clears on sign-out).
let unsubscribe: Unsubscribe | undefined;

const syncToUser = (uid: string | null) => {
  unsubscribe?.();
  unsubscribe = undefined;

  if (!uid) {
    useProductionLibrary.setState({
      graphs: [],
      activeId: null,
      loading: false,
    });

    return;
  }

  useProductionLibrary.setState({ loading: true });
  unsubscribe = onSnapshot(query(graphsCol, orderBy('createdAt')), snap => {
    const state = useProductionLibrary.getState();

    // which graphs' durable payloads moved, so anything derived from ANOTHER
    // graph's snapshot (a collapsed sub-line's capture) can tell that the line
    // behind it changed. Counted before the cache is written, since the cache
    // is what says what it was
    let snapshotVersions = state.snapshotVersions;

    for (const d of snap.docs) {
      if (snapshotCache.get(d.id) === ((d.data() as GraphDoc).snapshot ?? null))
        continue;

      snapshotVersions = {
        ...snapshotVersions,
        [d.id]: (snapshotVersions[d.id] ?? 0) + 1,
      };
    }

    const graphs: GraphMeta[] = snap.docs.map(d => {
      const data = d.data() as GraphDoc;

      snapshotCache.set(d.id, data.snapshot ?? null);

      // legacy docs predate alternatives: each is its own single-alt line
      return {
        id: d.id,
        name: data.name,
        ownerId: data.ownerId,
        groupId: data.groupId ?? d.id,
        groupName: data.groupName ?? data.name,
        favorite: data.favorite ?? true,
        lockedOutputs: data.lockedOutputs ?? [],
        // legacy docs predate folders too: they sit at the root
        folder: normalizeFolder(data.folder ?? ''),
      };
    });

    const stillActive = graphs.some(graph => graph.id === state.activeId);
    const ids = new Set(graphs.map(graph => graph.id));

    useProductionLibrary.setState({
      graphs,
      activeId: stillActive ? state.activeId : (graphs[0]?.id ?? null),
      loading: false,
      snapshotVersions,
      // a line deleted out from under the trail must not be somewhere "back"
      // still leads to
      drillPath: state.drillPath.filter(id => ids.has(id)),
    });
  });
};

// only resubscribe when the identity actually changes (auth fires on token
// refresh too, producing a new User object with the same uid)
let lastUid: string | null = null;
const onUser = (uid: string | null) => {
  if (uid === lastUid) return;
  lastUid = uid;
  syncToUser(uid);
};

onUser(useAuth.getState().user?.uid ?? null);
const unsubscribeAuth = useAuth.subscribe(state =>
  onUser(state.user?.uid ?? null),
);

// the Firestore listener and the auth subscription outlive a module reload and
// would otherwise stack up one live copy per dev-server HMR update
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribeAuth();
    unsubscribe?.();
    unsubscribe = undefined;
  });
}
