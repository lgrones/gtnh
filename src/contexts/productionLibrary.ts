import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { create } from 'zustand';

import { useAuth } from '@/contexts/auth';
import { db } from '@/infrastructure/firebase';

// metadata only — the node/edge payload lives in the Yjs doc + Firestore
// `snapshot` field, never here. this store drives the library list + which
// graph is active. every signed-in user sees and edits every graph; there is
// no per-graph membership or role anymore.
export interface GraphMeta {
  id: string;
  name: string;
  ownerId: string;
}

// shape of a Firestore `graphs/{id}` document (the fields we read)
interface GraphDoc {
  ownerId: string;
  name: string;
  snapshot?: string | null;
}

// the durable Yjs snapshot per graph, kept off the reactive store (it's a large
// blob and churns on every save) but populated from the same live subscription
// that drives the list. the collab session reads it here when opening a graph,
// which avoids a second Firestore read that would race a just-created doc.
const snapshotCache = new Map<string, string | null>();
export const graphSnapshot = (id: string): string | null =>
  snapshotCache.get(id) ?? null;

interface LibraryState {
  graphs: GraphMeta[];
  activeId: string | null;
  loading: boolean;

  createGraph: () => Promise<void>;
  selectGraph: (id: string) => void;
  renameGraph: (id: string, name: string) => Promise<void>;
  removeGraph: (id: string) => Promise<void>;
}

const graphsCol = collection(db, 'graphs');

export const useProductionLibrary = create<LibraryState>()((set, get) => ({
  graphs: [],
  activeId: null,
  loading: true,

  createGraph: async () => {
    const user = useAuth.getState().user;

    if (!user) return;

    const ref = await addDoc(graphsCol, {
      ownerId: user.uid,
      name: `Line ${get().graphs.length + 1}`,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      snapshot: null,
    });

    set({ activeId: ref.id });
  },

  selectGraph: id => set({ activeId: id }),

  renameGraph: async (id, name) => {
    await updateDoc(doc(db, 'graphs', id), {
      name,
      updatedAt: serverTimestamp(),
    });
  },

  removeGraph: async id => {
    await deleteDoc(doc(db, 'graphs', id));
  },
}));

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
  unsubscribe = onSnapshot(
    query(graphsCol, orderBy('createdAt')),
    snap => {
      const graphs: GraphMeta[] = snap.docs.map(d => {
        const data = d.data() as GraphDoc;

        snapshotCache.set(d.id, data.snapshot ?? null);

        return { id: d.id, name: data.name, ownerId: data.ownerId };
      });

      const { activeId } = useProductionLibrary.getState();
      const stillActive = graphs.some(graph => graph.id === activeId);
      useProductionLibrary.setState({
        graphs,
        activeId: stillActive ? activeId : (graphs[0]?.id ?? null),
        loading: false,
      });
    },
  );
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
useAuth.subscribe(state => onUser(state.user?.uid ?? null));
