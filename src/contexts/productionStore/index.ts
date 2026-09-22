import { useStore as useFlowStore, type ReactFlowState } from '@xyflow/react';
import { create } from 'zustand/react';
import { useShallow } from 'zustand/react/shallow';
import { shallow } from 'zustand/shallow';

import { normalizeNodes } from './helpers';
import { createClipboardSlice } from './slices/clipboard';
import { createGraphSlice } from './slices/graph';
import { createNodeDataSlice } from './slices/nodeData';
import { type ProductionNode, type ProductionState } from './types';

export type {
  BaseNodeData,
  BaseRecipeNodeData,
  Clipboard,
  ByproductNodeData,
  EdgeData,
  EnergyHatch,
  GeneratorSelection,
  InputNodeData,
  LineCapture,
  LineNodeData,
  LinePort,
  LineTier,
  MachineConfig,
  MultiblockRecipeData,
  OutputNodeData,
  PlaceableNodeType,
  ProductionNode,
  ProductionNodeType,
  ProductionState,
  RecipeFields,
  RecipeItem,
  RecipeKind,
  RecipeNodeData,
  SingleblockRecipeData,
  SinkNodeData,
  VoltageTier,
  Waypoint,
} from './types';
export { DEFAULT_HATCH_AMPS, DRAG_HANDLE_CLASS, VOLTAGE_TIERS } from './types';
export type { HandleOffsets } from './helpers';
export { cachedRates, steadyRates, type LineRates } from './rates';
export {
  captureLine,
  layoutNodes,
  machineAmps,
  machineTier,
  nodeItems,
  normalizeNodes,
  syncMirrors,
  validateGraph,
  lineEnergy,
  lineMetrics,
  demandByTier,
  recipePower,
  itemKey,
  itemPerPass,
  itemRate,
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

// every item name used anywhere in the graph, offered as completions wherever
// an item is typed. Item names are free text and are what the balance
// arithmetic matches on, so two spellings of one item read as two items; the
// cheapest place to stop that is where the name is entered.
//
// Read from XYFlow's store rather than this one, even though this one is the
// source of truth: XYFlow copies the `nodes` prop into its own store in an
// effect, so for one commit its nodes lag this store. A node subscribed to
// BOTH re-renders on that lagging commit with the name it is being told to
// forget still in `data` — and React, seeing a controlled input whose value
// disagrees with the DOM, writes the stale name back and drops the caret at
// the end of it. Subscribing to the same store the node's own `data` comes
// from means completions and data always arrive together.
const collectItemNames = (state: ReactFlowState): string[] => {
  const names = new Set<string>();

  const add = (name: string) => {
    if (name.trim() !== '') names.add(name.trim());
  };

  for (const node of state.nodes as ProductionNode[]) {
    if (node.type === 'recipeNode')
      for (const item of [...node.data.inputs, ...node.data.outputs])
        add(item.name);
  }

  return [...names].sort((a, b) => a.localeCompare(b));
};

// only valid inside the flow — XYFlow's store lives in React context
export const useItemNames = (): string[] =>
  useFlowStore(collectItemNames, shallow);

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
      addLineNode: state.addLineNode,
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
      setEdges: state.setEdges,
      deselectAll: state.deselectAll,
    })),
  );
