import { type Edge } from '@xyflow/react';
import { persist } from 'zustand/middleware';
import { create } from 'zustand/react';

import { type ProductionNode } from './productionStore';

// a named, saved production line
export interface SavedGraph {
  id: string;
  name: string;
  nodes: ProductionNode[];
  edges: Edge[];
}

interface LibraryState {
  graphs: SavedGraph[];
  activeId: string | null; // null when there are no saved lines

  // create an empty line and make it active
  createGraph: () => void;
  // switch the active line
  selectGraph: (id: string) => void;
  renameGraph: (id: string, name: string) => void;
  // remove a line; the list may become empty
  removeGraph: (id: string) => void;
  // write the working graph into the active line (no-op when none is active)
  saveActive: (nodes: ProductionNode[], edges: Edge[]) => void;
}

const newGraph = (name: string): SavedGraph => ({
  id: crypto.randomUUID(),
  name,
  nodes: [],
  edges: [],
});

export const useProductionLibrary = create<LibraryState>()(
  persist(
    (set, get) => {
      return {
        graphs: [],
        activeId: null,

        createGraph: () => {
          const graph = newGraph(`Line ${get().graphs.length + 1}`);
          set({ graphs: [...get().graphs, graph], activeId: graph.id });
        },

        selectGraph: id => set({ activeId: id }),

        renameGraph: (id, name) =>
          set({
            graphs: get().graphs.map(graph =>
              graph.id === id ? { ...graph, name } : graph,
            ),
          }),

        removeGraph: id => {
          const graphs = get().graphs.filter(graph => graph.id !== id);
          // if the active line went away, fall back to the first or none
          const activeId =
            get().activeId === id ? (graphs[0]?.id ?? null) : get().activeId;
          set({ graphs, activeId });
        },

        saveActive: (nodes, edges) => {
          if (get().activeId === null) return;
          set({
            graphs: get().graphs.map(graph =>
              graph.id === get().activeId ? { ...graph, nodes, edges } : graph,
            ),
          });
        },
      };
    },
    { name: 'gtnh-production-library' },
  ),
);

// the currently active saved graph, or undefined when none is selected
export const useActiveGraph = (): SavedGraph | undefined => {
  const graphs = useProductionLibrary(state => state.graphs);
  const activeId = useProductionLibrary(state => state.activeId);
  return graphs.find(graph => graph.id === activeId);
};
