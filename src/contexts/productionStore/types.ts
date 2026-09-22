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
  | 'byproductNode'
  | 'lineNode';

// every node type someone can drop on the canvas blank. a line node is the one
// exception: it stands for a saved line, so it cannot exist before one is
// picked and is created through `addLineNode` instead
export type PlaceableNodeType = Exclude<ProductionNodeType, 'lineNode'>;

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
  // amount per cycle. fractional on purpose: plenty of GT recipes only produce
  // an output with some chance, and the line's arithmetic wants the average —
  // a 5% bonus slag is written as 0.05. every consumer of this is a
  // multiplication, so a fraction needs no special case beyond a balance
  // tolerance (see `balanceEpsilon`) and formatting (see `formatAmount`)
  quantity: number;
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
export type ByproductNodeData = SinkNodeData;

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

// a machine entry for the alternatives comparison, and for the machine tally a
// collapsed sub-line carries around with it
export interface MachineEntry {
  machine: string;
  quantity: number;
  voltage: VoltageTier;
}

// one voltage bucket of a sub-line's draw, as `demandByTier` reports it. an
// array rather than the Map that function returns, because this one is
// persisted into a node and has to survive JSON
export interface LineTier {
  tier: VoltageTier;
  power: number; // EU/t summed over the machines at this tier
  amps: number; // highest single machine's draw at this tier
}

// one port of a collapsed sub-line: what it takes in, or gives out, over one
// full pass of that line at multiplier 1. Structurally a `RecipeItem`, so the
// balance code treats a sub-line's ports exactly as it treats a recipe's rows
export interface LinePort {
  // `itemKey` of the name, and also the React Flow handle id. Deterministic on
  // purpose: a refresh that re-captures the same item lands on the same handle,
  // so the edges wired to it stay wired
  id: string;
  name: string;
  quantity: number;
}

// what a saved line takes, gives and costs — read off that line's own leaves
// and recipes by `captureLine`. This is the whole contract a collapsed sub-line
// exposes to the graph it sits in; nothing else about the source is carried
// sink (output/byproduct) nodes mirror a recipe output they receive
export const SINK_TYPES = new Set<ProductionNodeType>([
  'outputNode',
  'byproductNode',
]);

export interface LineCapture {
  inputs: LinePort[]; // what its input leaves ask the outside world for
  outputs: LinePort[]; // what its output leaves hand back
  byproducts: LinePort[]; // what its byproduct leaves shed
  machines: MachineEntry[]; // every machine inside it, for the parent's tally
  tiers: LineTier[]; // its draw per voltage tier, for generator sizing
  demand: number; // peak EU/t of the whole sub-line
  time: number; // its critical path, in seconds
  // its slowest single step, in seconds — what a running copy of it turns a
  // pass around in. Optional: captures taken before it was recorded have only
  // the critical path, and readers fall back to that
  bottleneck?: number;
  // recipes inside it missing the EU or the duration. A sub-line with holes in
  // it reports a demand and a time that are short by however much those would
  // have added, and the parent has no way to see that without being told
  incomplete: number;
}

// a whole saved line, collapsed into one node. It holds a CAPTURE rather than a
// live reading of the line it names: the source is edited elsewhere (and by
// other people), and a contract that silently re-plans the graph around it is
// worse than one that says it went out of date. `refreshLineNode` adopts the
// new reading when the user asks for it
export interface LineNodeData extends BaseNodeData {
  graphId: string; // the library graph this node stands for
  multiplier: number; // cycles run in sequence — scales its I/O and its time
  capture: LineCapture; // its I/O + cost, as of the last capture
}

// node typed per variant so data matches the node `type`
export type ProductionNode =
  | Node<InputNodeData, 'inputNode'>
  | Node<OutputNodeData, 'outputNode'>
  | Node<ByproductNodeData, 'byproductNode'>
  | Node<RecipeNodeData, 'recipeNode'>
  | Node<LineNodeData, 'lineNode'>;

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
    type: PlaceableNodeType,
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

  // sub-line nodes (no-op if node is not a line node)
  //
  // drop a saved line in as a single node. The capture is taken by the caller,
  // which is the only side that can reach the library
  addLineNode: (
    graphId: string,
    name: string,
    capture: LineCapture,
    position: { x: number; y: number },
  ) => void;
  // adopt a fresh reading of the source line. Ports that went away take their
  // edges with them; the rest keep theirs, since a port's handle id is derived
  // from its item name
  refreshLineNode: (id: string, name: string, capture: LineCapture) => void;
  // how many copies of the sub-line are built. Scales its I/O and its draw;
  // copies run side by side, so the critical path is unchanged
  setLineMultiplier: (id: string, multiplier: number) => void;
}

// a slice contributes part of the store; it gets the full store's set/get so
// slices can read across each other (e.g. paste reads nodes, sinks read edges)
export type SliceCreator<T> = (
  set: StoreApi<ProductionState>['setState'],
  get: StoreApi<ProductionState>['getState'],
) => T;
