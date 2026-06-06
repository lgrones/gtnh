import { doc as fsDoc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { db } from '@/infrastructure/firebase';

import { encodeDoc, type YjsGraph } from './doc';

// the durable Yjs snapshot is read off the library's live `graphs` subscription
// (see productionLibrary `graphSnapshot`), never re-fetched here — re-reading a
// just-created graph races the server commit and reads back permission-denied.

// write one compacted Yjs blob to Firestore — the only per-graph Firestore write
// on the hot path. called on Save click + debounced autosave, never per edit.
export const saveSnapshot = async (
  graphId: string,
  graph: YjsGraph,
): Promise<void> => {
  await updateDoc(fsDoc(db, 'graphs', graphId), {
    snapshot: encodeDoc(graph.doc),
    updatedAt: serverTimestamp(),
  });
};
