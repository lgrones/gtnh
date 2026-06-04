import {
  type MachineNodeData,
  type ProductionNode,
  type ProductionState,
  type SliceCreator,
} from '../types';

const PASTE_OFFSET = 32;

type ClipboardSlice = Pick<
  ProductionState,
  'clipboard' | 'copySelection' | 'paste'
>;

// copy/paste of the current selection, with fresh ids on paste
export const createClipboardSlice: SliceCreator<ClipboardSlice> = (
  set,
  get,
) => ({
  clipboard: null,

  copySelection: () => {
    const selected = get().nodes.filter(node => node.selected);
    const ids = new Set(selected.map(node => node.id));
    // keep only edges fully inside the copied set
    const edges = get().edges.filter(
      edge => ids.has(edge.source) && ids.has(edge.target),
    );
    set({
      clipboard: {
        nodes: structuredClone(selected),
        edges: structuredClone(edges),
      },
    });
  },

  paste: () => {
    const clip = get().clipboard;
    if (!clip || clip.nodes.length === 0) return;

    const idMap = new Map<string, string>(); // old node id -> new
    const handleMap = new Map<string, string>(); // old output id -> new

    const nodes = clip.nodes.map(node => {
      const newId = crypto.randomUUID();
      idMap.set(node.id, newId);
      const data = structuredClone(node.data);

      // machine output ids double as source handle ids — remap them so
      // pasted edges still resolve to the pasted machine's outputs
      if (node.type === 'machineNode') {
        const machineData = data as MachineNodeData;
        machineData.outputs = machineData.outputs.map(output => {
          const outId = crypto.randomUUID();
          handleMap.set(output.id, outId);
          return { ...output, id: outId };
        });
      }

      return {
        ...node,
        id: newId,
        position: {
          x: node.position.x + PASTE_OFFSET,
          y: node.position.y + PASTE_OFFSET,
        },
        data,
        selected: true,
      } as ProductionNode;
    });

    const edges = clip.edges.map(edge => ({
      ...edge,
      id: crypto.randomUUID(),
      source: idMap.get(edge.source) ?? edge.source,
      target: idMap.get(edge.target) ?? edge.target,
      sourceHandle: edge.sourceHandle
        ? (handleMap.get(edge.sourceHandle) ?? edge.sourceHandle)
        : edge.sourceHandle,
      selected: true,
    }));

    // deselect the originals so only the fresh paste stays selected
    const existing = get().nodes.map(node =>
      node.selected ? { ...node, selected: false } : node,
    );

    set({ nodes: [...existing, ...nodes], edges: [...get().edges, ...edges] });
  },
});
