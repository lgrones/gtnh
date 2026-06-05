import { type Connection, type Edge } from '@xyflow/react';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';

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
          multiplier: 1,
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

// backfill fields added after some graphs were already persisted — `multiplier`
// is absent from recipe nodes saved before it existed; default it to 1 on load
export const normalizeNodes = (nodes: ProductionNode[]): ProductionNode[] =>
  nodes.map(node => {
    if (node.type !== 'recipeNode') return node;
    const data = node.data as Omit<RecipeNodeData, 'multiplier'> & {
      multiplier?: number;
    };
    return data.multiplier === undefined
      ? { ...node, data: { ...node.data, multiplier: 1 } }
      : node;
  });

// fallback node size when React Flow hasn't measured a node yet
const DEFAULT_NODE_SIZE = { width: 280, height: 160 };

const elk = new ELK();

// arrange the graph into left-to-right layers with ELK. recipe input/output
// handles become fixed-order ports (inputs WEST, outputs EAST) so ELK orders
// nodes to keep edges aligned with each recipe's row order — minimal crossings.
// uses measured sizes (falls back to a default); ELK returns top-left positions
export const layoutNodes = async (
  nodes: ProductionNode[],
  edges: Edge[],
): Promise<ProductionNode[]> => {
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '96',
      'elk.spacing.nodeNode': '32',
    },
    children: nodes.map(node => {
      const base = {
        id: node.id,
        width: node.measured?.width ?? DEFAULT_NODE_SIZE.width,
        height: node.measured?.height ?? DEFAULT_NODE_SIZE.height,
      };
      if (node.type !== 'recipeNode') return base;

      // ELK numbers ports clockwise: WEST runs bottom->top (invert the row
      // index), EAST runs top->bottom (row index as-is)
      const ports = [
        ...node.data.inputs.map((input, i) => ({
          id: input.id,
          layoutOptions: {
            'elk.port.side': 'WEST',
            'elk.port.index': String(node.data.inputs.length - 1 - i),
          },
        })),
        ...node.data.outputs.map((output, i) => ({
          id: output.id,
          layoutOptions: {
            'elk.port.side': 'EAST',
            'elk.port.index': String(i),
          },
        })),
      ];
      return {
        ...base,
        ports,
        layoutOptions: { 'elk.portConstraints': 'FIXED_ORDER' },
      };
    }),
    edges: edges.map(edge => ({
      id: edge.id,
      sources: [edge.sourceHandle ?? edge.source],
      targets: [edge.targetHandle ?? edge.target],
    })),
  };

  const laid = await elk.layout(graph);
  const positions = new Map(laid.children?.map(child => [child.id, child]));

  return nodes.map(node => {
    const child = positions.get(node.id);
    return child
      ? { ...node, position: { x: child.x ?? 0, y: child.y ?? 0 } }
      : node;
  });
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

// `${recipeId}:${itemId}` -> recipe item, indexed for both inputs and outputs,
// plus each recipe's run multiplier keyed by node id
interface ItemIndex {
  outputs: Map<string, RecipeItem>;
  inputs: Map<string, RecipeItem>;
  multipliers: Map<string, number>;
}

const indexRecipeItems = (nodes: ProductionNode[]): ItemIndex => {
  const outputs = new Map<string, RecipeItem>();
  const inputs = new Map<string, RecipeItem>();
  const multipliers = new Map<string, number>();

  for (const node of nodes) {
    if (node.type !== 'recipeNode') continue;
    multipliers.set(node.id, node.data.multiplier);
    for (const output of node.data.outputs)
      outputs.set(`${node.id}:${output.id}`, output);
    for (const input of node.data.inputs)
      inputs.set(`${node.id}:${input.id}`, input);
  }

  return { outputs, inputs, multipliers };
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
    // scale by the consuming recipe's run count
    const runs = index.multipliers.get(edge.target) ?? 1;
    const key = `${edge.source}:${edge.sourceHandle}`;
    demand.set(key, (demand.get(key) ?? 0) + input.quantity * runs);
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
      if (output !== undefined) {
        const supply =
          output.quantity * (index.multipliers.get(edge.source) ?? 1);
        mirrors.set(edge.target, {
          name: output.name,
          quantity:
            supply - (demand.get(`${edge.source}:${edge.sourceHandle}`) ?? 0),
        });
      }
    }
    // input node feeding a recipe input (edge enters a recipe input handle)
    if (edge.targetHandle) {
      const input = recipeItem(index, edge.target, edge.targetHandle, 'inputs');
      if (input !== undefined)
        mirrors.set(edge.source, {
          name: input.name,
          quantity: input.quantity * (index.multipliers.get(edge.target) ?? 1),
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
      // produced over all runs of this recipe
      const supply = output.quantity * node.data.multiplier;

      if (needed > supply)
        // deficit — blame each receiving recipe
        for (const recipeId of receivers.get(key) ?? [])
          issues.push({
            recipe: names.get(recipeId) ?? '',
            item: output.name,
            kind: 'deficit',
            supply,
            demand: needed,
          });
      else if (!absorbed.has(key) && supply - needed > 0)
        // leftover with nowhere to go (no sink); includes unconnected outputs
        issues.push({
          recipe: node.data.name,
          item: output.name,
          kind: 'surplus',
          supply,
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
