import { create } from 'zustand/react';
import { useShallow } from 'zustand/react/shallow';

import { normalizeNodes } from './helpers';
import { createClipboardSlice } from './slices/clipboard';
import { createGraphSlice } from './slices/graph';
import { createNodeDataSlice } from './slices/nodeData';
import { type ProductionState } from './types';

export type {
  BaseNodeData,
  BaseRecipeNodeData,
  Clipboard,
  DisposalNodeData,
  EdgeData,
  EnergyHatch,
  GeneratorSelection,
  InputNodeData,
  MachineConfig,
  MultiblockRecipeData,
  OutputNodeData,
  ProductionNode,
  ProductionNodeType,
  ProductionState,
  RecipeFields,
  RecipeItem,
  RecipeKind,
  RecipeNodeData,
  SingleblockRecipeData,
  SinkNodeData,
  StorageItem,
  StorageNodeData,
  VoltageTier,
  Waypoint,
} from './types';
export { DEFAULT_HATCH_AMPS, DRAG_HANDLE_CLASS, VOLTAGE_TIERS } from './types';
export {
  layoutNodes,
  machineAmps,
  machineTier,
  normalizeNodes,
  validateGraph,
  lineEnergy,
  lineMetrics,
  demandByTier,
  recipePower,
  itemKey,
  itemPerPass,
  itemRate,
  meLedger,
  TICKS_PER_SECOND,
  type GraphIssue,
  type LedgerEntry,
  type LineEnergy,
  type LineMetrics,
  type MeLedger,
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

  meMode: false,
  setMeMode: on => set({ meMode: on }),

  reset: (nodes = [], edges = []) =>
    set({
      nodes: normalizeNodes(nodes),
      edges,
      generator: null,
      meMode: false,
    }),
}));

// every item name used anywhere in the graph — recipe rows and storage rows
// alike — offered as completions wherever an item is typed. Item names are free
// text and are what the ME ledger groups on, so two spellings of one item split
// it into a phantom shortage and a phantom product; the cheapest place to stop
// that is where the name is entered
export const useItemNames = () =>
  useProductionStore(
    useShallow(state => {
      const names = new Set<string>();

      const add = (name: string) => {
        if (name.trim() !== '') names.add(name.trim());
      };

      for (const node of state.nodes) {
        if (node.type === 'recipeNode')
          for (const item of [...node.data.inputs, ...node.data.outputs])
            add(item.name);
        else if (node.type === 'storageNode')
          for (const item of node.data.items) add(item.name);
      }

      return [...names].sort((a, b) => a.localeCompare(b));
    }),
  );

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
