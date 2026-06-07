import { create } from 'zustand/react';
import { useShallow } from 'zustand/react/shallow';

import { normalizeNodes } from './helpers';
import { createClipboardSlice } from './slices/clipboard';
import { createGraphSlice } from './slices/graph';
import { createNodeDataSlice } from './slices/nodeData';
import { type ProductionState } from './types';

export type {
  BaseNodeData,
  Clipboard,
  DisposalNodeData,
  GeneratorSelection,
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
  lineMetrics,
  demandByTier,
  recipePower,
  TICKS_PER_SECOND,
  type GraphIssue,
  type LineEnergy,
  type LineMetrics,
  type Entry as ItemAmount,
  type MachineEntry,
  type TierDemand,
} from './helpers';

// the live editing surface for the active graph. the graph is a Yjs doc owned by
// the collab session (@/contexts/collab/session), which mirrors edits into this
// store both ways and drives undo/redo via Y.UndoManager. this store just holds
// what XYFlow renders + the mutation actions.
export const useProductionStore = create<ProductionState>()((set, get) => ({
  ...createGraphSlice(set, get),
  ...createNodeDataSlice(set, get),
  ...createClipboardSlice(set, get),

  generator: null,
  setGenerator: selection => set({ generator: selection }),

  reset: (nodes = [], edges = []) =>
    set({ nodes: normalizeNodes(nodes), edges, generator: null }),
}));

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

// the node/graph mutation actions the controls UI needs. undo/redo live in the
// collab session (@/contexts/collab/session, useCollab) since history is owned
// by the graph's Y.UndoManager, not this store.
export const useProductionControls = () =>
  useProductionStore(
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
