import { type Edge, type Node, type OnConnect } from '@xyflow/react';
import { type OnEdgesChange, type OnNodesChange } from '@xyflow/react';
import { type StoreApi } from 'zustand';

export type ProductionNodeType =
  | 'inputNode'
  | 'outputNode'
  | 'machineNode'
  | 'disposalNode';

// class on the grip element; React Flow's dragHandle selector targets it (needs leading dot)
export const DRAG_HANDLE_CLASS = 'drag-handle_production';

// one produced item of a machine
export interface MachineOutput {
  id: string; // crypto.randomUUID()
  name: string; // editable item name
  quantity: number; // amount produced per cycle
}

// shared by every node — editable display name
export interface BaseNodeData extends Record<string, unknown> {
  name: string;
}

export interface InputNodeData extends BaseNodeData {
  quantity: number; // amount supplied per cycle
}
// sink name + quantity mirror the connected machine output
export interface SinkNodeData extends BaseNodeData {
  quantity: number;
}
export type OutputNodeData = SinkNodeData;
export type DisposalNodeData = SinkNodeData;
export interface MachineNodeData extends BaseNodeData {
  outputs: MachineOutput[];
}

// node typed per variant so data matches the node `type`
export type ProductionNode =
  | Node<InputNodeData, 'inputNode'>
  | Node<OutputNodeData, 'outputNode'>
  | Node<DisposalNodeData, 'disposalNode'>
  | Node<MachineNodeData, 'machineNode'>;

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
  setInputQuantity: (id: string, quantity: number) => void;

  // machine output edits (no-op if node is not a machine)
  addMachineOutput: (nodeId: string) => void;
  updateMachineOutput: (
    nodeId: string,
    outputId: string,
    patch: Partial<Omit<MachineOutput, 'id'>>,
  ) => void;
  removeMachineOutput: (nodeId: string, outputId: string) => void;
}

// a slice contributes part of the store; it gets the full store's set/get so
// slices can read across each other (e.g. paste reads nodes, sinks read edges)
export type SliceCreator<T> = (
  set: StoreApi<ProductionState>['setState'],
  get: StoreApi<ProductionState>['getState'],
) => T;
