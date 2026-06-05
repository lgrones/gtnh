import {
  doc as fsDoc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';

import { db } from '@/infrastructure/firebase';

import { encodeDoc, type YjsGraph } from './doc';

// read the durable Yjs snapshot for a graph (null before its first save)
export const loadSnapshot = async (graphId: string): Promise<string | null> => {
  const snap = await getDoc(fsDoc(db, 'graphs', graphId));
  return (snap.data()?.snapshot as string | undefined) ?? null;
};

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
