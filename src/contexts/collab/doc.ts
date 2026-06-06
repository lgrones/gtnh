import { type Edge } from '@xyflow/react';
import { fromBase64, toBase64 } from 'lib0/buffer';
import * as Y from 'yjs';

import { type ProductionNode } from '@/contexts/productionStore';

// transaction origin tag for local store→doc writes. the UndoManager tracks
// only this origin, so undo reverts the local user's edits — never remote ones.
export const LOCAL_ORIGIN = 'local-store';

// the active graph's CRDT: one Y.Map per collection, keyed by node/edge id.
// granularity is per-node / per-edge (whole object is the map value) — cross-node
// edits merge cleanly; concurrent edits to the same node are last-write-wins.
// `meta` holds per-graph scalar settings (e.g. the generator selection) so they
// travel with the graph: synced live and persisted in the snapshot.
export interface YjsGraph {
  doc: Y.Doc;
  nodes: Y.Map<ProductionNode>;
  edges: Y.Map<Edge>;
  meta: Y.Map<unknown>;
}

export const createGraphDoc = (): YjsGraph => {
  const doc = new Y.Doc();
  return {
    doc,
    nodes: doc.getMap('nodes'),
    edges: doc.getMap('edges'),
    meta: doc.getMap('meta'),
  };
};

// XYFlow volatile fields — they churn every render (measure, select, drag) and
// must never enter the CRDT, or they'd flood sync and clobber concurrent edits.
const VOLATILE = new Set([
  'selected',
  'measured',
  'dragging',
  'width',
  'height',
  'positionAbsolute',
]);

const strip = <T extends object>(value: T): T => {
  const clone: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value))
    if (!VOLATILE.has(key)) clone[key] = val;
  return clone as T;
};

// persistent projection stored in the CRDT (no volatile UI churn)
export const stripNode = (node: ProductionNode): ProductionNode => strip(node);
export const stripEdge = (edge: Edge): Edge => strip(edge);

// whole-doc state ⇄ base64, for the Firestore snapshot
export const encodeDoc = (doc: Y.Doc): string =>
  toBase64(Y.encodeStateAsUpdate(doc));
export const applyEncoded = (doc: Y.Doc, snapshot: string, origin?: unknown) =>
  Y.applyUpdate(doc, fromBase64(snapshot), origin);
