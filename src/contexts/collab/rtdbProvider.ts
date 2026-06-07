import {
  get,
  onChildAdded,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  set,
  type DataSnapshot,
} from 'firebase/database';
import { fromBase64, toBase64 } from 'lib0/buffer';
import * as Y from 'yjs';

import { rtdb } from '@/infrastructure/firebase';

import { applyEncoded, type YjsGraph } from './doc';
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
  snapshot: string | null,
  onReady: () => void,
): RtdbProvider => {
  const { doc } = graph;
  const updatesRef = ref(rtdb, `live/${graphId}/updates`);
  const presenceRef = ref(rtdb, `live/${graphId}/presence`);
  const selfRef = ref(rtdb, `live/${graphId}/presence/${self.uid}`);

  const clientId = doc.clientID;
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

  // seed from the durable snapshot (already loaded by the library subscription).
  // the snapshot is authoritative; content is visible immediately on load.
  if (snapshot) applyEncoded(doc, snapshot, PROVIDER_ORIGIN);
  onReady();

  // holder + getter so the async tail-init below reads the live value after
  // `destroy` flips it across the awaits (a bare boolean would get narrowed away)
  const session = { destroyed: false };
  const isDestroyed = () => session.destroyed;

  const applyTailUpdate = (snap: DataSnapshot) => {
    const val = snap.val() as { by: number; u: string } | null;

    if (!val || val.by === clientId) return; // skip our own pushes

    Y.applyUpdate(doc, fromBase64(val.u), PROVIDER_ORIGIN);
  };

  // the live tail (live/{graphId}/updates) holds incremental edits not yet folded
  // into the durable snapshot. on a SOLO open it is stale residue from a prior
  // session — replaying it can resurrect a delete and wipe the freshly-loaded
  // snapshot (content flashes in, then vanishes). so: when no other peer is
  // present, drop the stale tail instead of replaying it (snapshot wins); with
  // peers, replay to catch up to their live edits.
  void (async () => {
    let hasPeers = false;

    try {
      const peers = (await get(presenceRef)).val() as Record<
        string,
        unknown
      > | null;
      hasPeers = !!peers && Object.keys(peers).some(uid => uid !== self.uid);
    } catch {
      // presence read failed — keep the tail rather than risk dropping a real
      // collaborator's edits
      hasPeers = true;
    }

    if (isDestroyed()) return;

    // solo editor: the tail is stale residue — compact it so it can't clobber
    // the authoritative snapshot, now or on any future reload
    if (!hasPeers && canWrite) await remove(updatesRef);

    if (isDestroyed()) return;

    // attach for the (remaining) tail + all future live updates. Yjs applies are
    // idempotent, so re-seeing an already-applied update is a harmless no-op.
    const off = onChildAdded(updatesRef, applyTailUpdate);
    detach.push(off);
  })();

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
      session.destroyed = true; // stop the async tail-init if it's mid-flight
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
