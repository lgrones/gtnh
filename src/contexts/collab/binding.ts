import { type Edge } from '@xyflow/react';

import {
  normalizeNodes,
  syncMirrors,
  useProductionStore,
  type GeneratorBankEntry,
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

// Only ONE binding may write to its doc, and it is always the most recent one.
//
// `pushToDoc` is destructive by design: it deletes every node the store does
// not have. That is correct for the graph the user is looking at and ruinous
// for any other, so a binding that has been superseded must never run it. The
// token lives on `globalThis` rather than in this module because the case it
// guards against is precisely the one where this module exists twice: a dev
// HMR update replaces `session.ts` (or anything it imports) without tearing the
// old session down, leaving a live binding that still holds the PREVIOUS
// graph's doc while subscribed to the store the new graph just loaded into. It
// then mirrors the open graph's nodes into the other graph's doc, deletes that
// graph's own, and autosaves the result over it.
const ACTIVE = Symbol.for('gtnh.collab.activeBinding');

const holder = globalThis as { [ACTIVE]?: object };

// keep the Zustand store (what XYFlow renders) and the Yjs doc mirrored both
// ways. two flags break the echo loop: a local store→doc write fires the doc
// observer (skipped via writingLocal), and a doc→store apply fires the store
// subscriber (skipped via applyingRemote).
export const bindStore = (graph: YjsGraph): Binding => {
  const { doc, nodes: yNodes, edges: yEdges, meta: yMeta } = graph;
  let applyingRemote = false;
  let writingLocal = false;

  // claimed before anything else runs. `pullToStore` below rewrites the store
  // to this graph's contents, and every binding still listening would mirror
  // THAT into its own doc — an empty new graph emptying the one just closed
  const token = {};
  holder[ACTIVE] = token;

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
    // are backfilled here as well as in `reset` — this is the live path.
    // syncMirrors on top of it because a leaf's quantity is derived, and a doc
    // written before the derivation changed still carries the old number: an
    // input node feeding a loop was saved asking for the whole amount rather
    // than the shortfall. `applyingRemote` keeps this out of the doc, so the
    // correction is local until someone's next edit pushes it
    const backfilled = normalizeNodes(nodes);
    useProductionStore.setState({
      nodes: syncMirrors(backfilled, edges),
      edges,
    });
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

  // doc → store: the per-graph settings `meta` carries. a key the doc never set
  // falls back to the same default `reset` uses
  const pullMeta = () => {
    const generator =
      (yMeta.get('generator') as GeneratorSelection | undefined) ?? null;
    // absent means nobody has edited the bank, and the panel is showing what
    // the picker above it suggests — a different state from an empty bank,
    // which is someone having deleted every row
    const generatorBank =
      (yMeta.get('generatorBank') as GeneratorBankEntry[] | undefined) ?? null;

    applyingRemote = true;
    useProductionStore.setState({ generator, generatorBank });
    applyingRemote = false;
  };

  // store → doc: write (or clear) those settings under one transaction. a
  // setting at its default is deleted rather than written, so a graph that
  // never touched one carries no entry for it
  const pushMeta = ({ generator, generatorBank }: ProductionState) => {
    if (
      isDeepEqual(yMeta.get('generator') ?? null, generator) &&
      isDeepEqual(yMeta.get('generatorBank') ?? null, generatorBank)
    )
      return;

    writingLocal = true;

    doc.transact(() => {
      if (generator) yMeta.set('generator', generator);
      else yMeta.delete('generator');

      // the whole bank is one value, so two people editing rows at once is
      // last-write-wins on the bank rather than on the row — the same deal the
      // generator picker has always had
      if (generatorBank) yMeta.set('generatorBank', generatorBank);
      else yMeta.delete('generatorBank');
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
    // superseded: the store now belongs to some other graph, so anything this
    // binding wrote would be that graph's content landing in this one's doc
    if (holder[ACTIVE] !== token) return;

    pushToDoc(state.nodes, state.edges);
    pushMeta(state);
  });

  return {
    destroy: () => {
      unsubscribe();
      if (holder[ACTIVE] === token) delete holder[ACTIVE];
      yNodes.unobserve(onDocChange);
      yEdges.unobserve(onDocChange);
      yMeta.unobserve(onMetaChange);
    },
  };
};
