import {
  type Edge,
  type IsValidConnection,
  type Node,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react';
import { type StoreApi } from 'zustand';

export type ProductionNodeType =
  | 'inputNode'
  | 'outputNode'
  | 'recipeNode'
  | 'disposalNode';

// class on the grip element; React Flow's dragHandle selector targets it (needs leading dot)
export const DRAG_HANDLE_CLASS = 'drag-handle_production';

// GTNH voltage tiers, low to high
export const VOLTAGE_TIERS = [
  'ULV',
  'LV',
  'MV',
  'HV',
  'EV',
  'IV',
  'LuV',
  'ZPM',
  'UV',
  'UHV',
  'UEV',
  'UIV',
  'UMV',
  'UXV',
  'MAX',
] as const;
export type VoltageTier = (typeof VOLTAGE_TIERS)[number];

// a recipe is powered by electricity (voltage + amperage) or steam — never both
export type PowerType = 'electric' | 'steam';

// one item slot of a recipe — used for both inputs and outputs
export interface RecipeItem {
  id: string; // crypto.randomUUID()
  name: string; // editable item name
  quantity: number; // amount per cycle
}

// shared by every node — editable display name
export interface BaseNodeData extends Record<string, unknown> {
  name: string;
}

// leaf name + quantity mirror the connected recipe item (input or output)
export interface SinkNodeData extends BaseNodeData {
  quantity: number;
}
// input nodes are now mirror leaves too (reverse of output nodes)
export type InputNodeData = SinkNodeData;
export type OutputNodeData = SinkNodeData;
export type DisposalNodeData = SinkNodeData;

export interface RecipeNodeData extends BaseNodeData {
  machine: string; // free-text machine name
  inputs: RecipeItem[];
  outputs: RecipeItem[];
  power: PowerType; // which energy set applies
  voltage: VoltageTier; // electric tier
  amperage: number; // electric amps
  steam: number; // steam L/t
}

// node typed per variant so data matches the node `type`
export type ProductionNode =
  | Node<InputNodeData, 'inputNode'>
  | Node<OutputNodeData, 'outputNode'>
  | Node<DisposalNodeData, 'disposalNode'>
  | Node<RecipeNodeData, 'recipeNode'>;

export interface Clipboard {
  nodes: ProductionNode[];
  edges: Edge[];
}

export interface ProductionState {
  nodes: ProductionNode[];
  edges: Edge[];

  // React Flow handlers
  onNodesChange: OnNodesChange<ProductionNode>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  isValidConnection: IsValidConnection;

  // node ops
  addNode: (
    type: ProductionNodeType,
    position: { x: number; y: number },
  ) => void;
  removeNode: (id: string) => void;
  setNodes: (nodes: ProductionNode[]) => void;
  setEdges: (edges: Edge[]) => void;
  deselectAll: () => void;

  // copy/paste — clipboard holds clones of the last copied selection
  clipboard: Clipboard | null;
  copySelection: () => void;
  paste: () => void;

  // replace the whole graph and wipe undo/redo history
  // reset() => empty (new line), reset(nodes, edges) => load a saved line
  reset: (nodes?: ProductionNode[], edges?: Edge[]) => void;

  // node data edits
  renameNode: (id: string, name: string) => void;

  // recipe item + scalar edits (no-op if node is not a recipe)
  addRecipeInput: (nodeId: string) => void;
  addRecipeOutput: (nodeId: string) => void;
  updateRecipeInput: (
    nodeId: string,
    itemId: string,
    patch: Partial<Omit<RecipeItem, 'id'>>,
  ) => void;
  updateRecipeOutput: (
    nodeId: string,
    itemId: string,
    patch: Partial<Omit<RecipeItem, 'id'>>,
  ) => void;
  removeRecipeInput: (nodeId: string, itemId: string) => void;
  removeRecipeOutput: (nodeId: string, itemId: string) => void;
  updateRecipe: (
    nodeId: string,
    patch: Partial<
      Pick<
        RecipeNodeData,
        'machine' | 'power' | 'voltage' | 'amperage' | 'steam'
      >
    >,
  ) => void;
}

// a slice contributes part of the store; it gets the full store's set/get so
// slices can read across each other (e.g. paste reads nodes, sinks read edges)
export type SliceCreator<T> = (
  set: StoreApi<ProductionState>['setState'],
  get: StoreApi<ProductionState>['getState'],
) => T;
