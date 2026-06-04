import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type Node,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react';
import { temporal } from 'zundo';
import { useStore } from 'zustand';
import { persist } from 'zustand/middleware';
import { create } from 'zustand/react';
import { useShallow } from 'zustand/react/shallow';

export type ProductionNodeType =
  | 'inputNode'
  | 'outputNode'
  | 'machineNode'
  | 'disposalNode';

// class on the grip element; React Flow's dragHandle selector targets it (needs leading dot)
export const DRAG_HANDLE_CLASS = 'drag-handle_production';

// one produced item of a machine
export interface MachineOutput {
  id: string; // crypto.randomUUID()
  name: string; // editable item name
  quantity: number; // amount produced per cycle
}

// shared by every node — editable display name
export interface BaseNodeData extends Record<string, unknown> {
  name: string;
}

export type InputNodeData = BaseNodeData;
export type OutputNodeData = BaseNodeData;
export type DisposalNodeData = BaseNodeData;
export interface MachineNodeData extends BaseNodeData {
  outputs: MachineOutput[];
}

// node typed per variant so data matches the node `type`
export type ProductionNode =
  | Node<InputNodeData, 'inputNode'>
  | Node<OutputNodeData, 'outputNode'>
  | Node<DisposalNodeData, 'disposalNode'>
  | Node<MachineNodeData, 'machineNode'>;

interface ProductionState {
  nodes: ProductionNode[];
  edges: Edge[];

  // React Flow handlers
  onNodesChange: OnNodesChange<ProductionNode>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;

  // node ops
  addNode: (
    type: ProductionNodeType,
    position: { x: number; y: number },
  ) => void;
  removeNode: (id: string) => void;
  setNodes: (nodes: ProductionNode[]) => void;
  setEdges: (edges: Edge[]) => void;

  // replace the whole graph and wipe undo/redo history
  // reset() => empty (new line), reset(nodes, edges) => load a saved line
  reset: (nodes?: ProductionNode[], edges?: Edge[]) => void;

  // node data edits
  renameNode: (id: string, name: string) => void;

  // machine output edits (no-op if node is not a machine)
  addMachineOutput: (nodeId: string) => void;
  updateMachineOutput: (
    nodeId: string,
    outputId: string,
    patch: Partial<Omit<MachineOutput, 'id'>>,
  ) => void;
  removeMachineOutput: (nodeId: string, outputId: string) => void;
}

// collapse a burst of calls into one invocation, fired after the burst ends
// but using the FIRST call's args — zundo's handleSet receives the pre-change
// snapshot, so we must keep the state from before the burst, not after it
const debounce = <Args extends unknown[]>(
  callback: (...args: Args) => void,
  ms: number,
) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstArgs: Args;

  return (...args: Args) => {
    if (timer === undefined) firstArgs = args;
    else clearTimeout(timer);

    timer = setTimeout(() => {
      timer = undefined;
      callback(...firstArgs);
    }, ms);
  };
};

const createNode = (
  type: ProductionNodeType,
  position: { x: number; y: number },
): ProductionNode => {
  const base = {
    id: crypto.randomUUID(),
    position,
    dragHandle: `.${DRAG_HANDLE_CLASS}`,
  };

  switch (type) {
    case 'machineNode':
      return { ...base, type, data: { name: 'Machine', outputs: [] } };
    case 'inputNode':
      return { ...base, type, data: { name: 'Input' } };
    case 'outputNode':
      return { ...base, type, data: { name: 'Output' } };
    case 'disposalNode':
      return { ...base, type, data: { name: 'Disposal' } };
  }
};

// update data of a single machine node, leaving other nodes untouched
const mapMachine = (
  nodes: ProductionNode[],
  nodeId: string,
  update: (data: MachineNodeData) => MachineNodeData,
): ProductionNode[] =>
  nodes.map(node =>
    node.id === nodeId && node.type === 'machineNode'
      ? { ...node, data: update(node.data) }
      : node,
  );

// sink nodes whose name is driven by the connected machine output (not editable)
const SINK_TYPES = new Set<ProductionNodeType>(['outputNode', 'disposalNode']);

// display label for a connected sink, e.g. "Iron Plate x4"
const outputLabel = (output: MachineOutput): string =>
  `${output.name || 'Item'} x${output.quantity}`;

// rename every sink to its connected machine output's label; sinks with no
// incoming machine-output edge keep their current name
const relabelSinks = (
  nodes: ProductionNode[],
  edges: Edge[],
): ProductionNode[] => {
  // `${machineId}:${outputId}` -> label
  const labels = new Map<string, string>();

  for (const node of nodes) {
    if (node.type === 'machineNode')
      for (const output of node.data.outputs)
        labels.set(`${node.id}:${output.id}`, outputLabel(output));
  }

  // target sink id -> label (from edges leaving a machine output handle)
  const sinkLabels = new Map<string, string>();

  for (const edge of edges) {
    if (!edge.sourceHandle) continue;

    const label = labels.get(`${edge.source}:${edge.sourceHandle}`);

    if (label === undefined) continue;

    sinkLabels.set(edge.target, label);
  }

  return nodes.map(node => {
    const label = sinkLabels.get(node.id);

    return label !== undefined && SINK_TYPES.has(node.type)
      ? ({ ...node, data: { ...node.data, name: label } } as ProductionNode)
      : node;
  });
};

export const useProductionStore = create<ProductionState>()(
  persist(
    temporal(
      (set, get) => ({
        nodes: [],
        edges: [],

        onNodesChange: changes =>
          set({ nodes: applyNodeChanges(changes, get().nodes) }),
        onEdgesChange: changes =>
          set({ edges: applyEdgeChanges(changes, get().edges) }),
        onConnect: connection => {
          const edges = addEdge(
            {
              ...connection,
              animated: true,
              markerEnd: { type: 'arrowclosed' },
            },
            get().edges,
          );
          set({ edges, nodes: relabelSinks(get().nodes, edges) });
        },

        addNode: (type, position) =>
          set({ nodes: [...get().nodes, createNode(type, position)] }),

        removeNode: id =>
          set({
            nodes: get().nodes.filter(node => node.id !== id),
            edges: get().edges.filter(
              edge => edge.source !== id && edge.target !== id,
            ),
          }),

        setNodes: nodes => set({ nodes }),
        setEdges: edges => set({ edges }),

        reset: (nodes = [], edges = []) => {
          set({ nodes, edges });
          // drop history so undo can't reach the previous production line
          useProductionStore.temporal.getState().clear();
        },

        renameNode: (id, name) =>
          set({
            nodes: get().nodes.map(node =>
              node.id === id
                ? ({ ...node, data: { ...node.data, name } } as ProductionNode)
                : node,
            ),
          }),

        addMachineOutput: nodeId =>
          set({
            nodes: mapMachine(get().nodes, nodeId, data => ({
              ...data,
              outputs: [
                ...data.outputs,
                { id: crypto.randomUUID(), name: '', quantity: 1 },
              ],
            })),
          }),

        updateMachineOutput: (nodeId, outputId, patch) => {
          const nodes = mapMachine(get().nodes, nodeId, data => ({
            ...data,
            outputs: data.outputs.map(output =>
              output.id === outputId ? { ...output, ...patch } : output,
            ),
          }));
          // propagate name/quantity change to any connected sink
          set({ nodes: relabelSinks(nodes, get().edges) });
        },

        removeMachineOutput: (nodeId, outputId) => {
          const nodes = mapMachine(get().nodes, nodeId, data => ({
            ...data,
            outputs: data.outputs.filter(output => output.id !== outputId),
          }));
          // drop edges leaving the removed output handle (now dangling)
          const edges = get().edges.filter(
            edge => !(edge.source === nodeId && edge.sourceHandle === outputId),
          );
          set({ nodes: relabelSinks(nodes, edges), edges });
        },
      }),
      {
        // only track graph data in history (not handler/action refs)
        partialize: state => ({ nodes: state.nodes, edges: state.edges }),
        // group rapid sets (e.g. a node drag) into a single undo step
        // instead of one entry per pixel of movement
        handleSet: handleSet => debounce(handleSet, 400),
        limit: 100, // cap history depth
      },
    ),
    {
      name: 'gtnh-production-line', // localStorage key
      // persist graph only, not history
      partialize: state => ({ nodes: state.nodes, edges: state.edges }),
    },
  ),
);

// subscribe to undo/redo state: { undo, redo, clear, pastStates, futureStates, ... }
export const useProductionHistory = () => useStore(useProductionStore.temporal);

// all props React Flow needs — spread onto <ReactFlow {...useProductionFlow()} />
export const useProductionFlow = () =>
  useProductionStore(
    useShallow(state => ({
      nodes: state.nodes,
      edges: state.edges,
      onNodesChange: state.onNodesChange,
      onEdgesChange: state.onEdgesChange,
      onConnect: state.onConnect,
    })),
  );

// all callbacks the controls UI needs: node/graph mutations + undo/redo
export const useProductionControls = () => {
  const actions = useProductionStore(
    useShallow(state => ({
      addNode: state.addNode,
      removeNode: state.removeNode,
      reset: state.reset,
      renameNode: state.renameNode,
      addMachineOutput: state.addMachineOutput,
      updateMachineOutput: state.updateMachineOutput,
      removeMachineOutput: state.removeMachineOutput,
    })),
  );

  const { undo, redo, clear, pastStates, futureStates } =
    useProductionHistory();

  return {
    ...actions,
    undo,
    redo,
    clearHistory: clear,
    canUndo: pastStates.length > 0,
    canRedo: futureStates.length > 0,
  };
};
