import {
  type ProductionNode,
  type ProductionState,
  type RecipeItem,
  type RecipeNodeData,
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

  paste: position => {
    const clip = get().clipboard;
    if (!clip || clip.nodes.length === 0) return;

    // anchor the paste at the selection's top-left so the cursor lands there;
    // with no position, fall back to a fixed offset from the originals
    const minX = Math.min(...clip.nodes.map(node => node.position.x));
    const minY = Math.min(...clip.nodes.map(node => node.position.y));
    const dx = position ? position.x - minX : PASTE_OFFSET;
    const dy = position ? position.y - minY : PASTE_OFFSET;

    const idMap = new Map<string, string>(); // old node id -> new
    const handleMap = new Map<string, string>(); // old item id -> new handle

    const nodes = clip.nodes.map(node => {
      const newId = crypto.randomUUID();
      idMap.set(node.id, newId);
      const data = structuredClone(node.data);

      // recipe item ids double as handle ids (inputs = target, outputs =
      // source) — remap both so pasted edges still resolve to the new node
      if (node.type === 'recipeNode') {
        const recipeData = data as RecipeNodeData;
        const remap = (item: RecipeItem) => {
          const id = crypto.randomUUID();
          handleMap.set(item.id, id);
          return { ...item, id };
        };
        recipeData.inputs = recipeData.inputs.map(remap);
        recipeData.outputs = recipeData.outputs.map(remap);
      }

      return {
        ...node,
        id: newId,
        position: { x: node.position.x + dx, y: node.position.y + dy },
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
      targetHandle: edge.targetHandle
        ? (handleMap.get(edge.targetHandle) ?? edge.targetHandle)
        : edge.targetHandle,
      selected: true,
    }));

    // deselect the originals so only the fresh paste stays selected
    const existing = get().nodes.map(node =>
      node.selected ? { ...node, selected: false } : node,
    );

    set({ nodes: [...existing, ...nodes], edges: [...get().edges, ...edges] });
  },
});
