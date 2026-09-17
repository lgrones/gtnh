import type { Edge } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { overclock } from '@/domain/overclock';

import {
  itemPerPass,
  itemRate,
  layoutNodes,
  lineEnergy,
  machineAmps,
  machineTier,
  normalizeNodes,
  lineFlow,
  lineMetrics,
  meLedger,
  starvation,
  demandByTier,
  recipePower,
  useProductionStore,
  validateGraph,
  type LedgerEntry,
  type RecipeNodeData,
  type SinkNodeData,
  type ProductionNode,
  type ProductionNodeType,
} from './productionStore';

const store = useProductionStore;
const state = () => store.getState();

// add a node and return its generated id
const addNode = (type: ProductionNodeType, x = 0, y = 0) => {
  state().addNode(type, { x, y });
  const nodes = state().nodes;
  return nodes[nodes.length - 1]!.id;
};

const recipeData = (id: string) =>
  state().nodes.find(n => n.id === id)!.data as RecipeNodeData;

// add a recipe output, returning its generated id
const addOutput = (recipe: string) => {
  state().addRecipeOutput(recipe);
  const outputs = recipeData(recipe).outputs;
  return outputs[outputs.length - 1]!.id;
};

// add a recipe input, returning its generated id
const addInput = (recipe: string) => {
  state().addRecipeInput(recipe);
  const inputs = recipeData(recipe).inputs;
  return inputs[inputs.length - 1]!.id;
};

// fill the fields validateGraph's `incomplete` check requires (name defaults to
// a non-empty value already), so balance-only tests stay clean
const completeRecipe = (recipe: string) =>
  state().updateRecipe(recipe, { eu: 30, time: 5 });

beforeEach(() => {
  vi.useFakeTimers();
  store.setState({ nodes: [], edges: [], generator: null, meMode: false });
  vi.runAllTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('addNode', () => {
  it('appends an input node with default data', () => {
    addNode('inputNode');
    expect(state().nodes).toHaveLength(1);
    const node = state().nodes[0]!;
    expect(node.type).toBe('inputNode');
    expect(node.data.name).toBe('Input');
  });

  it('appends a recipe node with empty item lists and energy defaults', () => {
    const id = addNode('recipeNode');
    const data = recipeData(id);
    expect(data.inputs).toEqual([]);
    expect(data.outputs).toEqual([]);
    expect(data).toMatchObject({
      machine: '',
      voltage: 'LV',
      amperage: 1,
      multiplier: 1,
      eu: 0,
      time: 0,
    });
  });

  it('gives each node a unique id', () => {
    addNode('inputNode');
    addNode('outputNode');
    const [a, b] = state().nodes;
    expect(a!.id).not.toBe(b!.id);
  });
});

describe('removeNode', () => {
  it('removes the node and any connected edges', () => {
    const a = addNode('recipeNode');
    const b = addNode('recipeNode');
    store.setState({ edges: [{ id: 'e1', source: a, target: b }] as Edge[] });

    state().removeNode(a);

    expect(state().nodes.map(n => n.id)).toEqual([b]);
    expect(state().edges).toHaveLength(0);
  });
});

describe('renameNode', () => {
  it('updates the node name', () => {
    const id = addNode('recipeNode');
    state().renameNode(id, 'Macerator');
    expect(state().nodes[0]!.data.name).toBe('Macerator');
  });

  it('leaves other nodes untouched', () => {
    const a = addNode('recipeNode');
    const b = addNode('outputNode');
    state().renameNode(a, 'Renamed');
    expect(state().nodes.find(n => n.id === b)!.data.name).toBe('Output');
  });
});

describe('updateRecipe', () => {
  it('patches scalar recipe fields', () => {
    const id = addNode('recipeNode');
    state().updateRecipe(id, { machine: 'EBF', voltage: 'EV', amperage: 4 });
    expect(recipeData(id)).toMatchObject({
      machine: 'EBF',
      voltage: 'EV',
      amperage: 4,
    });
  });

  it('is a no-op on a non-recipe node', () => {
    const id = addNode('inputNode');
    state().updateRecipe(id, { machine: 'EBF' });
    expect('machine' in state().nodes[0]!.data).toBe(false);
  });
});

describe('recipe outputs', () => {
  it('adds an output with sensible defaults', () => {
    const id = addNode('recipeNode');
    state().addRecipeOutput(id);
    expect(recipeData(id).outputs).toHaveLength(1);
    expect(recipeData(id).outputs[0]).toMatchObject({ name: '', quantity: 1 });
  });

  it('updates an existing output', () => {
    const id = addNode('recipeNode');
    const outputId = addOutput(id);
    state().updateRecipeOutput(id, outputId, { name: 'Slag', quantity: 4 });
    expect(recipeData(id).outputs[0]).toMatchObject({
      name: 'Slag',
      quantity: 4,
    });
  });

  it('removes an output', () => {
    const id = addNode('recipeNode');
    const outputId = addOutput(id);
    state().removeRecipeOutput(id, outputId);
    expect(recipeData(id).outputs).toHaveLength(0);
  });

  it('is a no-op on a non-recipe node', () => {
    const id = addNode('inputNode');
    state().addRecipeOutput(id);
    const node = state().nodes[0]!;
    expect(node.type).toBe('inputNode');
    expect('outputs' in node.data).toBe(false);
  });
});

describe('recipe inputs', () => {
  it('adds an input with sensible defaults', () => {
    const id = addNode('recipeNode');
    state().addRecipeInput(id);
    expect(recipeData(id).inputs).toHaveLength(1);
    expect(recipeData(id).inputs[0]).toMatchObject({ name: '', quantity: 1 });
  });

  it('updates an existing input', () => {
    const id = addNode('recipeNode');
    const inputId = addInput(id);
    state().updateRecipeInput(id, inputId, { name: 'Iron Ore', quantity: 2 });
    expect(recipeData(id).inputs[0]).toMatchObject({
      name: 'Iron Ore',
      quantity: 2,
    });
  });

  it('removes an input', () => {
    const id = addNode('recipeNode');
    const inputId = addInput(id);
    state().removeRecipeInput(id, inputId);
    expect(recipeData(id).inputs).toHaveLength(0);
  });
});

describe('onConnect', () => {
  it('adds an animated edge', () => {
    const a = addNode('recipeNode');
    const b = addNode('recipeNode');
    state().onConnect({
      source: a,
      target: b,
      sourceHandle: null,
      targetHandle: null,
    });
    expect(state().edges).toHaveLength(1);
    expect(state().edges[0]!.animated).toBe(true);
  });
});

describe('onReconnect', () => {
  // wire input-leaf -> recipe A, returning the edge plus a second recipe B
  const setup = () => {
    const input = addNode('inputNode');
    const a = addNode('recipeNode');
    const aIn = addInput(a);
    const b = addNode('recipeNode');
    const bIn = addInput(b);
    state().onConnect({
      source: input,
      target: a,
      sourceHandle: null,
      targetHandle: aIn,
    });
    const edge = state().edges[0]!;
    return { input, a, aIn, b, bIn, edge };
  };

  it('moves an edge endpoint, keeping the same edge id', () => {
    const { input, b, bIn, edge } = setup();
    state().onReconnect(edge, {
      source: input,
      target: b,
      sourceHandle: null,
      targetHandle: bIn,
    });

    expect(state().edges).toHaveLength(1);
    expect(state().edges[0]!.id).toBe(edge.id);
    expect(state().edges[0]!.target).toBe(b);
  });

  it('leaves the edge untouched on an invalid reconnection', () => {
    const { a, aIn, b, edge } = setup();
    // two recipe items with disagreeing (empty) names -> invalid
    const bOut = addOutput(b);
    state().updateRecipeOutput(b, bOut, { name: 'Ore' });
    state().updateRecipeInput(a, aIn, { name: 'Plate' });

    state().onReconnect(edge, {
      source: b,
      target: a,
      sourceHandle: bOut,
      targetHandle: aIn,
    });

    expect(state().edges[0]!.source).toBe(edge.source);
    expect(state().edges[0]!.target).toBe(edge.target);
  });

  it('evicts an edge already in the target sink slot on reconnect', () => {
    const recipe = addNode('recipeNode');
    const out1 = addOutput(recipe);
    const out2 = addOutput(recipe);
    state().updateRecipeOutput(recipe, out1, { name: 'A' });
    state().updateRecipeOutput(recipe, out2, { name: 'B' });
    const sink = addNode('outputNode');

    // sink fed by out1
    state().onConnect({
      source: recipe,
      target: sink,
      sourceHandle: out1,
      targetHandle: null,
    });
    // a second edge out2 -> different sink, then reconnect it onto the busy sink
    const sink2 = addNode('disposalNode');
    state().onConnect({
      source: recipe,
      target: sink2,
      sourceHandle: out2,
      targetHandle: null,
    });
    const moving = state().edges.find(e => e.target === sink2)!;

    state().onReconnect(moving, {
      source: recipe,
      target: sink,
      sourceHandle: out2,
      targetHandle: null,
    });

    // the old out1 edge was evicted; only the reconnected edge feeds the sink
    const toSink = state().edges.filter(e => e.target === sink);
    expect(toSink).toHaveLength(1);
    expect(toSink[0]!.id).toBe(moving.id);
  });
});

describe('mirror sync — recipe output -> sink', () => {
  // wire a recipe output handle to a sink node
  const wire = (sinkType: ProductionNodeType) => {
    const recipe = addNode('recipeNode');
    const outputId = addOutput(recipe);
    state().updateRecipeOutput(recipe, outputId, {
      name: 'Iron Plate',
      quantity: 4,
    });
    const sink = addNode(sinkType);
    state().onConnect({
      source: recipe,
      target: sink,
      sourceHandle: outputId,
      targetHandle: null,
    });
    return { recipe, outputId, sink };
  };

  it('mirrors name + quantity onto an output node on connect', () => {
    const { sink } = wire('outputNode');
    const data = state().nodes.find(n => n.id === sink)!.data as SinkNodeData;
    expect(data).toMatchObject({ name: 'Iron Plate', quantity: 4 });
  });

  it('mirrors onto a disposal node on connect too', () => {
    const { sink } = wire('disposalNode');
    const data = state().nodes.find(n => n.id === sink)!.data as SinkNodeData;
    expect(data).toMatchObject({ name: 'Iron Plate', quantity: 4 });
  });

  it('propagates a later quantity edit to the connected sink', () => {
    const { recipe, outputId, sink } = wire('outputNode');
    state().updateRecipeOutput(recipe, outputId, { quantity: 9 });
    const data = state().nodes.find(n => n.id === sink)!.data as SinkNodeData;
    expect(data.quantity).toBe(9);
  });

  it('drops the dangling edge when the source output is removed', () => {
    const { recipe, outputId } = wire('outputNode');
    state().removeRecipeOutput(recipe, outputId);
    expect(state().edges).toHaveLength(0);
  });

  it('lets a sink hold only one input — a new connection replaces the old', () => {
    const r1 = addNode('recipeNode');
    const o1 = addOutput(r1);
    const r2 = addNode('recipeNode');
    const o2 = addOutput(r2);
    const sink = addNode('outputNode');

    state().onConnect({
      source: r1,
      target: sink,
      sourceHandle: o1,
      targetHandle: null,
    });
    state().onConnect({
      source: r2,
      target: sink,
      sourceHandle: o2,
      targetHandle: null,
    });

    const incoming = state().edges.filter(e => e.target === sink);
    expect(incoming).toHaveLength(1);
    expect(incoming[0]!.source).toBe(r2);
  });

  it('mirrors an unnamed output as-is (empty name, quantity 1)', () => {
    const recipe = addNode('recipeNode');
    const outputId = addOutput(recipe);
    const sink = addNode('outputNode');
    state().onConnect({
      source: recipe,
      target: sink,
      sourceHandle: outputId,
      targetHandle: null,
    });
    const data = state().nodes.find(n => n.id === sink)!.data as SinkNodeData;
    expect(data).toMatchObject({ name: '', quantity: 1 });
  });
});

describe('mirror sync — input node -> recipe input', () => {
  // wire an input leaf to a recipe input handle (reverse direction)
  const wire = () => {
    const recipe = addNode('recipeNode');
    const inputId = addInput(recipe);
    state().updateRecipeInput(recipe, inputId, {
      name: 'Iron Ore',
      quantity: 3,
    });
    const input = addNode('inputNode');
    state().onConnect({
      source: input,
      target: recipe,
      sourceHandle: null,
      targetHandle: inputId,
    });
    return { recipe, inputId, input };
  };

  it('mirrors name + quantity onto the input node on connect', () => {
    const { input } = wire();
    const data = state().nodes.find(n => n.id === input)!.data as SinkNodeData;
    expect(data).toMatchObject({ name: 'Iron Ore', quantity: 3 });
  });

  it('propagates a later input edit to the connected input node', () => {
    const { recipe, inputId, input } = wire();
    state().updateRecipeInput(recipe, inputId, { quantity: 8 });
    const data = state().nodes.find(n => n.id === input)!.data as SinkNodeData;
    expect(data.quantity).toBe(8);
  });

  it('drops the dangling edge when the recipe input is removed', () => {
    const { recipe, inputId } = wire();
    state().removeRecipeInput(recipe, inputId);
    expect(state().edges).toHaveLength(0);
  });

  it('lets an input leaf feed only one recipe input — new connection replaces', () => {
    const input = addNode('inputNode');
    const r1 = addNode('recipeNode');
    const i1 = addInput(r1);
    const r2 = addNode('recipeNode');
    const i2 = addInput(r2);

    state().onConnect({
      source: input,
      target: r1,
      sourceHandle: null,
      targetHandle: i1,
    });
    state().onConnect({
      source: input,
      target: r2,
      sourceHandle: null,
      targetHandle: i2,
    });

    const outgoing = state().edges.filter(e => e.source === input);
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0]!.target).toBe(r2);
  });
});

describe('mirror sync — recipe -> recipe', () => {
  it('leaves both recipes untouched on a direct chain', () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Ore', quantity: 2 });
    const b = addNode('recipeNode');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'Ore', quantity: 1 });

    state().onConnect({
      source: a,
      target: b,
      sourceHandle: outId,
      targetHandle: inId,
    });

    expect(recipeData(a).outputs[0]).toMatchObject({
      name: 'Ore',
      quantity: 2,
    });
    expect(recipeData(b).inputs[0]).toMatchObject({ name: 'Ore', quantity: 1 });
    expect(state().edges).toHaveLength(1);
  });
});

describe('isValidConnection', () => {
  const recipePair = (outName: string, inName: string) => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: outName });
    const b = addNode('recipeNode');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: inName });
    return { a, b, outId, inId };
  };

  it('allows a recipe->recipe edge when names match (case/space-insensitive)', () => {
    const { a, b, outId, inId } = recipePair('Iron Ore', '  iron ore ');
    expect(
      state().isValidConnection({
        source: a,
        target: b,
        sourceHandle: outId,
        targetHandle: inId,
      }),
    ).toBe(true);
  });

  it('rejects a recipe->recipe edge when names differ', () => {
    const { a, b, outId, inId } = recipePair('Iron Ore', 'Copper Ore');
    expect(
      state().isValidConnection({
        source: a,
        target: b,
        sourceHandle: outId,
        targetHandle: inId,
      }),
    ).toBe(false);
  });

  it('rejects a recipe->recipe edge when both names are empty', () => {
    const { a, b, outId, inId } = recipePair('', '');
    expect(
      state().isValidConnection({
        source: a,
        target: b,
        sourceHandle: outId,
        targetHandle: inId,
      }),
    ).toBe(false);
  });

  it('always allows leaf connections (recipe->sink, input->recipe)', () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Ore' });
    const sink = addNode('outputNode');
    const input = addNode('inputNode');
    const b = addNode('recipeNode');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'Ore' });

    expect(
      state().isValidConnection({
        source: a,
        target: sink,
        sourceHandle: outId,
        targetHandle: null,
      }),
    ).toBe(true);
    expect(
      state().isValidConnection({
        source: input,
        target: b,
        sourceHandle: null,
        targetHandle: inId,
      }),
    ).toBe(true);
  });

  it('onConnect adds no edge for a name-mismatched recipe->recipe drop', () => {
    const { a, b, outId, inId } = recipePair('Iron Ore', 'Copper Ore');
    state().onConnect({
      source: a,
      target: b,
      sourceHandle: outId,
      targetHandle: inId,
    });
    expect(state().edges).toHaveLength(0);
  });
});

describe('sink remainder', () => {
  const sinkData = (id: string) =>
    state().nodes.find(n => n.id === id)!.data as SinkNodeData;

  it('shows the leftover after downstream recipes take their share', () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Ore', quantity: 10 });
    const b = addNode('recipeNode');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'Ore', quantity: 4 });
    const sink = addNode('outputNode');

    state().onConnect({
      source: a,
      target: b,
      sourceHandle: outId,
      targetHandle: inId,
    });
    state().onConnect({
      source: a,
      target: sink,
      sourceHandle: outId,
      targetHandle: null,
    });

    expect(sinkData(sink).quantity).toBe(6);
  });

  it('goes negative when downstream demand exceeds supply', () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Ore', quantity: 10 });
    const b = addNode('recipeNode');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'Ore', quantity: 4 });
    const sink = addNode('outputNode');

    state().onConnect({
      source: a,
      target: b,
      sourceHandle: outId,
      targetHandle: inId,
    });
    state().onConnect({
      source: a,
      target: sink,
      sourceHandle: outId,
      targetHandle: null,
    });

    state().updateRecipeInput(b, inId, { quantity: 12 });
    expect(sinkData(sink).quantity).toBe(-2);
  });
});

describe('validateGraph', () => {
  it('reports a deficit against the receiving recipe', () => {
    const a = addNode('recipeNode');
    state().renameNode(a, 'Producer');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Ore', quantity: 5 });
    const b = addNode('recipeNode');
    state().renameNode(b, 'Receiver');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'Ore', quantity: 8 });
    state().onConnect({
      source: a,
      target: b,
      sourceHandle: outId,
      targetHandle: inId,
    });

    const issues = validateGraph(state().nodes, state().edges);
    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: 'deficit',
        recipe: 'Receiver',
        item: 'Ore',
        demand: 8,
        supply: 5,
      }),
    );
  });

  it('is clean when supply meets demand and every input is fed', () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Ore', quantity: 8 });
    const b = addNode('recipeNode');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'Ore', quantity: 8 });
    state().onConnect({
      source: a,
      target: b,
      sourceHandle: outId,
      targetHandle: inId,
    });
    completeRecipe(a);
    completeRecipe(b);

    expect(validateGraph(state().nodes, state().edges)).toEqual([]);
  });

  it('flags a fully unconnected output as surplus', () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Ore', quantity: 5 });

    expect(validateGraph(state().nodes, state().edges)).toContainEqual(
      expect.objectContaining({
        kind: 'surplus',
        item: 'Ore',
        supply: 5,
        demand: 0,
      }),
    );
  });

  it('flags an output only partly consumed with no sink as surplus', () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Ore', quantity: 10 });
    const b = addNode('recipeNode');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'Ore', quantity: 4 });
    state().onConnect({
      source: a,
      target: b,
      sourceHandle: outId,
      targetHandle: inId,
    });

    expect(validateGraph(state().nodes, state().edges)).toContainEqual(
      expect.objectContaining({
        kind: 'surplus',
        item: 'Ore',
        supply: 10,
        demand: 4,
      }),
    );
  });

  it('does not flag surplus when a sink absorbs the leftover', () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Ore', quantity: 10 });
    const b = addNode('recipeNode');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'Ore', quantity: 4 });
    const sink = addNode('outputNode');
    state().onConnect({
      source: a,
      target: b,
      sourceHandle: outId,
      targetHandle: inId,
    });
    state().onConnect({
      source: a,
      target: sink,
      sourceHandle: outId,
      targetHandle: null,
    });

    expect(
      validateGraph(state().nodes, state().edges).filter(
        i => i.kind === 'surplus',
      ),
    ).toEqual([]);
  });

  it('reports an unfed recipe input with no incoming edge', () => {
    const b = addNode('recipeNode');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'Ore', quantity: 4 });

    expect(validateGraph(state().nodes, state().edges)).toContainEqual(
      expect.objectContaining({ kind: 'unfed', item: 'Ore' }),
    );
  });

  it('does not flag an input fed by an input node', () => {
    const input = addNode('inputNode');
    const b = addNode('recipeNode');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'Ore', quantity: 4 });
    state().onConnect({
      source: input,
      target: b,
      sourceHandle: null,
      targetHandle: inId,
    });

    expect(
      validateGraph(state().nodes, state().edges).filter(
        i => i.kind === 'unfed',
      ),
    ).toEqual([]);
  });
});

describe('validateGraph — incomplete recipe fields', () => {
  it('flags a recipe missing energy and duration', () => {
    const id = addNode('recipeNode'); // defaults: eu 0, time 0, name "Recipe"
    const issues = validateGraph(state().nodes, state().edges);

    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'incomplete', item: 'energy (EU)' }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'incomplete', item: 'duration' }),
    );
    // name defaults to "Recipe", so no name issue
    expect(issues.some(i => i.kind === 'incomplete' && i.item === 'name')).toBe(
      false,
    );
    expect(recipeData(id).name).toBe('Recipe');
  });

  it('flags a blank recipe name and labels the issue "Unnamed recipe"', () => {
    const id = addNode('recipeNode');
    state().renameNode(id, '   ');
    completeRecipe(id);

    expect(validateGraph(state().nodes, state().edges)).toContainEqual(
      expect.objectContaining({
        kind: 'incomplete',
        item: 'name',
        recipe: 'Unnamed recipe',
      }),
    );
  });

  it('raises no incomplete issue once name, energy and duration are set', () => {
    const id = addNode('recipeNode');
    state().renameNode(id, 'Smelter');
    completeRecipe(id);

    expect(
      validateGraph(state().nodes, state().edges).filter(
        i => i.kind === 'incomplete',
      ),
    ).toEqual([]);
  });
});

describe('validateGraph — renamed recipe link', () => {
  // wire output "Ore" -> input "Ore" between two recipes, return their ids + handles
  const wireMatched = () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Ore', quantity: 4 });
    const b = addNode('recipeNode');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'Ore', quantity: 4 });
    state().onConnect({
      source: a,
      target: b,
      sourceHandle: outId,
      targetHandle: inId,
    });
    return { a, outId, b, inId };
  };

  it('keeps the edge when a renamed input no longer matches', () => {
    const { inId, b } = wireMatched();
    state().updateRecipeInput(b, inId, { name: 'Dust' });
    // edge is NOT yanked mid-edit
    expect(state().edges).toHaveLength(1);
  });

  it('flags the now-disagreeing edge as a mismatch', () => {
    const { inId, b } = wireMatched();
    state().updateRecipeInput(b, inId, { name: 'Dust' });

    expect(validateGraph(state().nodes, state().edges)).toContainEqual(
      expect.objectContaining({ kind: 'mismatch' }),
    );
  });

  it('raises no mismatch while the names still agree', () => {
    wireMatched();
    expect(
      validateGraph(state().nodes, state().edges).some(
        i => i.kind === 'mismatch',
      ),
    ).toBe(false);
  });
});

describe('recipe multiplier', () => {
  const leafData = (id: string) =>
    state().nodes.find(n => n.id === id)!.data as SinkNodeData;

  it('scales supply so a higher producer multiplier clears a deficit', () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Plate', quantity: 1 });
    const b = addNode('recipeNode');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'Plate', quantity: 2 });
    state().onConnect({
      source: a,
      target: b,
      sourceHandle: outId,
      targetHandle: inId,
    });

    // 1/cycle vs 2 needed -> deficit at multiplier 1
    expect(
      validateGraph(state().nodes, state().edges).some(
        i => i.kind === 'deficit',
      ),
    ).toBe(true);

    // run the producer twice -> supply 2, balanced
    state().updateRecipe(a, { multiplier: 2 });
    completeRecipe(a);
    completeRecipe(b);
    expect(validateGraph(state().nodes, state().edges)).toEqual([]);
  });

  it('scales sink remainder by the producer multiplier', () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Ore', quantity: 5 });
    state().updateRecipe(a, { multiplier: 2 }); // supply 10
    const b = addNode('recipeNode');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'Ore', quantity: 4 });
    const sink = addNode('outputNode');
    state().onConnect({
      source: a,
      target: b,
      sourceHandle: outId,
      targetHandle: inId,
    });
    state().onConnect({
      source: a,
      target: sink,
      sourceHandle: outId,
      targetHandle: null,
    });

    // 10 produced - 4 consumed = 6 left for the sink
    expect(leafData(sink).quantity).toBe(6);
  });

  it('scales an input-node leaf by the consumer multiplier', () => {
    const input = addNode('inputNode');
    const b = addNode('recipeNode');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'Ore', quantity: 3 });
    state().updateRecipe(b, { multiplier: 2 });
    state().onConnect({
      source: input,
      target: b,
      sourceHandle: null,
      targetHandle: inId,
    });

    expect(leafData(input).quantity).toBe(6);
  });

  it('re-syncs a connected sink when the multiplier changes', () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Ore', quantity: 4 });
    const sink = addNode('disposalNode');
    state().onConnect({
      source: a,
      target: sink,
      sourceHandle: outId,
      targetHandle: null,
    });
    expect(leafData(sink).quantity).toBe(4);

    state().updateRecipe(a, { multiplier: 3 });
    expect(leafData(sink).quantity).toBe(12);
  });
});

describe('recipePower', () => {
  it('derives EU/t from total EU over the tick duration', () => {
    const id = addNode('recipeNode');
    // 6400 EU over 16s = 320 ticks -> 20 EU/t
    state().updateRecipe(id, { eu: 6400, time: 16 });
    expect(recipePower(recipeData(id))).toBe(20);
  });

  it('is zero when time is zero (avoids divide-by-zero)', () => {
    const id = addNode('recipeNode');
    state().updateRecipe(id, { eu: 6400, time: 0 });
    expect(recipePower(recipeData(id))).toBe(0);
  });
});

describe('lineEnergy', () => {
  it('sums power across recipes, ignoring the multiplier for demand', () => {
    const a = addNode('recipeNode');
    state().updateRecipe(a, { eu: 6400, time: 16, multiplier: 3 }); // 20 EU/t
    const b = addNode('recipeNode');
    state().updateRecipe(b, { eu: 3200, time: 16 }); // 10 EU/t

    // both sit at LV, their machines' tier, so neither overclocks here
    // multiplier scales time, not instantaneous draw -> 30 EU/t total
    expect(lineEnergy(state().nodes, state().edges).demand).toBe(30);
  });

  it('takes the critical path as total time, scaled by multiplier', () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Ore' });
    state().updateRecipe(a, { eu: 0, time: 10, multiplier: 2 }); // 20s
    const b = addNode('recipeNode');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'Ore' });
    state().updateRecipe(b, { eu: 0, time: 30 }); // 30s
    state().onConnect({
      source: a,
      target: b,
      sourceHandle: outId,
      targetHandle: inId,
    });

    // chain a(20s) -> b(30s) = 50s longest path
    expect(lineEnergy(state().nodes, state().edges).time).toBe(50);
  });

  it('runs independent branches in parallel (longest, not sum)', () => {
    const a = addNode('recipeNode');
    state().updateRecipe(a, { eu: 0, time: 40 });
    const b = addNode('recipeNode');
    state().updateRecipe(b, { eu: 0, time: 25 });
    // no edges: two disjoint nodes run concurrently

    expect(lineEnergy(state().nodes, state().edges).time).toBe(40);
  });
});

describe('demandByTier', () => {
  it('sums power but takes the peak single-machine amperage per tier', () => {
    // each recipe sits at its own machine's tier, so none of them overclock
    const a = addNode('recipeNode');
    state().updateRecipe(a, {
      eu: 12800,
      time: 16,
      voltage: 'MV',
      amperage: 2,
    }); // 40 EU/t
    const b = addNode('recipeNode');
    state().updateRecipe(b, {
      eu: 11520,
      time: 16,
      voltage: 'MV',
      amperage: 1,
    }); // 36 EU/t
    const c = addNode('recipeNode');
    state().updateRecipe(c, { eu: 5120, time: 16, voltage: 'LV', amperage: 1 }); // 16 EU/t

    const byTier = demandByTier(state().nodes);
    // MV power summed (76), but amps is the max of the two machines (2), not 3
    expect(byTier.get('MV')).toEqual({ power: 76, amps: 2 });
    expect(byTier.get('LV')).toEqual({ power: 16, amps: 1 });
  });

  it('omits zero-power recipes', () => {
    const idle = addNode('recipeNode');
    state().updateRecipe(idle, { eu: 0, time: 16, voltage: 'HV' });

    expect(demandByTier(state().nodes).size).toBe(0);
  });
});

describe('layoutNodes', () => {
  it('places a producer left of its consumer (left-to-right)', async () => {
    vi.useRealTimers(); // ELK resolves on real timers, not the faked ones
    const a = addNode('recipeNode', 500, 500);
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Ore', quantity: 1 });
    const b = addNode('recipeNode', 0, 0);
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'Ore', quantity: 1 });
    state().onConnect({
      source: a,
      target: b,
      sourceHandle: outId,
      targetHandle: inId,
    });

    const laid = await layoutNodes(state().nodes, state().edges);

    const pos = (id: string) => laid.find(n => n.id === id)!.position;
    expect(pos(a).x).toBeLessThan(pos(b).x);
  });
});

describe('deselectAll', () => {
  it('clears selection on nodes and edges', () => {
    const a = addNode('inputNode');
    store.setState({
      nodes: state().nodes.map(n => ({ ...n, selected: true })),
      edges: [{ id: 'e1', source: a, target: a, selected: true }] as Edge[],
    });
    state().deselectAll();
    expect(state().nodes.every(n => !n.selected)).toBe(true);
    expect(state().edges.every(e => !e.selected)).toBe(true);
  });
});

describe('copy / paste', () => {
  // mark a node selected (paste reads the `selected` flag)
  const select = (id: string) =>
    store.setState({
      nodes: state().nodes.map(n =>
        n.id === id ? { ...n, selected: true } : n,
      ),
    });

  it('does nothing when the clipboard is empty', () => {
    addNode('inputNode');
    state().paste();
    expect(state().nodes).toHaveLength(1);
  });

  it('pastes a fresh copy with new ids, offset and selected', () => {
    const id = addNode('inputNode');
    const original = state().nodes[0]!;
    select(id);
    state().copySelection();
    state().paste();

    expect(state().nodes).toHaveLength(2);
    const copy = state().nodes[1]!;
    expect(copy.id).not.toBe(id);
    expect(copy.selected).toBe(true);
    expect(copy.position).toEqual({
      x: original.position.x + 32,
      y: original.position.y + 32,
    });
    // original gets deselected so only the paste stays selected
    expect(state().nodes[0]!.selected).toBe(false);
  });

  it('anchors the paste at the given cursor position', () => {
    const id = addNode('inputNode', 100, 50);
    select(id);
    state().copySelection();
    state().paste({ x: 400, y: 300 });

    // single node -> its top-left lands exactly on the cursor
    expect(state().nodes[1]!.position).toEqual({ x: 400, y: 300 });
  });

  it('rewires copied edges + recipe output handles to the new nodes', () => {
    const recipe = addNode('recipeNode');
    const outputId = addOutput(recipe);
    const sink = addNode('outputNode');
    state().onConnect({
      source: recipe,
      target: sink,
      sourceHandle: outputId,
      targetHandle: null,
    });
    select(recipe);
    select(sink);
    state().copySelection();
    state().paste();

    // 2 originals + 2 copies
    expect(state().nodes).toHaveLength(4);
    expect(state().edges).toHaveLength(2);

    const pastedRecipe = state().nodes.find(
      n => n.id !== recipe && n.type === 'recipeNode',
    )!;
    const pastedSink = state().nodes.find(
      n => n.id !== sink && n.type === 'outputNode',
    )!;
    const pastedOutputId = (pastedRecipe.data as RecipeNodeData).outputs[0]!.id;
    const pastedEdge = state().edges.find(e => e.source === pastedRecipe.id)!;

    expect(pastedEdge.target).toBe(pastedSink.id);
    expect(pastedEdge.sourceHandle).toBe(pastedOutputId);
    expect(pastedOutputId).not.toBe(outputId);
  });

  it('rewires copied input-node edges + recipe input handles', () => {
    const input = addNode('inputNode');
    const recipe = addNode('recipeNode');
    const inputId = addInput(recipe);
    state().onConnect({
      source: input,
      target: recipe,
      sourceHandle: null,
      targetHandle: inputId,
    });
    select(input);
    select(recipe);
    state().copySelection();
    state().paste();

    expect(state().nodes).toHaveLength(4);
    expect(state().edges).toHaveLength(2);

    const pastedInput = state().nodes.find(
      n => n.id !== input && n.type === 'inputNode',
    )!;
    const pastedRecipe = state().nodes.find(
      n => n.id !== recipe && n.type === 'recipeNode',
    )!;
    const pastedInputId = (pastedRecipe.data as RecipeNodeData).inputs[0]!.id;
    const pastedEdge = state().edges.find(e => e.source === pastedInput.id)!;

    expect(pastedEdge.target).toBe(pastedRecipe.id);
    expect(pastedEdge.targetHandle).toBe(pastedInputId);
    expect(pastedInputId).not.toBe(inputId);
  });

  it('excludes edges that leave the copied selection', () => {
    const recipe = addNode('recipeNode');
    const outputId = addOutput(recipe);
    const sink = addNode('outputNode');
    state().onConnect({
      source: recipe,
      target: sink,
      sourceHandle: outputId,
      targetHandle: null,
    });
    // copy only the recipe — the edge to the sink must not come along
    select(recipe);
    state().copySelection();
    state().paste();

    expect(state().clipboard!.edges).toHaveLength(0);
    expect(state().edges).toHaveLength(1);
  });
});

describe('delete via change handlers', () => {
  it('removes a node through onNodesChange', () => {
    const a = addNode('inputNode');
    addNode('outputNode');
    state().onNodesChange([{ type: 'remove', id: a }]);
    expect(state().nodes.map(n => n.type)).toEqual(['outputNode']);
  });

  it('removes an edge through onEdgesChange', () => {
    store.setState({
      edges: [{ id: 'e1', source: 'a', target: 'b' }] as Edge[],
    });
    state().onEdgesChange([{ type: 'remove', id: 'e1' }]);
    expect(state().edges).toHaveLength(0);
  });
});

describe('reset', () => {
  it('clears the graph when called with no args', () => {
    addNode('recipeNode');

    state().reset();

    expect(state().nodes).toHaveLength(0);
    expect(state().edges).toHaveLength(0);
  });

  it('loads a saved graph', () => {
    addNode('recipeNode');

    const nodes: ProductionNode[] = [
      {
        id: 'n1',
        type: 'inputNode',
        position: { x: 1, y: 2 },
        data: { name: 'Ore', quantity: 1 },
      },
    ];
    const edges: Edge[] = [];
    state().reset(nodes, edges);

    expect(state().nodes).toEqual(nodes);
  });

  it('clears the generator selection', () => {
    state().setGenerator({ categoryId: 'diesel', fuelName: 'Diesel' });

    state().reset();

    expect(state().generator).toBeNull();
  });
});

describe('setGenerator', () => {
  it('stores the per-graph generator selection', () => {
    state().setGenerator({ categoryId: 'diesel', fuelName: 'Diesel' });

    expect(state().generator).toEqual({
      categoryId: 'diesel',
      fuelName: 'Diesel',
    });
  });

  it('overwrites a previous selection', () => {
    state().setGenerator({ categoryId: 'diesel', fuelName: null });
    state().setGenerator({ categoryId: 'gas', fuelName: 'Methane' });

    expect(state().generator).toEqual({
      categoryId: 'gas',
      fuelName: 'Methane',
    });
  });
});

describe('lineMetrics', () => {
  // input leaf -> recipe -> output sink, plus a byproduct -> disposal sink.
  // recipe runs 3× (multiplier) at MV, 5s, 120 EU per run.
  const buildLine = () => {
    const recipe = addNode('recipeNode');
    const inputId = addInput(recipe);
    state().updateRecipeInput(recipe, inputId, { name: 'Ore', quantity: 2 });
    const plateId = addOutput(recipe);
    state().updateRecipeOutput(recipe, plateId, { name: 'Plate', quantity: 4 });
    const slagId = addOutput(recipe);
    state().updateRecipeOutput(recipe, slagId, { name: 'Slag', quantity: 1 });
    state().updateRecipe(recipe, {
      machine: 'EBF',
      voltage: 'MV',
      multiplier: 3,
      eu: 12000,
      time: 5,
    });

    const input = addNode('inputNode');
    state().onConnect({
      source: input,
      target: recipe,
      sourceHandle: null,
      targetHandle: inputId,
    });
    const output = addNode('outputNode');
    state().onConnect({
      source: recipe,
      target: output,
      sourceHandle: plateId,
      targetHandle: null,
    });
    const disposal = addNode('disposalNode');
    state().onConnect({
      source: recipe,
      target: disposal,
      sourceHandle: slagId,
      targetHandle: null,
    });

    return state();
  };

  it('aggregates leaf amounts scaled by the recipe multiplier', () => {
    const { nodes, edges } = buildLine();
    const metrics = lineMetrics(nodes, edges);

    expect(metrics.inputs).toEqual([{ name: 'Ore', quantity: 6 }]);
    expect(metrics.outputs).toEqual([{ name: 'Plate', quantity: 12 }]);
    expect(metrics.disposals).toEqual([{ name: 'Slag', quantity: 3 }]);
  });

  it('lists machines with their voltage tier', () => {
    const { nodes, edges } = buildLine();
    expect(lineMetrics(nodes, edges).machines).toEqual([
      { machine: 'EBF', voltage: 'MV', quantity: 1 },
    ]);
  });

  it('reports critical-path time and peak demand', () => {
    const { nodes, edges } = buildLine();
    const metrics = lineMetrics(nodes, edges);

    expect(metrics.time).toBe(15); // 5s × 3 runs
    expect(metrics.demand).toBeCloseTo(120); // 12,000 EU / (5s × 20 ticks)
  });

  it('is empty for a graph with no nodes', () => {
    expect(lineMetrics([], [])).toEqual({
      inputs: [],
      outputs: [],
      disposals: [],
      machines: [],
      time: 0,
      demand: 0,
    });
  });
});

describe('validateGraph — overclocking', () => {
  // a multiblock on a 128 EU/t recipe fed one tier above it
  const multiblock = (patch: Partial<RecipeNodeData> = {}) => {
    const recipe = addNode('recipeNode');
    state().updateRecipe(recipe, {
      kind: 'multi',
      machine: 'Vacuum Freezer',
      eu: 153600,
      time: 60,
      voltage: 'HV',
      amperage: 1,
      ...patch,
    });
    return recipe;
  };

  const kinds = (issues: ReturnType<typeof validateGraph>) =>
    issues.map(x => x.kind);

  it('raises no overclock issue for a well-fed known multiblock', () => {
    multiblock();
    expect(kinds(validateGraph(state().nodes, state().edges))).not.toContain(
      'underpowered',
    );
  });

  it('flags hatches below the recipe requirement', () => {
    multiblock({ voltage: 'LV' });
    expect(kinds(validateGraph(state().nodes, state().edges))).toContain(
      'underpowered',
    );
  });

  it('flags overclocks a singleblock loses to the one tick floor', () => {
    // 128 EU/t over 20 ticks in a UV macerator: six overclocks are charged
    // for, and the sixth saves no time the floor had not already taken
    const recipe = addNode('recipeNode');
    state().updateRecipe(recipe, {
      machine: 'Macerator',
      eu: 2560,
      time: 1,
      voltage: 'UV',
    });

    expect(kinds(validateGraph(state().nodes, state().edges))).toContain(
      'throttled',
    );
  });

  it('does not flag a multiblock for the same overclocks — they buy parallels', () => {
    // the single biggest correction in the port: past the one tick floor
    // ParallelHelper turns the leftover overclocks into concurrent recipes, so
    // the same recipe that wastes power in a singleblock runs four at once here
    multiblock({ eu: 2560, time: 1, voltage: 'UV' });

    expect(kinds(validateGraph(state().nodes, state().edges))).not.toContain(
      'throttled',
    );
    expect(overclock(recipeData(state().nodes[0]!.id)).parallels).toBe(4);
  });

  it('flags a ceiling the user set below what the machine would run', () => {
    // an Industrial Centrifuge on 4 EV hatches caps at 6 x IV = 30 parallels
    multiblock({
      machine: 'Industrial Centrifuge',
      eu: 2048 * 20,
      time: 1,
      hatches: [{ tier: 'EV', count: 4, amps: 2 }],
      parallelLimit: 5,
    });

    const issues = validateGraph(state().nodes, state().edges);
    const issue = issues.find(entry => entry.kind === 'overparallel');
    expect(issue?.supply).toBe(5);
    expect(issue?.demand).toBe(30);
  });

  it('says nothing when only the power caps the parallels', () => {
    // 16,384 EU/t pays for eight 1,844 EU/t recipes out of the machine's 30.
    // that is the shape of almost every real multiblock, so flagging it would
    // fire on nearly every node — it is not a user error
    multiblock({
      machine: 'Industrial Centrifuge',
      eu: 2048 * 20,
      time: 1,
      hatches: [{ tier: 'EV', count: 4, amps: 2 }],
    });
    expect(kinds(validateGraph(state().nodes, state().edges))).not.toContain(
      'overparallel',
    );
  });

  it('flags a machine whose parallel rules the extractor could not read', () => {
    multiblock({ machine: 'Dangote Distillus' });
    expect(kinds(validateGraph(state().nodes, state().edges))).toContain(
      'unmodeled',
    );
  });

  it('flags a machine too cold for the recipe, which GT would not even match', () => {
    multiblock({
      machine: 'Electric Blast Furnace',
      config: { coil: 'cupronickel' },
      recipeHeat: 9000,
      hatches: [{ tier: 'IV', count: 1, amps: 2 }],
    });

    const issues = validateGraph(state().nodes, state().edges);

    const issue = issues.find(entry => entry.kind === 'underheated');
    expect(issue?.supply).toBe(2101); // 1,801 of coil + 100 x (IV - MV)
    expect(issue?.demand).toBe(9000);
    // too cold is a harder stop than too weak, and only one of them is true
    expect(kinds(issues)).not.toContain('underpowered');
  });

  it('flags a required machine parameter the node never set', () => {
    multiblock({ machine: 'Electric Blast Furnace', recipeHeat: 1800 });

    const issues = validateGraph(state().nodes, state().edges);
    const issue = issues.find(entry => entry.kind === 'incomplete');
    expect(issue?.item).toBe('Heating coils');
  });

  it('says nothing once that parameter is set', () => {
    multiblock({
      machine: 'Electric Blast Furnace',
      recipeHeat: 1800,
      config: { coil: 'nichrome' },
    });

    expect(
      validateGraph(state().nodes, state().edges).filter(
        issue => issue.kind === 'incomplete',
      ),
    ).toEqual([]);
  });

  it('never raises the multiblock-only issues for a singleblock', () => {
    const recipe = addNode('recipeNode');
    state().updateRecipe(recipe, {
      machine: 'Macerator',
      eu: 153600,
      time: 60,
      voltage: 'HV',
    });

    const found = kinds(validateGraph(state().nodes, state().edges));
    expect(found).not.toContain('underpowered');
    expect(found).not.toContain('unmodeled');
  });

  it('scales item quantities by the parallels actually running', () => {
    // four sub-tick parallels, not a number anybody typed in
    const recipe = multiblock({ eu: 2560, time: 1, voltage: 'UV' });
    const plate = addOutput(recipe);
    state().updateRecipeOutput(recipe, plate, { name: 'Plate', quantity: 3 });

    const output = addNode('outputNode');
    state().onConnect({
      source: recipe,
      target: output,
      sourceHandle: plate,
      targetHandle: null,
    });

    // 3 per recipe x 4 concurrent recipes, mirrored onto the output leaf
    expect(lineMetrics(state().nodes, state().edges).outputs).toEqual([
      { name: 'Plate', quantity: 12 },
    ]);
  });

  it('reports the overclocked draw from recipePower', () => {
    const recipe = multiblock();
    expect(recipePower(recipeData(recipe))).toBe(512);
  });

  it('drops the machine-only fields when switched back to a singleblock', () => {
    const recipe = multiblock({
      machine: 'Electric Blast Furnace',
      config: { coil: 'nichrome' },
      recipeHeat: 1800,
      parallelLimit: 4,
    });
    state().updateRecipe(recipe, { kind: 'single' });

    const data = recipeData(recipe);
    expect(data).not.toHaveProperty('config');
    expect(data).not.toHaveProperty('recipeHeat');
    expect(data).not.toHaveProperty('parallelLimit');
    // and it now overclocks as a singleblock: one step against its own HV tier
    expect(overclock(data).time).toBe(30);
  });
});

describe('machine shape switching', () => {
  it('turns a singleblock tier into one hatch group', () => {
    const recipe = addNode('recipeNode');
    state().updateRecipe(recipe, { voltage: 'HV', amperage: 2 });
    state().updateRecipe(recipe, { kind: 'multi' });

    const data = recipeData(recipe);
    expect(data.kind).toBe('multi');
    expect(data).toHaveProperty('hatches', [{ tier: 'HV', count: 1, amps: 2 }]);
    // the recipe's own amp draw is not a hatch count and must survive the switch
    expect(data).toHaveProperty('amperage', 2);
    // the singleblock-only tier must not linger on the multiblock arm
    expect(data).not.toHaveProperty('voltage');
  });

  it('turns hatches back into a tier when switched to a singleblock', () => {
    const recipe = addNode('recipeNode');
    state().updateRecipe(recipe, {
      kind: 'multi',
      hatches: [{ tier: 'EV', count: 4, amps: 2 }],
      parallelLimit: 8,
    });
    state().updateRecipe(recipe, { kind: 'single' });

    const data = recipeData(recipe);
    expect(data).toHaveProperty('voltage', 'EV');
    expect(data).not.toHaveProperty('hatches');
    expect(data).not.toHaveProperty('parallelLimit');
  });
});

describe('demandByTier — multiblock hatches', () => {
  it('splits a multiblock load across the tiers of its hatches', () => {
    const recipe = addNode('recipeNode');
    state().updateRecipe(recipe, {
      kind: 'multi',
      machine: 'Multi Smelter',
      eu: 12000,
      time: 5, // 120 EU/t, which one overclock takes to 480
      amperage: 3, // what the RECIPE draws, not how many hatches are fitted
      hatches: [
        { tier: 'MV', count: 1, amps: 2 }, // 128 EU/t of capacity
        { tier: 'LV', count: 4, amps: 2 }, // 128 EU/t of capacity
      ],
    });

    const byTier = demandByTier(state().nodes);
    // equal capacity either side, so the 480 EU/t load halves between them
    expect(byTier.get('MV')).toEqual({ power: 240, amps: 3 });
    expect(byTier.get('LV')).toEqual({ power: 240, amps: 3 });
  });

  it('represents a mixed-hatch machine by its highest tier', () => {
    const recipe = addNode('recipeNode');
    state().updateRecipe(recipe, {
      kind: 'multi',
      amperage: 3,
      hatches: [
        { tier: 'LV', count: 2, amps: 2 },
        { tier: 'EV', count: 1, amps: 2 },
      ],
    });

    expect(machineTier(recipeData(recipe))).toBe('EV');
    // amps report the recipe's draw, never the hatch count
    expect(machineAmps(recipeData(recipe))).toBe(3);
  });
});

describe('normalizeNodes — persisted graphs', () => {
  const persisted = (data: Record<string, unknown>) =>
    ({
      id: 'n1',
      position: { x: 0, y: 0 },
      type: 'recipeNode',
      data: {
        name: 'Recipe',
        machine: 'EBF',
        inputs: [],
        outputs: [],
        ...data,
      },
    }) as unknown as ProductionNode;

  it('backfills hatches on a multiblock saved before they existed', () => {
    const [node] = normalizeNodes([
      persisted({
        kind: 'multi',
        voltage: 'HV',
        amperage: 2,
        multiplier: 1,
        eu: 100,
        time: 5,
      }),
    ]);

    expect(node!.data).toHaveProperty('hatches', [
      { tier: 'HV', count: 1, amps: 2 },
    ]);
    expect(node!.data).toHaveProperty('amperage', 2);
    expect(node!.data).not.toHaveProperty('voltage');
  });

  it('defaults a recipe saved before `kind` existed to a singleblock', () => {
    const [node] = normalizeNodes([
      persisted({
        voltage: 'MV',
        amperage: 1,
        multiplier: 1,
        eu: 100,
        time: 5,
      }),
    ]);

    expect(node!.data).toHaveProperty('kind', 'single');
    expect(node!.data).toHaveProperty('voltage', 'MV');
  });

  it('returns an already-current node by identity, so the canvas is not re-rendered', () => {
    const current = persisted({
      kind: 'multi',
      hatches: [{ tier: 'HV', count: 2, amps: 2 }],
      multiplier: 1,
      eu: 100,
      time: 5,
      amperage: 1,
    });

    expect(normalizeNodes([current])[0]).toBe(current);
  });
});

describe('itemRate', () => {
  const soleOutput = (id: string) => recipeData(id).outputs[0]!;

  it('ignores the sequential run count', () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Ore', quantity: 6 });
    completeRecipe(a);

    const once = itemRate(recipeData(a), soleOutput(a));
    state().updateRecipe(a, { multiplier: 3 });

    // three cycles in a row move three times as much over three times the
    // wall-clock, so the rate is untouched — only the per-pass figure moves
    expect(itemRate(recipeData(a), soleOutput(a))).toBe(once);
    expect(itemPerPass(recipeData(a), soleOutput(a))).toBe(
      6 * 3 * overclock(recipeData(a)).parallels,
    );
  });

  it('reports no throughput while the duration is unset', () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Ore', quantity: 6 });

    // an unfilled duration is already an `incomplete` issue; the rate must not
    // come back as Infinity and poison every sum downstream
    expect(itemRate(recipeData(a), soleOutput(a))).toBe(0);
  });
});

describe('meLedger', () => {
  // A makes Ore; B turns Ore + Sulfur Dust into Plate. Both recipes carry the
  // same power and duration, so their rates are directly comparable. The second
  // input is deliberately NOT water — water is freely available, which is its
  // own case below
  const chain = () => {
    const a = addNode('recipeNode');
    const ore = addOutput(a);
    state().updateRecipeOutput(a, ore, { name: 'Ore', quantity: 8 });
    completeRecipe(a);

    const b = addNode('recipeNode');
    const oreIn = addInput(b);
    state().updateRecipeInput(b, oreIn, { name: 'Ore', quantity: 8 });
    const sulfurIn = addInput(b);
    state().updateRecipeInput(b, sulfurIn, {
      name: 'Sulfur Dust',
      quantity: 2,
    });
    const plate = addOutput(b);
    state().updateRecipeOutput(b, plate, { name: 'Plate', quantity: 4 });
    completeRecipe(b);

    return { a, b, ore, oreIn };
  };

  const names = (entries: LedgerEntry[]) => entries.map(entry => entry.name);

  it('nets an intermediate out with nothing wired at all', () => {
    chain();
    const ledger = meLedger(state().nodes);

    // the whole point: only Sulfur Dust has to be put into the network, and Ore —
    // which the line makes for itself — is not mistaken for something you buy
    expect(names(ledger.required)).toEqual(['Sulfur Dust']);
    expect(names(ledger.products)).toEqual(['Plate']);
    expect(names(ledger.balanced)).toEqual(['Ore']);
  });

  it('is unchanged by wiring an item up as a direct pipe', () => {
    const { a, b, ore, oreIn } = chain();
    const before = meLedger(state().nodes);

    state().onConnect({
      source: a,
      target: b,
      sourceHandle: ore,
      targetHandle: oreIn,
    });

    // an input bus does not care where an item came from, so drawing a pipe
    // between two machines is a note about routing and nothing more. The ledger
    // never sees the edges, which is what makes this structural
    expect(meLedger(state().nodes)).toEqual(before);
  });

  it('calls an item the line makes too slowly undersized, not missing', () => {
    const { a, ore } = chain();
    state().updateRecipeOutput(a, ore, { quantity: 5 });

    const ledger = meLedger(state().nodes);

    // 5 made against 8 drawn. The line DOES make Ore, so this is a producer
    // that cannot keep up — telling someone to go and source their own
    // intermediate is how a loop reads as a shopping list for itself
    expect(names(ledger.required)).not.toContain('Ore');
    const undersized = ledger.short.find(entry => entry.name === 'Ore');
    expect(undersized?.net).toBeLessThan(0);

    // and both halves stay legible rather than being netted into one number
    expect(undersized!.produced).toBeGreaterThan(0);
    expect(undersized!.consumed).toBeGreaterThan(undersized!.produced);

    expect(validateGraph(state().nodes, state().edges, true)).toEqual([]);
  });

  it('groups spellings that differ only in case and spacing', () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Iron  Ore', quantity: 8 });
    completeRecipe(a);

    const b = addNode('recipeNode');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'iron ore', quantity: 8 });
    completeRecipe(b);

    const ledger = meLedger(state().nodes);

    // one item, kept under the first spelling seen
    expect(names(ledger.balanced)).toEqual(['Iron  Ore']);
    expect(ledger.required).toEqual([]);
  });

  it('ignores half-typed rows with no item name', () => {
    const a = addNode('recipeNode');
    addOutput(a);
    completeRecipe(a);

    expect(meLedger(state().nodes)).toEqual({
      required: [],
      short: [],
      covered: [],
      products: [],
      balanced: [],
    });
  });
});

describe('validateGraph — ME mode', () => {
  it('stops reporting unfed inputs and unabsorbed outputs', () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Ore', quantity: 5 });
    const inId = addInput(a);
    state().updateRecipeInput(a, inId, { name: 'Dust', quantity: 2 });
    completeRecipe(a);

    // wired mode calls both of these a problem; on an ME network they are the
    // normal case, and the ledger answers the balance question instead
    expect(validateGraph(state().nodes, state().edges)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'surplus' }),
        expect.objectContaining({ kind: 'unfed' }),
      ]),
    );
    expect(validateGraph(state().nodes, state().edges, true)).toEqual([]);
  });

  it('still reports missing recipe fields', () => {
    addNode('recipeNode');

    // recipe DATA problems are orthogonal to how the line is fed
    expect(validateGraph(state().nodes, state().edges, true)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'incomplete', item: 'energy (EU)' }),
        expect.objectContaining({ kind: 'incomplete', item: 'duration' }),
      ]),
    );
  });

  it('still reports a direct pipe whose two item names disagree', () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Ore', quantity: 4 });
    const b = addNode('recipeNode');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'Ore', quantity: 4 });
    state().onConnect({
      source: a,
      target: b,
      sourceHandle: outId,
      targetHandle: inId,
    });
    state().updateRecipeInput(b, inId, { name: 'Dust' });

    expect(validateGraph(state().nodes, state().edges, true)).toContainEqual(
      expect.objectContaining({ kind: 'mismatch' }),
    );
  });
});

describe('lineMetrics — ME mode', () => {
  it('takes its inputs and outputs from the ledger, not the leaves', () => {
    const a = addNode('recipeNode');
    const ore = addOutput(a);
    state().updateRecipeOutput(a, ore, { name: 'Ore', quantity: 8 });
    const sulfur = addInput(a);
    state().updateRecipeInput(a, sulfur, { name: 'Sulfur Dust', quantity: 2 });
    completeRecipe(a);

    // a leaf left over from before the switch must not be counted twice
    const stray = addNode('outputNode');
    state().renameNode(stray, 'Stale');

    const wired = lineMetrics(state().nodes, state().edges);
    const me = lineMetrics(state().nodes, state().edges, true);

    expect(wired.outputs).toContainEqual(
      expect.objectContaining({ name: 'Stale' }),
    );
    expect(me.outputs).toEqual([
      { name: 'Ore', quantity: 8 * overclock(recipeData(a)).parallels },
    ]);
    expect(me.inputs).toEqual([
      { name: 'Sulfur Dust', quantity: 2 * overclock(recipeData(a)).parallels },
    ]);
    expect(me.disposals).toEqual([]);

    // the machine tally and the power figures are model-independent
    expect(me.machines).toEqual(wired.machines);
    expect(me.demand).toBe(wired.demand);
  });
});

describe('validateGraph — split item names', () => {
  // A makes "Steel Ingot", B eats "Steel Ingots". One item, two spellings, so
  // the ledger reports a shortage AND a surplus that both exist only on paper
  const split = (made: string, eaten: string) => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: made, quantity: 8 });
    completeRecipe(a);

    const b = addNode('recipeNode');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: eaten, quantity: 8 });
    completeRecipe(b);
  };

  it('flags a shortage and a surplus a typo apart', () => {
    split('Steel Ingot', 'Steel Ingots');

    expect(validateGraph(state().nodes, state().edges, true)).toContainEqual(
      expect.objectContaining({ kind: 'similar' }),
    );
  });

  it('leaves genuinely different items alone', () => {
    split('Steel Ingot', 'Copper Ingot');

    expect(validateGraph(state().nodes, state().edges, true)).toEqual([]);
  });

  it('says nothing when the near-identical pair both balance', () => {
    // both spellings are made AND eaten, so nothing split — two real items
    const a = addNode('recipeNode');
    const outA = addOutput(a);
    state().updateRecipeOutput(a, outA, { name: 'Tin Plate', quantity: 4 });
    const inA = addInput(a);
    state().updateRecipeInput(a, inA, { name: 'Tin Plates', quantity: 4 });
    completeRecipe(a);

    const b = addNode('recipeNode');
    const outB = addOutput(b);
    state().updateRecipeOutput(b, outB, { name: 'Tin Plates', quantity: 4 });
    const inB = addInput(b);
    state().updateRecipeInput(b, inB, { name: 'Tin Plate', quantity: 4 });
    completeRecipe(b);

    expect(validateGraph(state().nodes, state().edges, true)).toEqual([]);
  });

  it('stays quiet in wired mode, where the ledger does not apply', () => {
    split('Steel Ingot', 'Steel Ingots');

    expect(validateGraph(state().nodes, state().edges)).not.toContainEqual(
      expect.objectContaining({ kind: 'similar' }),
    );
  });
});

describe('meLedger — storage and freely available items', () => {
  // one machine turning Sulfur Dust + Water into Plate. Nothing makes either
  // input, so both start out as work to go and do
  const consumer = () => {
    const a = addNode('recipeNode');
    const sulfur = addInput(a);
    state().updateRecipeInput(a, sulfur, { name: 'Sulfur Dust', quantity: 4 });
    const water = addInput(a);
    state().updateRecipeInput(a, water, { name: 'Water', quantity: 1000 });
    const plate = addOutput(a);
    state().updateRecipeOutput(a, plate, { name: 'Plate', quantity: 1 });
    completeRecipe(a);
    return a;
  };

  const storage = (items: { name: string; rate?: number }[]) => {
    const id = addNode('storageNode');
    for (const item of items) {
      state().addStorageItem(id);
      const stored = (
        state().nodes.find(n => n.id === id)!.data as {
          items: { id: string }[];
        }
      ).items;
      const last = stored[stored.length - 1]!.id;
      state().updateStorageItem(id, last, item);
    }
    return id;
  };

  const find = (entries: LedgerEntry[], name: string) =>
    entries.find(entry => entry.name === name);

  it('never counts water as something to go and supply', () => {
    consumer();
    const ledger = meLedger(state().nodes);

    // GTNH water is unlimited, so it is reported but never chased
    expect(find(ledger.required, 'Water')).toBeUndefined();
    expect(find(ledger.covered, 'Water')?.coveredBy).toBe('free');
    expect(find(ledger.required, 'Sulfur Dust')).toBeDefined();
  });

  it('covers an item declared on hand, with no rate meaning unlimited', () => {
    consumer();
    storage([{ name: 'Sulfur Dust' }]);

    const ledger = meLedger(state().nodes);
    expect(find(ledger.required, 'Sulfur Dust')).toBeUndefined();
    expect(find(ledger.covered, 'Sulfur Dust')?.coveredBy).toBe('storage');

    // storage is not a machine: having it on hand must never make the item look
    // like something this line produces
    expect(find(ledger.products, 'Sulfur Dust')).toBeUndefined();
  });

  it('leaves the shortfall beyond a rate cap as real work', () => {
    const a = consumer();
    const needed = -meLedger(state().nodes).required.find(
      entry => entry.name === 'Sulfur Dust',
    )!.net;

    storage([{ name: 'Sulfur Dust', rate: needed / 4 }]);
    const entry = find(meLedger(state().nodes).required, 'Sulfur Dust');

    // a quarter covered, so three quarters still has to come from somewhere
    expect(entry).toBeDefined();
    expect(-entry!.net).toBeCloseTo(needed * 0.75, 9);
    expect(entry!.covered).toBeCloseTo(needed / 4, 9);

    // the per-pass column is scaled to match, or the two columns would disagree
    const perPass = entry!.consumedPerPass - entry!.producedPerPass;
    expect(perPass).toBeCloseTo(
      4 * overclock(recipeData(a)).parallels * 0.75,
      9,
    );
  });

  it('adds up several storage nodes holding the same item', () => {
    consumer();
    const needed = -meLedger(state().nodes).required.find(
      entry => entry.name === 'Sulfur Dust',
    )!.net;

    storage([{ name: 'Sulfur Dust', rate: needed / 2 }]);
    storage([{ name: 'Sulfur Dust', rate: needed / 2 }]);

    const ledger = meLedger(state().nodes);
    expect(find(ledger.required, 'Sulfur Dust')).toBeUndefined();
    expect(find(ledger.covered, 'Sulfur Dust')).toBeDefined();
  });

  it('matches stored names case- and space-insensitively', () => {
    consumer();
    storage([{ name: '  sulfur   dust ' }]);

    expect(find(meLedger(state().nodes).covered, 'Sulfur Dust')).toBeDefined();
  });

  it('keeps a covered item out of the metrics a line must be fed', () => {
    consumer();
    storage([{ name: 'Sulfur Dust' }]);

    // "what must I supply" is the question lineMetrics answers in ME mode, and
    // neither water nor anything on hand belongs in that answer
    expect(lineMetrics(state().nodes, state().edges, true).inputs).toEqual([]);
  });

  it('says nothing about storage for an item the line never uses', () => {
    consumer();
    storage([{ name: 'Naquadah' }]);

    const ledger = meLedger(state().nodes);
    expect(find(ledger.covered, 'Naquadah')).toBeUndefined();
    expect(find(ledger.products, 'Naquadah')).toBeUndefined();
    expect(find(ledger.balanced, 'Naquadah')).toBeUndefined();
  });
});

describe('starvation', () => {
  // every recipe here carries the same power and duration, so a row's rate is
  // proportional to its quantity and the arithmetic stays readable
  const recipe = (
    ins: [string, number][],
    outs: [string, number][],
  ): string => {
    const id = addNode('recipeNode');
    for (const [name, quantity] of ins) {
      const item = addInput(id);
      state().updateRecipeInput(id, item, { name, quantity });
    }
    for (const [name, quantity] of outs) {
      const item = addOutput(id);
      state().updateRecipeOutput(id, item, { name, quantity });
    }
    completeRecipe(id);
    return id;
  };

  it('leaves a line that keeps up at full speed', () => {
    const a = recipe([['Ore', 4]], [['Plate', 4]]);
    const b = recipe([], [['Ore', 4]]);

    const result = starvation(state().nodes);
    expect(result.worst).toBe(1);
    expect(result.limiting).toBeUndefined();
    expect(result.speed.get(a)).toBe(1);
    expect(result.speed.get(b)).toBe(1);
  });

  it('holds a machine to the share of the input it can actually get', () => {
    const consumer = recipe([['Ore', 4]], [['Plate', 4]]);
    recipe([], [['Ore', 1]]);

    // a quarter of the ore it wants, so a quarter of the speed
    const result = starvation(state().nodes);
    expect(result.speed.get(consumer)).toBeCloseTo(0.25, 9);
    expect(result.worst).toBeCloseTo(0.25, 9);
    expect(result.limiting).toBe('Ore');
  });

  it('carries a shortage downstream to everything behind it', () => {
    // C makes 2 X; B wants 4 X and makes 4 Y; A wants 8 Y. B is held to half,
    // which halves the Y it makes, which holds A to a quarter
    recipe([], [['X', 2]]);
    const b = recipe([['X', 4]], [['Y', 4]]);
    const a = recipe([['Y', 8]], [['Done', 1]]);

    const result = starvation(state().nodes);
    expect(result.speed.get(b)).toBeCloseTo(0.5, 9);
    expect(result.speed.get(a)).toBeCloseTo(0.25, 9);
    expect(result.worst).toBeCloseTo(0.25, 9);

    // A is waiting on Y, but B is already flat out making all the Y it can —
    // the shortage that a machine can actually cure is X, one hop further back
    expect(result.limiting).toBe('X');
  });

  it('settles rather than oscillating when the line loops', () => {
    // A feeds B and B feeds A, the shape a real processing loop has
    recipe([['Y', 1]], [['X', 1]]);
    recipe([['X', 4]], [['Y', 4]]);

    const result = starvation(state().nodes);
    expect(Number.isFinite(result.worst)).toBe(true);
    expect(result.worst).toBeGreaterThan(0);
    expect(result.worst).toBeLessThan(1);
  });

  it('never starves an item nothing in the line makes', () => {
    const only = recipe([['Naquadah', 9999]], [['Plate', 1]]);

    // it is on the required list, which is where it belongs — it is not a
    // reason to report the machine as running slowly
    expect(starvation(state().nodes).speed.get(only)).toBe(1);
  });

  it('never starves water, or anything held in storage', () => {
    const consumer = recipe(
      [
        ['Water', 9999],
        ['Ore', 4],
      ],
      [['Plate', 1]],
    );
    recipe([], [['Ore', 1]]);

    const before = starvation(state().nodes);
    expect(before.limiting).toBe('Ore');

    const store = addNode('storageNode');
    state().addStorageItem(store);
    const item = (
      state().nodes.find(n => n.id === store)!.data as {
        items: { id: string }[];
      }
    ).items[0]!.id;
    state().updateStorageItem(store, item, { name: 'Ore' });

    expect(starvation(state().nodes).speed.get(consumer)).toBe(1);
  });
});

describe('lineFlow', () => {
  const recipe = (ins: [string, number][], outs: [string, number][]) => {
    const id = addNode('recipeNode');
    for (const [name, quantity] of ins) {
      const item = addInput(id);
      state().updateRecipeInput(id, item, { name, quantity });
    }
    for (const [name, quantity] of outs) {
      const item = addOutput(id);
      state().updateRecipeOutput(id, item, { name, quantity });
    }
    completeRecipe(id);
    return id;
  };

  it('orders machines by the items they exchange, with no edges drawn', () => {
    const a = recipe([], [['Ore', 4]]);
    const b = recipe([['Ore', 4]], [['Plate', 4]]);

    const { successors, cycle } = lineFlow(state().nodes);
    expect(successors.get(a)).toEqual([b]);
    expect(successors.get(b)).toEqual([]);
    expect(cycle).toBeUndefined();
  });

  it('finds the cycle in a loop', () => {
    const a = recipe([['Y', 1]], [['X', 1]]);
    const b = recipe([['X', 1]], [['Y', 1]]);

    expect(lineFlow(state().nodes).cycle?.slice().sort()).toEqual(
      [a, b].sort(),
    );
  });

  it('does not call a machine feeding itself a loop', () => {
    // a recipe listing the same item in and out is legal, not an ordering
    recipe(
      [['Catalyst', 1]],
      [
        ['Catalyst', 1],
        ['Plate', 1],
      ],
    );
    expect(lineFlow(state().nodes).cycle).toBeUndefined();
  });
});

describe('lineEnergy — ME mode', () => {
  const recipe = (ins: [string, number][], outs: [string, number][]) => {
    const id = addNode('recipeNode');
    for (const [name, quantity] of ins) {
      const item = addInput(id);
      state().updateRecipeInput(id, item, { name, quantity });
    }
    for (const [name, quantity] of outs) {
      const item = addOutput(id);
      state().updateRecipeOutput(id, item, { name, quantity });
    }
    completeRecipe(id);
    return id;
  };

  it('times an unwired chain from the items alone', () => {
    const a = recipe([], [['Ore', 4]]);
    const b = recipe([['Ore', 4]], [['Plate', 4]]);

    // wired mode sees no edges and so no chain at all; ME mode reads the
    // ordering off the items and gets the real two-stage duration
    const nominal =
      overclock(recipeData(a)).time * recipeData(a).multiplier +
      overclock(recipeData(b)).time * recipeData(b).multiplier;

    expect(lineEnergy(state().nodes, [], true).time).toBeCloseTo(nominal, 9);
    expect(lineEnergy(state().nodes, []).time).toBeLessThan(nominal);
  });

  it('reports a loop instead of inventing a critical path for it', () => {
    recipe([['Y', 1]], [['X', 1]]);
    recipe([['X', 1]], [['Y', 1]]);

    const looped = lineEnergy(state().nodes, [], true);
    expect(looped.looped).toBe(true);
    expect(looped.time).toBe(0);
    // the power figure is unaffected — every machine still draws what it draws
    expect(looped.demand).toBeGreaterThan(0);
  });
});
