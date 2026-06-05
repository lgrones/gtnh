import { type Connection, type Edge } from '@xyflow/react';

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

// project a graph onto the fields that matter for undo/redo. React Flow mutates
// nodes with volatile churn (measured size, selection, drag flags) on its own —
// tracking those would flood history and, worse, wipe the redo stack on every
// re-measure. compare only id/type/position/data + edge endpoints.
const historyKey = (nodes: ProductionNode[], edges: Edge[]): string =>
  JSON.stringify({
    nodes: nodes.map(node => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: node.data,
    })),
    edges: edges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    })),
  });

// zundo `equality`: true => skip this set (no history push, redo stack kept)
export const sameHistoryState = (
  a: { nodes: ProductionNode[]; edges: Edge[] },
  b: { nodes: ProductionNode[]; edges: Edge[] },
): boolean => historyKey(a.nodes, a.edges) === historyKey(b.nodes, b.edges);

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

// `${recipeId}:${itemId}` -> recipe item, indexed for both inputs and outputs
interface ItemIndex {
  outputs: Map<string, RecipeItem>;
  inputs: Map<string, RecipeItem>;
}

const indexRecipeItems = (nodes: ProductionNode[]): ItemIndex => {
  const outputs = new Map<string, RecipeItem>();
  const inputs = new Map<string, RecipeItem>();

  for (const node of nodes) {
    if (node.type !== 'recipeNode') continue;
    for (const output of node.data.outputs)
      outputs.set(`${node.id}:${output.id}`, output);
    for (const input of node.data.inputs)
      inputs.set(`${node.id}:${input.id}`, input);
  }

  return { outputs, inputs };
};

// look up a recipe item by node + handle id; undefined for leaf nodes /
// missing handles (handle id === recipe item id, see recipeNode.tsx)
const recipeItem = (
  index: ItemIndex,
  nodeId: string,
  handleId: string,
  kind: 'inputs' | 'outputs',
): RecipeItem | undefined => index[kind].get(`${nodeId}:${handleId}`);

// per recipe-output handle, Σ quantity demanded by the downstream recipe inputs
// it feeds (sinks are not demand — they take the leftover). keyed `${src}:${h}`
const demandByOutput = (
  index: ItemIndex,
  edges: Edge[],
): Map<string, number> => {
  const demand = new Map<string, number>();

  for (const edge of edges) {
    if (!edge.sourceHandle || !edge.targetHandle) continue;
    const input = recipeItem(index, edge.target, edge.targetHandle, 'inputs');
    if (input === undefined) continue;
    const key = `${edge.source}:${edge.sourceHandle}`;
    demand.set(key, (demand.get(key) ?? 0) + input.quantity);
  }

  return demand;
};

// a connection is valid unless it joins two recipe items whose names disagree.
// leaf connections (input-node -> recipe, recipe -> sink) always mirror, so are
// always allowed. names compared case-insensitively, trimmed; empty can't match
export const isValidConnection = (
  nodes: ProductionNode[],
  connection: Connection | Edge,
): boolean => {
  const index = indexRecipeItems(nodes);
  const output =
    connection.sourceHandle &&
    recipeItem(index, connection.source, connection.sourceHandle, 'outputs');
  const input =
    connection.targetHandle &&
    recipeItem(index, connection.target, connection.targetHandle, 'inputs');

  // at least one side is a leaf handle -> allow
  if (!output || !input) return true;

  const a = output.name.trim().toLowerCase();
  const b = input.name.trim().toLowerCase();
  return a !== '' && a === b;
};

// sync every mirror leaf's name + quantity to its connected recipe item:
//   - sinks (output/disposal) mirror the upstream recipe OUTPUT they receive,
//     but only the leftover quantity after downstream recipes take their share
//     (may go negative -> visible over-draw warning)
//   - input nodes mirror the downstream recipe INPUT they feed
// recipe->recipe edges are left untouched (recipes are the editable source of
// truth); leaves with no connecting edge keep their current values
export const syncMirrors = (
  nodes: ProductionNode[],
  edges: Edge[],
): ProductionNode[] => {
  const index = indexRecipeItems(nodes);
  const demand = demandByOutput(index, edges);

  // leaf node id -> the name + quantity it should display
  const mirrors = new Map<string, { name: string; quantity: number }>();

  for (const edge of edges) {
    // sink receiving a recipe output (edge leaves a recipe output handle)
    if (edge.sourceHandle) {
      const output = recipeItem(
        index,
        edge.source,
        edge.sourceHandle,
        'outputs',
      );
      if (output !== undefined)
        mirrors.set(edge.target, {
          name: output.name,
          quantity:
            output.quantity -
            (demand.get(`${edge.source}:${edge.sourceHandle}`) ?? 0),
        });
    }
    // input node feeding a recipe input (edge enters a recipe input handle)
    if (edge.targetHandle) {
      const input = recipeItem(index, edge.target, edge.targetHandle, 'inputs');
      if (input !== undefined)
        mirrors.set(edge.source, {
          name: input.name,
          quantity: input.quantity,
        });
    }
  }

  return nodes.map(node => {
    const mirror = mirrors.get(node.id);

    return mirror !== undefined &&
      (SINK_TYPES.has(node.type) || node.type === 'inputNode')
      ? ({
          ...node,
          data: { ...node.data, name: mirror.name, quantity: mirror.quantity },
        } as ProductionNode)
      : node;
  });
};

// a balance problem found by validateGraph (run on demand, not while editing)
export interface GraphIssue {
  recipe: string; // recipe node display name (receiver for deficit, else owner)
  item: string; // item name
  kind: 'deficit' | 'surplus' | 'unfed';
  supply?: number; // deficit/surplus — the output's quantity
  demand?: number; // deficit/surplus — total downstream recipe demand
}

// check quantity balance between recipes:
//   - deficit: a recipe output feeds downstream recipes that demand more than
//     it produces (reported against each RECEIVING recipe)
//   - surplus: a recipe output has leftover quantity (incl. fully unconnected)
//     with no sink to absorb it
//   - unfed: a recipe input has no incoming edge (no source at all)
export const validateGraph = (
  nodes: ProductionNode[],
  edges: Edge[],
): GraphIssue[] => {
  const index = indexRecipeItems(nodes);
  const demand = demandByOutput(index, edges);
  const issues: GraphIssue[] = [];

  const names = new Map(nodes.map(node => [node.id, node.data.name]));
  const sinkIds = new Set(
    nodes.filter(node => SINK_TYPES.has(node.type)).map(node => node.id),
  );

  // recipe input handles with an incoming edge
  const fed = new Set<string>();
  // output handle keys absorbed by a sink (leftover handled)
  const absorbed = new Set<string>();
  // output handle key -> ids of the recipes it feeds
  const receivers = new Map<string, Set<string>>();

  for (const edge of edges) {
    if (edge.targetHandle) fed.add(`${edge.target}:${edge.targetHandle}`);
    if (!edge.sourceHandle) continue;
    const key = `${edge.source}:${edge.sourceHandle}`;
    if (sinkIds.has(edge.target)) absorbed.add(key);
    if (
      edge.targetHandle &&
      recipeItem(index, edge.target, edge.targetHandle, 'inputs') !== undefined
    ) {
      let set = receivers.get(key);
      if (set === undefined) receivers.set(key, (set = new Set()));
      set.add(edge.target);
    }
  }

  for (const node of nodes) {
    if (node.type !== 'recipeNode') continue;

    for (const output of node.data.outputs) {
      const key = `${node.id}:${output.id}`;
      const needed = demand.get(key) ?? 0;

      if (needed > output.quantity)
        // deficit — blame each receiving recipe
        for (const recipeId of receivers.get(key) ?? [])
          issues.push({
            recipe: names.get(recipeId) ?? '',
            item: output.name,
            kind: 'deficit',
            supply: output.quantity,
            demand: needed,
          });
      else if (!absorbed.has(key) && output.quantity - needed > 0)
        // leftover with nowhere to go (no sink); includes unconnected outputs
        issues.push({
          recipe: node.data.name,
          item: output.name,
          kind: 'surplus',
          supply: output.quantity,
          demand: needed,
        });
    }

    for (const input of node.data.inputs)
      if (!fed.has(`${node.id}:${input.id}`))
        issues.push({
          recipe: node.data.name,
          item: input.name,
          kind: 'unfed',
        });
  }

  return issues;
};
