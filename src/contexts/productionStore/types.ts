import {
  type Edge,
  type IsValidConnection,
  type Node,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
  type OnReconnect,
} from '@xyflow/react';
import { type StoreApi } from 'zustand';

import type { MachineConfig } from '@/domain/machines/types';

// re-exported so a node's own fields can be typed without reaching into the
// domain layer for the one bag the store persists
export type { MachineConfig };

export type ProductionNodeType =
  | 'inputNode'
  | 'outputNode'
  | 'recipeNode'
  | 'disposalNode';

// class on the grip element; React Flow's dragHandle selector targets it (needs leading dot)
export const DRAG_HANDLE_CLASS = 'drag-handle_production';

// GTNH voltage tiers, low to high. ULV is omitted on purpose — it isn't a real
// generator tier (LV generators already power ULV machines)
export const VOLTAGE_TIERS = [
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

// a hand-placed bend point on an edge, in flow coordinates
export interface Waypoint {
  x: number;
  y: number;
}

// edge payload: the user's manual routing waypoints (absent until they bend it)
export interface EdgeData extends Record<string, unknown> {
  points?: Waypoint[];
}

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

// which of the two machine shapes a recipe node represents. a singleblock is
// free text and is fed by its own tier; a multiblock picks its machine from the
// generated catalog (@/domain/machines) and is fed by its hatches
export type RecipeKind = 'single' | 'multi';

// one group of identical energy hatches feeding a multiblock. the common case is
// a single group ("2 HV hatches"); a list only to allow the rare mixed-tier build
export interface EnergyHatch {
  tier: VoltageTier;
  count: number;
  // maxWorkingAmperesIn for one hatch of this group. every standard GT energy
  // hatch takes 2 A; laser and wireless hatches take far more, which is the
  // only reason this is a field and not a constant. GT reads it as
  // getMaxInputAmps() — the sum over every hatch — and that is a different
  // quantity from the tier sum the parallel formulas use
  amps: number;
}

// what every standard GT energy hatch delivers
export const DEFAULT_HATCH_AMPS = 2;

// the fields both machine shapes share. how each is FED differs — a singleblock
// by its own tier, a multiblock by its energy hatches — so those live on their
// respective arms. `amperage` is shared because it describes the RECIPE, not the
// machine; conflating it with hatch count caused a lot of confusion
export interface BaseRecipeNodeData extends BaseNodeData {
  machine: string; // free text for singleblocks, a catalog name for multiblocks
  inputs: RecipeItem[];
  outputs: RecipeItem[];
  multiplier: number; // sequential run count — scales effective I/O and time
  eu: number; // total EU consumed by one run of the recipe, before overclocking
  time: number; // processing time of one run, in seconds, before overclocking
  // amps the RECIPE itself draws — multiblock recipes have these too (the
  // Industrial Arc Furnace needs 3A for some of them). used for generator
  // sizing; it is a delivery requirement, never an overclock input
  amperage: number;
}

export interface SingleblockRecipeData extends BaseRecipeNodeData {
  kind: 'single';
  voltage: VoltageTier; // the machine's own tier — what it overclocks against
}

export interface MultiblockRecipeData extends BaseRecipeNodeData {
  kind: 'multi';
  // what feeds it. GT reads three different numbers off this list — see
  // hatchSupply in @/domain/overclock
  hatches: EnergyHatch[];

  // the machine's own parameters — which coils are in it, what tier its pipe
  // casings are. a bag rather than named fields because the machine DATA
  // declares which parameters exist; typing them here would put that
  // declaration in two places and make adding a machine a TypeScript change.
  // safety comes back at the one read boundary, resolveMachine, which validates
  // and defaults every value. absent means every parameter at its default
  config?: MachineConfig;

  // the recipe's mSpecialValue in K, as NEI prints it. a property of the RECIPE,
  // not the machine, and only offered when the machine reads heat at all
  recipeHeat?: number;

  // an optional ceiling the user puts on parallels. absent means the machine's
  // own cap stands, which is the normal case now that the cap is real data
  parallelLimit?: number;
}

export type RecipeNodeData = SingleblockRecipeData | MultiblockRecipeData;

// the scalar fields `updateRecipe` may patch. spelled out rather than Pick'd off
// the union, since `kind` and the power fields exist on only one arm of it
export interface RecipeFields extends Pick<
  BaseRecipeNodeData,
  'machine' | 'multiplier' | 'eu' | 'time'
> {
  kind: RecipeKind;
  voltage: VoltageTier;
  amperage: number;
  hatches: EnergyHatch[];
  config?: MachineConfig;
  recipeHeat?: number;
  parallelLimit?: number;
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

// per-graph generator picker selection for the energy panel. `fuelName` null
// means "default to the category's first fuel". stored per graph (mirrored into
// the Yjs doc), so each graph keeps its own choice.
export interface GeneratorSelection {
  categoryId: string;
  fuelName: string | null;
}

export interface ProductionState {
  nodes: ProductionNode[];
  edges: Edge[];

  // React Flow handlers
  onNodesChange: OnNodesChange<ProductionNode>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  // drag an existing edge's endpoint onto another handle without deleting first
  onReconnect: OnReconnect;
  isValidConnection: IsValidConnection;

  // node ops
  addNode: (
    type: ProductionNodeType,
    position: { x: number; y: number },
  ) => void;
  removeNode: (id: string) => void;
  setNodes: (nodes: ProductionNode[]) => void;
  setEdges: (edges: Edge[]) => void;
  // replace an edge's manual routing waypoints (empty array clears them)
  setEdgePoints: (id: string, points: Waypoint[]) => void;
  deselectAll: () => void;

  // copy/paste — clipboard holds clones of the last copied selection
  clipboard: Clipboard | null;
  copySelection: () => void;
  // paste at the given flow position (anchored to the selection's top-left);
  // falls back to a fixed offset from the originals when no position is given
  paste: (position?: { x: number; y: number }) => void;

  // per-graph generator selection (null until the user picks one). mirrored to
  // the Yjs doc by the collab binding, so it's saved + synced with the graph.
  generator: GeneratorSelection | null;
  setGenerator: (selection: GeneratorSelection) => void;

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
  updateRecipe: (nodeId: string, patch: Partial<RecipeFields>) => void;
}

// a slice contributes part of the store; it gets the full store's set/get so
// slices can read across each other (e.g. paste reads nodes, sinks read edges)
export type SliceCreator<T> = (
  set: StoreApi<ProductionState>['setState'],
  get: StoreApi<ProductionState>['getState'],
) => T;
