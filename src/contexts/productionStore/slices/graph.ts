import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react';

import { SINK_TYPES, createNode, syncMirrors } from '../helpers';
import { type ProductionState, type SliceCreator } from '../types';

type GraphSlice = Pick<
  ProductionState,
  | 'nodes'
  | 'edges'
  | 'onNodesChange'
  | 'onEdgesChange'
  | 'onConnect'
  | 'addNode'
  | 'removeNode'
  | 'setNodes'
  | 'setEdges'
  | 'deselectAll'
>;

// nodes, edges and the React Flow change handlers — the core graph
export const createGraphSlice: SliceCreator<GraphSlice> = (set, get) => ({
  nodes: [],
  edges: [],

  onNodesChange: changes => {
    const nodes = applyNodeChanges(changes, get().nodes);
    // a removed node may orphan a mirror leaf — keep leaf labels in sync
    const removed = changes.some(change => change.type === 'remove');
    set(removed ? { nodes: syncMirrors(nodes, get().edges) } : { nodes });
  },
  onEdgesChange: changes => {
    const edges = applyEdgeChanges(changes, get().edges);
    const removed = changes.some(change => change.type === 'remove');
    set(
      removed ? { edges, nodes: syncMirrors(get().nodes, edges) } : { edges },
    );
  },
  onConnect: connection => {
    const nodes = get().nodes;
    // sinks mirror a single recipe output — replace any existing incoming edge
    const targetIsSink = nodes.some(
      node => node.id === connection.target && SINK_TYPES.has(node.type),
    );
    // an input leaf mirrors a single recipe input — replace its outgoing edge
    const sourceIsInput = nodes.some(
      node => node.id === connection.source && node.type === 'inputNode',
    );
    const base = get().edges.filter(
      edge =>
        !(targetIsSink && edge.target === connection.target) &&
        !(sourceIsInput && edge.source === connection.source),
    );

    const edges = addEdge(
      { ...connection, animated: true, markerEnd: { type: 'arrowclosed' } },
      base,
    );
    set({ edges, nodes: syncMirrors(nodes, edges) });
  },

  addNode: (type, position) =>
    set({ nodes: [...get().nodes, createNode(type, position)] }),

  removeNode: id => {
    const nodes = get().nodes.filter(node => node.id !== id);
    const edges = get().edges.filter(
      edge => edge.source !== id && edge.target !== id,
    );
    set({ nodes: syncMirrors(nodes, edges), edges });
  },

  setNodes: nodes => set({ nodes }),
  setEdges: edges => set({ edges }),

  deselectAll: () =>
    set({
      nodes: get().nodes.map(node =>
        node.selected ? { ...node, selected: false } : node,
      ),
      edges: get().edges.map(edge =>
        edge.selected ? { ...edge, selected: false } : edge,
      ),
    }),
});
