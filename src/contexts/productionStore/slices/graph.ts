import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  ConnectionLineType,
  reconnectEdge,
} from '@xyflow/react';

import {
  createNode,
  freeSingleSlot,
  isValidConnection,
  syncMirrors,
} from '../helpers';
import { type ProductionState, type SliceCreator } from '../types';

type GraphSlice = Pick<
  ProductionState,
  | 'nodes'
  | 'edges'
  | 'onNodesChange'
  | 'onEdgesChange'
  | 'onConnect'
  | 'onReconnect'
  | 'isValidConnection'
  | 'addNode'
  | 'removeNode'
  | 'setNodes'
  | 'setEdges'
  | 'deselectAll'
>;

// shared edge style for both fresh connections and reconnections
const EDGE_STYLE = {
  type: ConnectionLineType.SmoothStep,
  animated: true,
  markerEnd: { type: 'arrowclosed' as const },
};

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
  isValidConnection: connection => isValidConnection(get().nodes, connection),

  onConnect: connection => {
    const nodes = get().nodes;
    // reject recipe<->recipe edges whose item names disagree (leaves mirror)
    if (!isValidConnection(nodes, connection)) return;
    // free the leaf's single slot, then attach the new edge
    const base = freeSingleSlot(nodes, get().edges, connection);
    const edges = addEdge({ ...connection, ...EDGE_STYLE }, base);
    set({ edges, nodes: syncMirrors(nodes, edges) });
  },

  // drag an edge endpoint onto a different handle — keep the edge (and its id),
  // just move where it lands. invalid drops leave the edge untouched
  onReconnect: (oldEdge, connection) => {
    const nodes = get().nodes;
    if (!isValidConnection(nodes, connection)) return;
    // free the new endpoint's slot but keep the edge we're moving onto it
    const base = freeSingleSlot(nodes, get().edges, connection, oldEdge.id);
    // keep the original edge id so identity/selection survives the move
    const edges = reconnectEdge(oldEdge, connection, base, {
      shouldReplaceId: false,
    });
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
