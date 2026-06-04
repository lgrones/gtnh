import { temporal } from 'zundo';
import { useStore } from 'zustand';
import { persist } from 'zustand/middleware';
import { create } from 'zustand/react';
import { useShallow } from 'zustand/react/shallow';

import { debounce } from './helpers';
import { createClipboardSlice } from './slices/clipboard';
import { createGraphSlice } from './slices/graph';
import { createNodeDataSlice } from './slices/nodeData';
import { type ProductionState } from './types';

export type {
  BaseNodeData,
  Clipboard,
  DisposalNodeData,
  InputNodeData,
  MachineNodeData,
  MachineOutput,
  OutputNodeData,
  ProductionNode,
  ProductionNodeType,
  ProductionState,
  SinkNodeData,
} from './types';
export { DRAG_HANDLE_CLASS } from './types';

export const useProductionStore = create<ProductionState>()(
  persist(
    temporal(
      (set, get) => ({
        ...createGraphSlice(set, get),
        ...createNodeDataSlice(set, get),
        ...createClipboardSlice(set, get),

        reset: (nodes = [], edges = []) => {
          set({ nodes, edges });
          // drop history so undo can't reach the previous production line
          useProductionStore.temporal.getState().clear();
        },
      }),
      {
        // only track graph data in history (not handler/action refs)
        partialize: state => ({ nodes: state.nodes, edges: state.edges }),
        // group rapid sets (e.g. a node drag) into a single undo step
        // instead of one entry per pixel of movement
        handleSet: handleSet => debounce(handleSet, 400),
        limit: 100, // cap history depth
      },
    ),
    {
      name: 'gtnh-production-line', // localStorage key
      // persist graph only, not history
      partialize: state => ({ nodes: state.nodes, edges: state.edges }),
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
      addMachineOutput: state.addMachineOutput,
      updateMachineOutput: state.updateMachineOutput,
      removeMachineOutput: state.removeMachineOutput,
      copySelection: state.copySelection,
      paste: state.paste,
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
