import { mapRecipe, syncMirrors } from '../helpers';
import {
  type BaseRecipeNodeData,
  type EnergyHatch,
  type ProductionNode,
  type ProductionState,
  type RecipeKind,
  type SliceCreator,
  type VoltageTier,
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
    // a rename may leave a recipe<->recipe edge with disagreeing names — the edge
    // is kept (don't yank a connection mid-edit) and flagged by validateGraph
    set({ nodes: syncMirrors(nodes, get().edges) });
  },

  updateRecipeOutput: (nodeId, itemId, patch) => {
    const nodes = mapRecipe(get().nodes, nodeId, data => ({
      ...data,
      outputs: data.outputs.map(item =>
        item.id === itemId ? { ...item, ...patch } : item,
      ),
    }));
    // propagate name/quantity change to any connected sink; a now-mismatched
    // recipe<->recipe edge is left in place and surfaced by validateGraph
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

  // scalar recipe fields — `multiplier` scales effective I/O, so connected sink
  // and input leaves must re-sync; the others are no-ops for mirrors but cheap.
  // switching machine shape swaps the power fields over rather than keeping both
  updateRecipe: (nodeId, patch) => {
    const nodes = mapRecipe(get().nodes, nodeId, data => {
      // widened over both arms so the other shape's fields can be dropped
      // without a cast — narrowing back to the union happens on the way out
      const merged: BaseRecipeNodeData & {
        kind: RecipeKind;
        voltage?: VoltageTier;
        hatches?: EnergyHatch[];
        overclock?: 'imperfect' | 'perfect';
        parallels?: number;
      } = { ...data, ...patch };

      if (merged.kind === 'multi') {
        // carry a singleblock's tier over as one hatch group, so switching
        // shape keeps the machine roughly where the user had it
        const hatches = merged.hatches ?? [
          { tier: merged.voltage ?? 'LV', count: 1 },
        ];
        delete merged.voltage;
        return { ...merged, kind: 'multi', hatches };
      }

      const voltage = merged.voltage ?? merged.hatches?.[0]?.tier ?? 'LV';
      // hatches, parallels and the overclock choice belong to multiblocks only
      delete merged.hatches;
      delete merged.parallels;
      delete merged.overclock;
      return { ...merged, kind: 'single', voltage };
    });
    set({ nodes: syncMirrors(nodes, get().edges) });
  },
});
