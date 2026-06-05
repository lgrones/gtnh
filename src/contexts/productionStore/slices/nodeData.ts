import { mapRecipe, syncMirrors } from '../helpers';
import {
  type ProductionNode,
  type ProductionState,
  type SliceCreator,
} from '../types';

type NodeDataSlice = Pick<
  ProductionState,
  | 'renameNode'
  | 'addRecipeInput'
  | 'addRecipeOutput'
  | 'updateRecipeInput'
  | 'updateRecipeOutput'
  | 'removeRecipeInput'
  | 'removeRecipeOutput'
  | 'updateRecipe'
>;

const newItem = () => ({ id: crypto.randomUUID(), name: '', quantity: 1 });

// edits to a node's own data: names, recipe items + scalar recipe fields
export const createNodeDataSlice: SliceCreator<NodeDataSlice> = (set, get) => ({
  renameNode: (id, name) =>
    set({
      nodes: get().nodes.map(node =>
        node.id === id
          ? ({ ...node, data: { ...node.data, name } } as ProductionNode)
          : node,
      ),
    }),

  addRecipeInput: nodeId =>
    set({
      nodes: mapRecipe(get().nodes, nodeId, data => ({
        ...data,
        inputs: [...data.inputs, newItem()],
      })),
    }),

  addRecipeOutput: nodeId =>
    set({
      nodes: mapRecipe(get().nodes, nodeId, data => ({
        ...data,
        outputs: [...data.outputs, newItem()],
      })),
    }),

  updateRecipeInput: (nodeId, itemId, patch) => {
    const nodes = mapRecipe(get().nodes, nodeId, data => ({
      ...data,
      inputs: data.inputs.map(item =>
        item.id === itemId ? { ...item, ...patch } : item,
      ),
    }));
    // propagate name/quantity change to any connected input leaf
    set({ nodes: syncMirrors(nodes, get().edges) });
  },

  updateRecipeOutput: (nodeId, itemId, patch) => {
    const nodes = mapRecipe(get().nodes, nodeId, data => ({
      ...data,
      outputs: data.outputs.map(item =>
        item.id === itemId ? { ...item, ...patch } : item,
      ),
    }));
    // propagate name/quantity change to any connected sink
    set({ nodes: syncMirrors(nodes, get().edges) });
  },

  removeRecipeInput: (nodeId, itemId) => {
    const nodes = mapRecipe(get().nodes, nodeId, data => ({
      ...data,
      inputs: data.inputs.filter(item => item.id !== itemId),
    }));
    // drop edges entering the removed input handle (now dangling)
    const edges = get().edges.filter(
      edge => !(edge.target === nodeId && edge.targetHandle === itemId),
    );
    set({ nodes: syncMirrors(nodes, edges), edges });
  },

  removeRecipeOutput: (nodeId, itemId) => {
    const nodes = mapRecipe(get().nodes, nodeId, data => ({
      ...data,
      outputs: data.outputs.filter(item => item.id !== itemId),
    }));
    // drop edges leaving the removed output handle (now dangling)
    const edges = get().edges.filter(
      edge => !(edge.source === nodeId && edge.sourceHandle === itemId),
    );
    set({ nodes: syncMirrors(nodes, edges), edges });
  },

  // scalar recipe fields (machine, power, voltage, amperage, steam) — no mirror
  updateRecipe: (nodeId, patch) =>
    set({
      nodes: mapRecipe(get().nodes, nodeId, data => ({ ...data, ...patch })),
    }),
});
