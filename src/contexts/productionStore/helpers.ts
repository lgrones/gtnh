import { type Edge } from '@xyflow/react';

import {
  DRAG_HANDLE_CLASS,
  type ProductionNode,
  type ProductionNodeType,
  type RecipeItem,
  type RecipeNodeData,
} from './types';

// collapse a burst of calls into one invocation, fired after the burst ends
// but using the FIRST call's args — zundo's handleSet receives the pre-change
// snapshot, so we must keep the state from before the burst, not after it
export const debounce = <Args extends unknown[]>(
  callback: (...args: Args) => void,
  ms: number,
) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstArgs: Args;

  return (...args: Args) => {
    if (timer === undefined) firstArgs = args;
    else clearTimeout(timer);

    timer = setTimeout(() => {
      timer = undefined;
      callback(...firstArgs);
    }, ms);
  };
};

export const createNode = (
  type: ProductionNodeType,
  position: { x: number; y: number },
): ProductionNode => {
  const base = {
    id: crypto.randomUUID(),
    position,
    dragHandle: `.${DRAG_HANDLE_CLASS}`,
  };

  switch (type) {
    case 'recipeNode':
      return {
        ...base,
        type,
        data: {
          name: 'Recipe',
          machine: '',
          inputs: [],
          outputs: [],
          power: 'electric',
          voltage: 'LV',
          amperage: 1,
          steam: 0,
        },
      };
    case 'inputNode':
      return { ...base, type, data: { name: 'Input', quantity: 0 } };
    case 'outputNode':
      return { ...base, type, data: { name: 'Output', quantity: 0 } };
    case 'disposalNode':
      return { ...base, type, data: { name: 'Disposal', quantity: 0 } };
  }
};

// update data of a single recipe node, leaving other nodes untouched
export const mapRecipe = (
  nodes: ProductionNode[],
  nodeId: string,
  update: (data: RecipeNodeData) => RecipeNodeData,
): ProductionNode[] =>
  nodes.map(node =>
    node.id === nodeId && node.type === 'recipeNode'
      ? { ...node, data: update(node.data) }
      : node,
  );

// sink (output/disposal) nodes mirror a recipe output they receive
export const SINK_TYPES = new Set<ProductionNodeType>([
  'outputNode',
  'disposalNode',
]);

// sync every mirror leaf's name + quantity to its connected recipe item:
//   - sinks (output/disposal) mirror the upstream recipe OUTPUT they receive
//   - input nodes mirror the downstream recipe INPUT they feed
// recipe->recipe edges are left untouched (recipes are the editable source of
// truth); leaves with no connecting edge keep their current values
export const syncMirrors = (
  nodes: ProductionNode[],
  edges: Edge[],
): ProductionNode[] => {
  // `${recipeId}:${itemId}` -> the recipe item, for both inputs and outputs
  const outputs = new Map<string, RecipeItem>();
  const inputs = new Map<string, RecipeItem>();

  for (const node of nodes) {
    if (node.type !== 'recipeNode') continue;
    for (const output of node.data.outputs)
      outputs.set(`${node.id}:${output.id}`, output);
    for (const input of node.data.inputs)
      inputs.set(`${node.id}:${input.id}`, input);
  }

  // leaf node id -> the recipe item it should mirror
  const mirrors = new Map<string, RecipeItem>();

  for (const edge of edges) {
    // sink receiving a recipe output (edge leaves a recipe output handle)
    if (edge.sourceHandle) {
      const output = outputs.get(`${edge.source}:${edge.sourceHandle}`);
      if (output !== undefined) mirrors.set(edge.target, output);
    }
    // input node feeding a recipe input (edge enters a recipe input handle)
    if (edge.targetHandle) {
      const input = inputs.get(`${edge.target}:${edge.targetHandle}`);
      if (input !== undefined) mirrors.set(edge.source, input);
    }
  }

  return nodes.map(node => {
    const item = mirrors.get(node.id);

    return item !== undefined &&
      (SINK_TYPES.has(node.type) || node.type === 'inputNode')
      ? ({
          ...node,
          data: { ...node.data, name: item.name, quantity: item.quantity },
        } as ProductionNode)
      : node;
  });
};
