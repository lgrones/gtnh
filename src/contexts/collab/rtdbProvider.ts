import {
  onChildAdded,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  set,
} from 'firebase/database';
import { fromBase64, toBase64 } from 'lib0/buffer';
import * as Y from 'yjs';

import { rtdb } from '@/infrastructure/firebase';

import { applyEncoded, type YjsGraph } from './doc';
import { loadSnapshot } from './persistence';
import { usePresence, type Peer } from './presence';

// origin tag for updates applied off the wire — the UndoManager ignores it and
// the local 'update' handler skips re-broadcasting it
const PROVIDER_ORIGIN = 'rtdb';

export interface Self {
  uid: string;
  name: string;
  color: string;
}

export interface RtdbProvider {
  destroy: () => void;
  // drop the live update tail after a durable snapshot — keeps RTDB tiny/cheap
  compact: () => Promise<void>;
  setPresence: (patch: Partial<Pick<Peer, 'cursor' | 'selection'>>) => void;
}

// live transport for one graph's Yjs doc over Realtime Database (bandwidth-
// billed, cheap). edits stream through live/{graphId}/updates; presence lives
// under live/{graphId}/presence. durable state loads from the Firestore snapshot.
export const createRtdbProvider = (
  graphId: string,
  graph: YjsGraph,
  self: Self,
  canWrite: boolean,
  onReady: () => void,
): RtdbProvider => {
  const { doc } = graph;
  const updatesRef = ref(rtdb, `live/${graphId}/updates`);
  const presenceRef = ref(rtdb, `live/${graphId}/presence`);
  const selfRef = ref(rtdb, `live/${graphId}/presence/${self.uid}`);

  const clientId = doc.clientID;
  let disposed = false;
  const detach: (() => void)[] = [];

  // broadcast local edits to the tail (viewers never write; remote-origin
  // applies are not re-broadcast)
  if (canWrite) {
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === PROVIDER_ORIGIN) return;
      void push(updatesRef, { by: clientId, u: toBase64(update) });
    };
    doc.on('update', onUpdate);
    detach.push(() => doc.off('update', onUpdate));
  }

  // load the durable snapshot, then attach to the live tail
  const init = async () => {
    const snapshot = await loadSnapshot(graphId);
    if (disposed) return;
    if (snapshot) applyEncoded(doc, snapshot, PROVIDER_ORIGIN);

    const off = onChildAdded(updatesRef, snap => {
      const val = snap.val() as { by: number; u: string } | null;
      if (!val || val.by === clientId) return; // skip our own pushes
      Y.applyUpdate(doc, fromBase64(val.u), PROVIDER_ORIGIN);
    });
    detach.push(off);
    onReady();
  };
  void init();

  // presence: publish self, mirror peers into the presence store
  const publishSelf = (extra: Partial<Pick<Peer, 'cursor' | 'selection'>>) =>
    set(selfRef, {
      uid: self.uid,
      name: self.name,
      color: self.color,
      ...extra,
    });
  void publishSelf({ cursor: null, selection: [] });
  void onDisconnect(selfRef).remove();

  const offPresence = onValue(presenceRef, snap => {
    const all = (snap.val() ?? {}) as Record<string, Peer>;
    const peers: Record<string, Peer> = {};
    for (const [uid, peer] of Object.entries(all))
      if (uid !== self.uid) peers[uid] = peer;
    usePresence.setState({ peers });
  });
  detach.push(offPresence);

  return {
    destroy: () => {
      disposed = true;
      for (const fn of detach) fn();
      void remove(selfRef);
      usePresence.setState({ peers: {} });
    },
    compact: async () => {
      await remove(updatesRef);
    },
    setPresence: patch => void publishSelf(patch),
  };
};
