import { temporal } from 'zundo';
import { useStore } from 'zustand';
import { create } from 'zustand/react';
import { useShallow } from 'zustand/react/shallow';

import { debounce, normalizeNodes, sameHistoryState } from './helpers';
import { createClipboardSlice } from './slices/clipboard';
import { createGraphSlice } from './slices/graph';
import { createNodeDataSlice } from './slices/nodeData';
import { type ProductionState } from './types';

export type {
  BaseNodeData,
  Clipboard,
  DisposalNodeData,
  InputNodeData,
  OutputNodeData,
  ProductionNode,
  ProductionNodeType,
  ProductionState,
  RecipeItem,
  RecipeNodeData,
  SinkNodeData,
  VoltageTier,
} from './types';
export { DRAG_HANDLE_CLASS, VOLTAGE_TIERS } from './types';
export {
  layoutNodes,
  validateGraph,
  lineEnergy,
  demandByTier,
  recipePower,
  TICKS_PER_SECOND,
  type GraphIssue,
  type LineEnergy,
  type TierDemand,
} from './helpers';

// the live editing surface for the active graph. persistence lives in the
// library store (useProductionLibrary) — this store is hydrated from / synced
// back to the active saved graph, and only tracks undo/redo history here
export const useProductionStore = create<ProductionState>()(
  temporal(
    (set, get) => ({
      ...createGraphSlice(set, get),
      ...createNodeDataSlice(set, get),
      ...createClipboardSlice(set, get),

      reset: (nodes = [], edges = []) => {
        // pause tracking so loading a line isn't itself recorded — otherwise the
        // debounced push fires *after* clear() and leaves a phantom undo entry
        const temporal = useProductionStore.temporal.getState();
        temporal.pause();
        set({ nodes: normalizeNodes(nodes), edges });
        temporal.resume();
        // drop history so undo can't reach the previous production line
        temporal.clear();
      },
    }),
    {
      // only track graph data in history (not handler/action refs)
      partialize: state => ({ nodes: state.nodes, edges: state.edges }),
      // ignore React Flow's volatile churn (measured size, selection, drag) so
      // it doesn't flood history or wipe the redo stack on a re-measure
      equality: sameHistoryState,
      // group rapid sets (e.g. a node drag) into a single undo step
      // instead of one entry per pixel of movement
      handleSet: handleSet => debounce(handleSet, 400),
      limit: 100, // cap history depth
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
      onReconnect: state.onReconnect,
      isValidConnection: state.isValidConnection,
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
      addRecipeInput: state.addRecipeInput,
      addRecipeOutput: state.addRecipeOutput,
      updateRecipeInput: state.updateRecipeInput,
      updateRecipeOutput: state.updateRecipeOutput,
      removeRecipeInput: state.removeRecipeInput,
      removeRecipeOutput: state.removeRecipeOutput,
      updateRecipe: state.updateRecipe,
      copySelection: state.copySelection,
      paste: state.paste,
      setNodes: state.setNodes,
      deselectAll: state.deselectAll,
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
