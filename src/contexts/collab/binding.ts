import { type Edge } from '@xyflow/react';

import {
  useProductionStore,
  type ProductionNode,
} from '@/contexts/productionStore';

import { LOCAL_ORIGIN, stripEdge, stripNode, type YjsGraph } from './doc';

export interface Binding {
  destroy: () => void;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

// keep the Zustand store (what XYFlow renders) and the Yjs doc mirrored both
// ways. two flags break the echo loop: a local store→doc write fires the doc
// observer (skipped via writingLocal), and a doc→store apply fires the store
// subscriber (skipped via applyingRemote).
export const bindStore = (graph: YjsGraph): Binding => {
  const { doc, nodes: yNodes, edges: yEdges } = graph;
  let applyingRemote = false;
  let writingLocal = false;

  // doc → store: rebuild the arrays from the maps, preserving each surviving
  // node/edge's volatile UI state (selection, measured size) so a remote edit
  // elsewhere doesn't drop the local user's selection or trigger a re-measure
  const pullToStore = () => {
    const prev = useProductionStore.getState();
    const prevNodes = new Map(prev.nodes.map(node => [node.id, node]));
    const prevEdges = new Map(prev.edges.map(edge => [edge.id, edge]));

    const nodes = [...yNodes.values()].map(node => {
      const old = prevNodes.get(node.id);
      return old
        ? ({
            ...node,
            selected: old.selected,
            measured: old.measured,
          } as ProductionNode)
        : node;
    });
    const edges = [...yEdges.values()].map(edge => {
      const old = prevEdges.get(edge.id);
      return old ? ({ ...edge, selected: old.selected } as Edge) : edge;
    });

    applyingRemote = true;
    useProductionStore.setState({ nodes, edges });
    applyingRemote = false;
  };

  // store → doc: diff current store state into the maps under one transaction
  const pushToDoc = (nodes: ProductionNode[], edges: Edge[]) => {
    writingLocal = true;
    doc.transact(() => {
      const nodeIds = new Set<string>();
      for (const node of nodes) {
        nodeIds.add(node.id);
        const record = stripNode(node);
        if (!same(yNodes.get(node.id), record)) yNodes.set(node.id, record);
      }
      for (const id of [...yNodes.keys()])
        if (!nodeIds.has(id)) yNodes.delete(id);

      const edgeIds = new Set<string>();
      for (const edge of edges) {
        edgeIds.add(edge.id);
        const record = stripEdge(edge);
        if (!same(yEdges.get(edge.id), record)) yEdges.set(edge.id, record);
      }
      for (const id of [...yEdges.keys()])
        if (!edgeIds.has(id)) yEdges.delete(id);
    }, LOCAL_ORIGIN);
    writingLocal = false;
  };

  // sync the store to whatever the doc already holds (snapshot loaded before bind)
  pullToStore();

  const onDocChange = () => {
    if (writingLocal) return;
    pullToStore();
  };
  yNodes.observe(onDocChange);
  yEdges.observe(onDocChange);

  const unsubscribe = useProductionStore.subscribe(state => {
    if (applyingRemote) return;
    pushToDoc(state.nodes, state.edges);
  });

  return {
    destroy: () => {
      unsubscribe();
      yNodes.unobserve(onDocChange);
      yEdges.unobserve(onDocChange);
    },
  };
};
