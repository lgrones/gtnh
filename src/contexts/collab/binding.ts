import { type Edge } from '@xyflow/react';

import {
  normalizeNodes,
  useProductionStore,
  type GeneratorSelection,
  type ProductionNode,
  type ProductionState,
} from '@/contexts/productionStore';

import { LOCAL_ORIGIN, stripEdge, stripNode, type YjsGraph } from './doc';

export interface Binding {
  destroy: () => void;
}

const isDeepEqual = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

// keep the Zustand store (what XYFlow renders) and the Yjs doc mirrored both
// ways. two flags break the echo loop: a local store→doc write fires the doc
// observer (skipped via writingLocal), and a doc→store apply fires the store
// subscriber (skipped via applyingRemote).
export const bindStore = (graph: YjsGraph): Binding => {
  const { doc, nodes: yNodes, edges: yEdges, meta: yMeta } = graph;
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
    // graphs persisted before a field existed arrive raw from the doc, so they
    // are backfilled here as well as in `reset` — this is the live path
    useProductionStore.setState({ nodes: normalizeNodes(nodes), edges });
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

        if (!isDeepEqual(yNodes.get(node.id), record))
          yNodes.set(node.id, record);
      }

      for (const id of [...yNodes.keys()])
        if (!nodeIds.has(id)) yNodes.delete(id);

      const edgeIds = new Set<string>();

      for (const edge of edges) {
        edgeIds.add(edge.id);

        const record = stripEdge(edge);

        if (!isDeepEqual(yEdges.get(edge.id), record))
          yEdges.set(edge.id, record);
      }

      for (const id of [...yEdges.keys()])
        if (!edgeIds.has(id)) yEdges.delete(id);
    }, LOCAL_ORIGIN);

    writingLocal = false;
  };

  // doc → store: the per-graph settings `meta` carries — the generator
  // selection and the ME-network flag. a key the doc never set falls back to
  // the same default `reset` uses, so an older graph opens as a wired line
  const pullMeta = () => {
    const generator =
      (yMeta.get('generator') as GeneratorSelection | undefined) ?? null;
    const meMode = yMeta.get('meMode') === true;

    applyingRemote = true;
    useProductionStore.setState({ generator, meMode });
    applyingRemote = false;
  };

  // store → doc: write (or clear) those settings under one transaction. a
  // setting at its default is deleted rather than written, so a graph that
  // never touched one carries no entry for it
  const pushMeta = ({ generator, meMode }: ProductionState) => {
    if (
      isDeepEqual(yMeta.get('generator') ?? null, generator) &&
      (yMeta.get('meMode') === true) === meMode
    )
      return;

    writingLocal = true;

    doc.transact(() => {
      if (generator) yMeta.set('generator', generator);
      else yMeta.delete('generator');

      if (meMode) yMeta.set('meMode', true);
      else yMeta.delete('meMode');
    }, LOCAL_ORIGIN);

    writingLocal = false;
  };

  // sync the store to whatever the doc already holds (snapshot loaded before bind)
  pullToStore();
  pullMeta();

  const onDocChange = () => {
    if (writingLocal) return;

    pullToStore();
  };

  const onMetaChange = () => {
    if (writingLocal) return;

    pullMeta();
  };

  yNodes.observe(onDocChange);
  yEdges.observe(onDocChange);
  yMeta.observe(onMetaChange);

  const unsubscribe = useProductionStore.subscribe(state => {
    if (applyingRemote) return;

    pushToDoc(state.nodes, state.edges);
    pushMeta(state);
  });

  return {
    destroy: () => {
      unsubscribe();
      yNodes.unobserve(onDocChange);
      yEdges.unobserve(onDocChange);
      yMeta.unobserve(onMetaChange);
    },
  };
};
