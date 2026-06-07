import { type Edge } from '@xyflow/react';

import { type ProductionNode } from '@/contexts/productionStore';

import { applyEncoded, createGraphDoc } from './doc';

// read-only projection of a graph's persisted state — decode a base64 Yjs
// snapshot into plain node/edge arrays WITHOUT opening a collab session. used by
// the alternatives compare modal to read sibling alternatives that aren't the
// active graph (their snapshots are already cached client-side by the library
// subscription, see productionLibrary `graphSnapshot`). the temp doc is thrown
// away immediately so it never syncs or leaks.
export const decodeGraph = (
  snapshot: string | null,
): { nodes: ProductionNode[]; edges: Edge[] } => {
  if (!snapshot) return { nodes: [], edges: [] };

  const graph = createGraphDoc();

  try {
    applyEncoded(graph.doc, snapshot);

    return {
      nodes: [...graph.nodes.values()],
      edges: [...graph.edges.values()],
    };
  } finally {
    graph.doc.destroy();
  }
};
