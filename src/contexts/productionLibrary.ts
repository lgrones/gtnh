import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { create } from 'zustand';

import { useAuth } from '@/contexts/auth';
import { db } from '@/infrastructure/firebase';

export type GraphRole = 'owner' | 'editor' | 'viewer';

// metadata only — the node/edge payload lives in the Yjs doc + Firestore
// `snapshot` field, never here. this store drives the library list + which
// graph is active.
export interface GraphMeta {
  id: string;
  name: string;
  ownerId: string;
  role: GraphRole;
}

// shape of a Firestore `graphs/{id}` document (the fields we read)
interface GraphDoc {
  ownerId: string;
  name: string;
  snapshot?: string | null;
  roles?: Record<string, GraphRole>;
  invites?: Record<string, GraphRole>;
  memberIds?: string[];
  inviteEmails?: string[];
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

// Firestore key/path-safe encoding of an email (keys can't contain . $ # [ ] /)
export const emailKey = (email: string) => btoa(email.toLowerCase());

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
      roles: {},
      memberIds: [user.uid],
      invites: {},
      inviteEmails: [],
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

// the role the current user holds on the active graph (undefined when none)
export const useActiveRole = (): GraphRole | undefined =>
  useActiveGraph()?.role;

// claim any pending invites addressed to this user's email: move them from the
// graph's `invites`/`inviteEmails` into `roles`/`memberIds` so the graph shows
// up in their library. runs once per sign-in.
const claimInvites = async (uid: string, email: string) => {
  const snap = await getDocs(
    query(graphsCol, where('inviteEmails', 'array-contains', email)),
  );
  await Promise.all(
    snap.docs.map(d => {
      const role =
        (d.data() as GraphDoc).invites?.[emailKey(email)] ?? 'viewer';
      return updateDoc(d.ref, {
        [`roles.${uid}`]: role,
        memberIds: arrayUnion(uid),
        [`invites.${emailKey(email)}`]: deleteField(),
        inviteEmails: arrayRemove(email),
      });
    }),
  );
};

// (re)subscribe the library to the signed-in user's graphs. driven by auth so
// the list always reflects the current user (and clears on sign-out).
let unsubscribe: Unsubscribe | undefined;

const syncToUser = (uid: string | null, email: string | null) => {
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

  if (email) void claimInvites(uid, email.toLowerCase());

  useProductionLibrary.setState({ loading: true });
  unsubscribe = onSnapshot(
    query(graphsCol, where('memberIds', 'array-contains', uid)),
    snap => {
      const graphs: GraphMeta[] = snap.docs.map(d => {
        const data = d.data() as GraphDoc;
        snapshotCache.set(d.id, data.snapshot ?? null);
        const role: GraphRole =
          data.ownerId === uid ? 'owner' : (data.roles?.[uid] ?? 'viewer');
        return { id: d.id, name: data.name, ownerId: data.ownerId, role };
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
const onUser = (uid: string | null, email: string | null) => {
  if (uid === lastUid) return;
  lastUid = uid;
  syncToUser(uid, email);
};

const auth = useAuth.getState();
onUser(auth.user?.uid ?? null, auth.user?.email ?? null);
useAuth.subscribe(state =>
  onUser(state.user?.uid ?? null, state.user?.email ?? null),
);
