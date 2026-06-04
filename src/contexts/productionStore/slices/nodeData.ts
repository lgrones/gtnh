import { mapMachine, syncSinks } from '../helpers';
import { type ProductionState, type SliceCreator } from '../types';

type NodeDataSlice = Pick<
  ProductionState,
  | 'renameNode'
  | 'setInputQuantity'
  | 'addMachineOutput'
  | 'updateMachineOutput'
  | 'removeMachineOutput'
>;

// edits to a node's own data: names, input quantity, machine outputs
export const createNodeDataSlice: SliceCreator<NodeDataSlice> = (set, get) => ({
  renameNode: (id, name) =>
    set({
      nodes: get().nodes.map(node =>
        node.id === id ? { ...node, data: { ...node.data, name } } : node,
      ),
    }),

  setInputQuantity: (id, quantity) =>
    set({
      nodes: get().nodes.map(node =>
        node.id === id && node.type === 'inputNode'
          ? { ...node, data: { ...node.data, quantity } }
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
    set({ nodes: syncSinks(nodes, get().edges) });
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
    set({ nodes: syncSinks(nodes, edges), edges });
  },
});
