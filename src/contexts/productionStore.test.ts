import type { Edge } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { overclock } from '@/domain/overclock';

import {
  captureLine,
  itemPerPass,
  itemRate,
  layoutNodes,
  lineEnergy,
  machineAmps,
  machineTier,
  normalizeNodes,
  lineMetrics,
  steadyRates,
  demandByTier,
  recipePower,
  useProductionStore,
  validateGraph,
  type LineCapture,
  type HandleOffsets,
  type PlaceableNodeType,
  type RecipeNodeData,
  type SinkNodeData,
  type ProductionNode,
} from './productionStore';

const store = useProductionStore;
const state = () => store.getState();

// add a node and return its generated id
const addNode = (type: PlaceableNodeType, x = 0, y = 0) => {
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
  store.setState({ nodes: [], edges: [], generator: null });
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
    const sink2 = addNode('byproductNode');
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
  const wire = (sinkType: PlaceableNodeType) => {
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

  it('mirrors onto a byproduct node on connect too', () => {
    const { sink } = wire('byproductNode');
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
  it('does not fault a recipe fed less than its machine could take', () => {
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
    completeRecipe(a);
    completeRecipe(b);

    // 1 Ore/s against a machine that could eat 1.6: it runs at 62% and every
    // Ore made is used. That is how most of a line runs, not a fault
    const { nodes: running, capacity } = steadyRates(
      state().nodes,
      state().edges,
    );
    expect(running.get(b)! / capacity.get(b)!).toBeCloseTo(0.625);
    expect(validateGraph(state().nodes, state().edges)).toEqual([]);
  });

  it('flags a wired input that nothing ever delivers to', () => {
    const a = addNode('recipeNode');
    state().renameNode(a, 'Producer');
    const outId = addOutput(a);
    // wired up, and the row says the recipe makes none of it
    state().updateRecipeOutput(a, outId, { name: 'Ore', quantity: 0 });

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
    completeRecipe(a);
    completeRecipe(b);

    expect(validateGraph(state().nodes, state().edges)).toContainEqual(
      expect.objectContaining({
        kind: 'starved',
        recipe: 'Receiver',
        item: 'Ore',
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
    completeRecipe(a); // 5s a cycle, so 1 Ore/s with nowhere to go

    expect(validateGraph(state().nodes, state().edges)).toContainEqual(
      expect.objectContaining({
        kind: 'surplus',
        item: 'Ore',
        supply: 1,
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
    completeRecipe(a);
    completeRecipe(b);

    // both machines run a cycle every 5s: 2 Ore/s made against 0.8 taken
    const surplus = validateGraph(state().nodes, state().edges).find(
      issue => issue.kind === 'surplus',
    );
    expect(surplus).toMatchObject({ item: 'Ore', supply: 2 });
    expect(surplus?.demand).toBeCloseTo(0.8);
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

describe('validateGraph — one input, several producers', () => {
  // two producers wired into the same input handle, making `left` and `right`
  // of the 10 that handle asks for
  const twoSources = (left: number, right: number) => {
    const a = addNode('recipeNode');
    state().renameNode(a, 'Left');
    const aOut = addOutput(a);
    state().updateRecipeOutput(a, aOut, { name: 'Ore', quantity: left });

    const b = addNode('recipeNode');
    state().renameNode(b, 'Right');
    const bOut = addOutput(b);
    state().updateRecipeOutput(b, bOut, { name: 'Ore', quantity: right });

    const c = addNode('recipeNode');
    state().renameNode(c, 'Receiver');
    const inId = addInput(c);
    state().updateRecipeInput(c, inId, { name: 'Ore', quantity: 10 });

    state().onConnect({
      source: a,
      target: c,
      sourceHandle: aOut,
      targetHandle: inId,
    });
    state().onConnect({
      source: b,
      target: c,
      sourceHandle: bOut,
      targetHandle: inId,
    });
    for (const recipe of [a, b, c]) completeRecipe(recipe);

    return { a, b, c, aOut };
  };

  it('adds the producers up rather than charging each the whole demand', () => {
    twoSources(6, 4);

    expect(validateGraph(state().nodes, state().edges)).toEqual([]);
  });

  it('adds the two together before deciding how hard the receiver runs', () => {
    const { c } = twoSources(3, 5);

    // 1.6 Ore/s between them against a machine that could eat 2: one part-duty
    // receiver, not one fault per producer
    const { nodes: running, capacity } = steadyRates(
      state().nodes,
      state().edges,
    );
    expect(running.get(c)! / capacity.get(c)!).toBeCloseTo(0.8);
    expect(validateGraph(state().nodes, state().edges)).toEqual([]);
  });

  it('leaves each producer its share of what the receiver cannot take', () => {
    twoSources(8, 4);

    // 2.4 Ore/s made against 2 taken, and each is charged in proportion to
    // what it makes: Left carries 2 x 1.6/2.4 and is a third of an Ore over
    expect(
      validateGraph(state().nodes, state().edges).filter(
        issue => issue.kind === 'surplus',
      ),
    ).toEqual([
      expect.objectContaining({ kind: 'surplus', recipe: 'Left', supply: 1.6 }),
      expect.objectContaining({
        kind: 'surplus',
        recipe: 'Right',
        supply: 0.8,
      }),
    ]);
  });

  it("mirrors only this producer's share into its sink", () => {
    const { a, aOut } = twoSources(6, 6);
    const sink = addNode('outputNode');
    state().onConnect({
      source: a,
      target: sink,
      sourceHandle: aOut,
      targetHandle: null,
    });

    // 6 made, charged 10 x 6/12 = 5, so 1 is left over — not 6 - 10 = -4
    expect(
      state().nodes.find(node => node.id === sink)!.data.quantity,
    ).toBeCloseTo(1);
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

describe('fractional quantities', () => {
  // a machine that only produces something some of the time is written as the
  // average — an 80% chance is 0.8 per run — so the balance check has to hold up
  // under the float arithmetic that follows from it
  it('is clean when a fractional supply exactly covers the demand', () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Slag', quantity: 0.8 });
    state().updateRecipe(a, { multiplier: 3 });
    const b = addNode('recipeNode');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'Slag', quantity: 2.4 });
    state().onConnect({
      source: a,
      target: b,
      sourceHandle: outId,
      targetHandle: inId,
    });
    completeRecipe(a);
    completeRecipe(b);

    // the premise: three runs of 0.8 is not 2.4 in binary floating point, so an
    // exact comparison reports this line as both short and over at once
    expect(itemPerPass(recipeData(a), recipeData(a).outputs[0]!)).not.toBe(2.4);
    expect(validateGraph(state().nodes, state().edges)).toEqual([]);
  });

  it('settles a fractional supply without float dust', () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Slag', quantity: 0.05 });
    const b = addNode('recipeNode');
    state().renameNode(b, 'Receiver');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'Slag', quantity: 0.2 });
    state().onConnect({
      source: a,
      target: b,
      sourceHandle: outId,
      targetHandle: inId,
    });
    completeRecipe(a);
    completeRecipe(b);

    // a quarter of what the receiver could take, and every scrap of it used
    const { nodes: running, capacity } = steadyRates(
      state().nodes,
      state().edges,
    );
    expect(running.get(b)! / capacity.get(b)!).toBeCloseTo(0.25);
    expect(validateGraph(state().nodes, state().edges)).toEqual([]);
  });

  it('mirrors a fractional leftover onto the sink', () => {
    const a = addNode('recipeNode');
    const outId = addOutput(a);
    state().updateRecipeOutput(a, outId, { name: 'Slag', quantity: 0.8 });
    const b = addNode('recipeNode');
    const inId = addInput(b);
    state().updateRecipeInput(b, inId, { name: 'Slag', quantity: 0.5 });
    const sink = addNode('byproductNode');

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

    const quantity = (
      state().nodes.find(n => n.id === sink)!.data as SinkNodeData
    ).quantity;
    expect(quantity).toBeCloseTo(0.3, 10);
  });
});

describe('recipe multiplier', () => {
  const leafData = (id: string) =>
    state().nodes.find(n => n.id === id)!.data as SinkNodeData;

  it('moves the pass ratio but not the rate the producer holds', () => {
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
    completeRecipe(a);
    completeRecipe(b);

    const before = steadyRates(state().nodes, state().edges).nodes.get(a);
    // two cycles a pass move twice as much over twice as long, so the machine
    // still hands over one Plate every five seconds
    state().updateRecipe(a, { multiplier: 2 });
    expect(steadyRates(state().nodes, state().edges).nodes.get(a)).toBeCloseTo(
      before!,
    );
    expect(itemPerPass(recipeData(a), recipeData(a).outputs[0]!)).toBe(2);
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
    const sink = addNode('byproductNode');
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

  it('reports the slowest single step as the bottleneck, not the chain', () => {
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

    // a running line hands over a pass every 30s — a starts its next cycle
    // while b works, so the 50s critical path is the first pass only
    const { time, bottleneck } = lineEnergy(state().nodes, state().edges);
    expect(time).toBe(50);
    expect(bottleneck).toBe(30);
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

    const pos = (id: string) => laid.nodes.find(n => n.id === id)!.position;
    expect(pos(a).x).toBeLessThan(pos(b).x);
  });

  it('routes an edge around a node standing in its way', async () => {
    vi.useRealTimers();
    const a = addNode('recipeNode', 0, 0);
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
    // a second output on the producer, feeding a consumer two layers along, so
    // its edge has to get past the first consumer
    const farOut = addOutput(a);
    state().updateRecipeOutput(a, farOut, { name: 'Dust', quantity: 1 });
    const c = addNode('recipeNode', 0, 0);
    const cIn = addInput(c);
    state().updateRecipeInput(c, cIn, { name: 'Dust', quantity: 1 });
    const cOut = addOutput(c);
    state().updateRecipeOutput(c, cOut, { name: 'Plate', quantity: 1 });
    const d = addNode('recipeNode', 0, 0);
    const dIn = addInput(d);
    state().updateRecipeInput(d, dIn, { name: 'Plate', quantity: 1 });
    state().onConnect({
      source: a,
      target: c,
      sourceHandle: farOut,
      targetHandle: cIn,
    });
    state().onConnect({
      source: c,
      target: d,
      sourceHandle: cOut,
      targetHandle: dIn,
    });

    const laid = await layoutNodes(state().nodes, state().edges);

    // every edge comes back with ELK's routing attached, and the bends are
    // orthogonal: consecutive points share an x or a y
    const bent = laid.edges.filter(edge => {
      const points = (edge.data as { points?: { x: number; y: number }[] })
        .points;
      return points !== undefined && points.length > 0;
    });
    expect(bent.length).toBeGreaterThan(0);
    for (const edge of bent) {
      const points = (edge.data as { points: { x: number; y: number }[] })
        .points;
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1]!;
        const next = points[i]!;
        expect(prev.x === next.x || prev.y === next.y).toBe(true);
      }
    }
  });

  it('routes each sub-line from its own port when two ship the same item', async () => {
    vi.useRealTimers();
    // a sub-line's ports are named after the items they carry, so two lines
    // that both hand over Hydrogen offer the SAME handle id. ELK resolves a
    // port id across the whole graph, so unless the ids are namespaced per
    // node both edges leave from one line — and get drawn from a machine that
    // has nothing to do with them
    const shipping = (item: string): LineCapture => ({
      inputs: [],
      outputs: [{ id: item, name: item, quantity: 1 }],
      byproducts: [],
      machines: [],
      tiers: [],
      demand: 0,
      time: 0,
      incomplete: 0,
    });

    state().addLineNode('one', 'One', shipping('hydrogen'), { x: 0, y: 0 });
    state().addLineNode('two', 'Two', shipping('hydrogen'), { x: 0, y: 0 });
    const [one, two] = state().nodes.map(node => node.id) as [string, string];

    const consumers = [one, two].map(line => {
      const recipe = addNode('recipeNode');
      const handle = addInput(recipe);
      state().updateRecipeInput(recipe, handle, {
        name: 'hydrogen',
        quantity: 1,
      });
      state().onConnect({
        source: line,
        target: recipe,
        sourceHandle: 'hydrogen',
        targetHandle: handle,
      });
      return { recipe, handle };
    });

    // pin every handle where the DOM would put it, so ELK's routes can be
    // checked against the points React Flow actually draws the edge between
    const HANDLE_Y = 80;
    const offsets: HandleOffsets = new Map([
      [one, new Map([['hydrogen', { x: 400, y: HANDLE_Y }]])],
      [two, new Map([['hydrogen', { x: 400, y: HANDLE_Y }]])],
      ...consumers.map(
        ({ recipe, handle }) =>
          [recipe, new Map([[handle, { x: 0, y: HANDLE_Y }]])] as const,
      ),
    ]);

    const laid = await layoutNodes(state().nodes, state().edges, offsets);
    const at = (nodeId: string, handle: string) => {
      const node = laid.nodes.find(n => n.id === nodeId)!;
      const offset = offsets.get(nodeId)!.get(handle)!;
      return { x: node.position.x + offset.x, y: node.position.y + offset.y };
    };

    for (const edge of laid.edges) {
      const points = (edge.data as { points?: { x: number; y: number }[] })
        .points;
      const chain = [
        at(edge.source, edge.sourceHandle!),
        ...(points ?? []),
        at(edge.target, edge.targetHandle!),
      ];
      // an edge routed from the wrong node arrives as a diagonal: every
      // segment of a route ELK owns end to end shares an x or a y
      for (let i = 1; i < chain.length; i++) {
        const prev = chain[i - 1]!;
        const next = chain[i]!;
        expect(
          Math.abs(prev.x - next.x) < 0.5 || Math.abs(prev.y - next.y) < 0.5,
        ).toBe(true);
      }
    }
  });

  it('clears stale waypoints from an edge it routes straight', async () => {
    vi.useRealTimers();
    const a = addNode('recipeNode', 0, 0);
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
    const edgeId = state().edges[0]!.id;
    state().setEdgePoints(edgeId, [{ x: 999, y: 999 }]);

    const laid = await layoutNodes(state().nodes, state().edges);

    const points = (
      laid.edges[0]!.data as { points?: { x: number; y: number }[] }
    ).points;
    expect(points?.some(p => p.x === 999)).not.toBe(true);
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
  // input leaf -> recipe -> output sink, plus a byproduct -> byproduct sink.
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
    const byproduct = addNode('byproductNode');
    state().onConnect({
      source: recipe,
      target: byproduct,
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
    expect(metrics.byproducts).toEqual([{ name: 'Slag', quantity: 3 }]);
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
      byproducts: [],
      machines: [],
      time: 0,
      bottleneck: 0,
      demand: 0,
      incomplete: 0,
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

  it('carries a disposal node saved under the old name over to a byproduct one', () => {
    const [node] = normalizeNodes([
      {
        id: 'n1',
        position: { x: 0, y: 0 },
        type: 'disposalNode',
        data: { name: 'Slag', quantity: 3 },
      } as unknown as ProductionNode,
    ]);

    expect(node!.type).toBe('byproductNode');
    expect(node!.data).toEqual({ name: 'Slag', quantity: 3 });
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

describe('lineMetrics — unfilled recipes', () => {
  it('counts the recipes whose EU or duration the figures are missing', () => {
    const a = addNode('recipeNode');
    completeRecipe(a);

    const noEu = addNode('recipeNode');
    state().updateRecipe(noEu, { eu: 0, time: 5 });

    const noTime = addNode('recipeNode');
    state().updateRecipe(noTime, { eu: 30, time: 0 });

    const metrics = lineMetrics(state().nodes, state().edges);

    expect(metrics.incomplete).toBe(2);
    // the finished recipe still contributes, so the 0s are a HOLE in the
    // figures rather than the whole of them — which is what the comparison
    // needs in order to refuse to rank them
    expect(metrics.demand).toBeGreaterThan(0);
  });

  it('is clean for a line with every field filled in', () => {
    const a = addNode('recipeNode');
    completeRecipe(a);

    expect(lineMetrics(state().nodes, state().edges).incomplete).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// sub-line nodes: a whole saved line collapsed into one
// ---------------------------------------------------------------------------

// a capture with every field present, so a test only spells out what it is about
const capture = (partial: Partial<LineCapture> = {}): LineCapture => ({
  inputs: [],
  outputs: [],
  byproducts: [],
  machines: [],
  tiers: [],
  demand: 0,
  time: 0,
  incomplete: 0,
  ...partial,
});

// drop a collapsed sub-line on the canvas and return its node id
const addLine = (source: LineCapture, name = 'Sub-line') => {
  state().addLineNode('graph-1', name, source, { x: 0, y: 0 });
  const nodes = state().nodes;
  return nodes[nodes.length - 1]!.id;
};

describe('captureLine', () => {
  // a one-recipe line: 2 ore in, 1 plate + 1 slag out, fed and drained by leaves
  const buildSource = () => {
    const recipe = addNode('recipeNode');
    state().updateRecipe(recipe, { machine: 'Macerator', eu: 30, time: 4 });

    const ore = addInput(recipe);
    state().updateRecipeInput(recipe, ore, { name: 'Ore', quantity: 2 });
    const plate = addOutput(recipe);
    state().updateRecipeOutput(recipe, plate, { name: 'Plate', quantity: 1 });
    const slag = addOutput(recipe);
    state().updateRecipeOutput(recipe, slag, { name: 'Slag', quantity: 1 });

    const feed = addNode('inputNode');
    state().onConnect({
      source: feed,
      target: recipe,
      sourceHandle: null,
      targetHandle: ore,
    });

    const product = addNode('outputNode');
    state().onConnect({
      source: recipe,
      target: product,
      sourceHandle: plate,
      targetHandle: null,
    });

    const waste = addNode('byproductNode');
    state().onConnect({
      source: recipe,
      target: waste,
      sourceHandle: slag,
      targetHandle: null,
    });

    return { recipe };
  };

  it("reads the line's leaves as its ports", () => {
    buildSource();
    const read = captureLine(state().nodes, state().edges);

    expect(read.inputs).toEqual([{ id: 'ore', name: 'Ore', quantity: 2 }]);
    expect(read.outputs).toEqual([{ id: 'plate', name: 'Plate', quantity: 1 }]);
    expect(read.byproducts).toEqual([
      { id: 'slag', name: 'Slag', quantity: 1 },
    ]);
  });

  it('carries the machines, the draw and the critical path', () => {
    buildSource();
    const read = captureLine(state().nodes, state().edges);

    expect(read.machines).toEqual([
      { machine: 'Macerator', quantity: 1, voltage: 'LV' },
    ]);
    expect(read.time).toBe(4);
    expect(read.bottleneck).toBe(4);
    expect(read.demand).toBeGreaterThan(0);
    expect(read.tiers).toEqual([{ tier: 'LV', power: read.demand, amps: 1 }]);
    expect(read.incomplete).toBe(0);
  });

  it('merges two leaves of the same item into one port', () => {
    const recipe = addNode('recipeNode');
    completeRecipe(recipe);

    for (const quantity of [2, 3]) {
      const input = addInput(recipe);
      state().updateRecipeInput(recipe, input, { name: 'Ore', quantity });
      const feed = addNode('inputNode');
      state().onConnect({
        source: feed,
        target: recipe,
        sourceHandle: null,
        targetHandle: input,
      });
    }

    expect(captureLine(state().nodes, state().edges).inputs).toEqual([
      { id: 'ore', name: 'Ore', quantity: 5 },
    ]);
  });

  it('offers no port for a leaf that is wired to nothing', () => {
    addNode('inputNode');
    addNode('outputNode');

    const read = captureLine(state().nodes, state().edges);
    expect(read.inputs).toEqual([]);
    expect(read.outputs).toEqual([]);
  });

  it('counts a recipe with no EU or duration as a hole in the reading', () => {
    addNode('recipeNode');
    expect(captureLine(state().nodes, state().edges).incomplete).toBe(1);
  });
});

describe('sub-line nodes — balance', () => {
  it('feeds a downstream recipe from a sub-line port', () => {
    const line = addLine(
      capture({ outputs: [{ id: 'plate', name: 'Plate', quantity: 4 }] }),
    );

    const recipe = addNode('recipeNode');
    completeRecipe(recipe);
    const input = addInput(recipe);
    state().updateRecipeInput(recipe, input, { name: 'Plate', quantity: 4 });

    state().onConnect({
      source: line,
      target: recipe,
      sourceHandle: 'plate',
      targetHandle: input,
    });

    expect(state().edges).toHaveLength(1);
    expect(
      validateGraph(state().nodes, state().edges).filter(
        issue => issue.kind === 'starved' || issue.kind === 'surplus',
      ),
    ).toEqual([]);
  });

  it('runs a recipe at part duty when the sub-line cannot keep up', () => {
    const line = addLine(
      capture({
        time: 10,
        bottleneck: 10,
        outputs: [{ id: 'plate', name: 'Plate', quantity: 1 }],
      }),
    );

    const recipe = addNode('recipeNode');
    completeRecipe(recipe);
    state().renameNode(recipe, 'Assembler');
    const input = addInput(recipe);
    state().updateRecipeInput(recipe, input, { name: 'Plate', quantity: 4 });

    state().onConnect({
      source: line,
      target: recipe,
      sourceHandle: 'plate',
      targetHandle: input,
    });

    // one Plate every 10s against an Assembler that could take 4 every 5s
    const { nodes: running, capacity } = steadyRates(
      state().nodes,
      state().edges,
    );
    expect(running.get(recipe)! / capacity.get(recipe)!).toBeCloseTo(0.125);
    expect(
      validateGraph(state().nodes, state().edges).filter(
        issue => issue.kind === 'starved',
      ),
    ).toEqual([]);
  });

  it('reports an unfed sub-line input', () => {
    addLine(
      capture({ inputs: [{ id: 'ore', name: 'Ore', quantity: 2 }] }),
      'Ore washing',
    );

    expect(
      validateGraph(state().nodes, state().edges).find(
        issue => issue.kind === 'unfed',
      ),
    ).toMatchObject({ recipe: 'Ore washing', item: 'Ore' });
  });

  it('mirrors a scaled port onto a connected output leaf', () => {
    const line = addLine(
      capture({ outputs: [{ id: 'plate', name: 'Plate', quantity: 3 }] }),
    );
    state().setLineMultiplier(line, 4);

    const sink = addNode('outputNode');
    state().onConnect({
      source: line,
      target: sink,
      sourceHandle: 'plate',
      targetHandle: null,
    });

    const data = state().nodes.find(n => n.id === sink)!.data as SinkNodeData;
    expect(data).toMatchObject({ name: 'Plate', quantity: 12 });
  });

  it('re-reads the mirrors when the copy count changes', () => {
    const line = addLine(
      capture({ outputs: [{ id: 'plate', name: 'Plate', quantity: 3 }] }),
    );
    const sink = addNode('outputNode');
    state().onConnect({
      source: line,
      target: sink,
      sourceHandle: 'plate',
      targetHandle: null,
    });

    state().setLineMultiplier(line, 2);
    const data = state().nodes.find(n => n.id === sink)!.data as SinkNodeData;
    expect(data.quantity).toBe(6);
  });

  it('refuses half a production line', () => {
    const line = addLine(capture());
    state().setLineMultiplier(line, 0.5);
    const node = state().nodes.find(n => n.id === line)!;
    expect(node.type === 'lineNode' && node.data.multiplier).toBe(1);
  });
});

describe('sub-line nodes — cost', () => {
  const powered = capture({
    machines: [
      { machine: 'Macerator', quantity: 2, voltage: 'LV' },
      { machine: 'Electric Blast Furnace', quantity: 1, voltage: 'HV' },
    ],
    tiers: [
      { tier: 'LV', power: 30, amps: 1 },
      { tier: 'HV', power: 480, amps: 2 },
    ],
    demand: 510,
    time: 12,
  });

  it("adds the sub-line's machines to the line's own tally, once", () => {
    const line = addLine(powered);
    // cycles are passes of the same machines, not more of them
    state().setLineMultiplier(line, 3);

    const recipe = addNode('recipeNode');
    completeRecipe(recipe);
    state().updateRecipe(recipe, { machine: 'Macerator' });

    const { machines } = lineMetrics(state().nodes, state().edges);

    expect(machines).toContainEqual({
      machine: 'Macerator',
      quantity: 3, // the sub-line's 2, plus the one on the canvas
      voltage: 'LV',
    });
    expect(machines).toContainEqual({
      machine: 'Electric Blast Furnace',
      quantity: 1,
      voltage: 'HV',
    });
  });

  it('charges the peak draw once and puts the cycles on the clock', () => {
    const line = addLine(powered);
    state().setLineMultiplier(line, 3);

    const energy = lineEnergy(state().nodes, state().edges);
    // the same machines, run three times over: same peak, three times as long
    expect(energy.demand).toBe(510);
    expect(energy.time).toBe(36);
  });

  it("takes the sub-line's own slowest step as the bottleneck it adds", () => {
    const line = addLine(capture({ time: 12, bottleneck: 5 }));
    state().setLineMultiplier(line, 3);

    // the machines inside it stay concurrent, so three passes of a 5s step,
    // not three passes of the 12s chain
    expect(lineEnergy(state().nodes, state().edges).bottleneck).toBe(15);
  });

  it('falls back to the critical path when a capture predates the bottleneck', () => {
    addLine(capture({ time: 12 }));

    expect(lineEnergy(state().nodes, state().edges).bottleneck).toBe(12);
  });

  it('splits the draw into the tiers it was captured in', () => {
    const line = addLine(powered);
    state().setLineMultiplier(line, 2);

    // a second cycle runs the same machines again — the draw is unchanged
    const byTier = demandByTier(state().nodes);
    expect(byTier.get('LV')).toEqual({ power: 30, amps: 1 });
    expect(byTier.get('HV')).toEqual({ power: 480, amps: 2 });
  });

  it("carries the source line's unfilled recipes up as an issue", () => {
    addLine(capture({ incomplete: 2 }), 'Rubber');

    expect(
      validateGraph(state().nodes, state().edges).find(
        issue => issue.kind === 'incomplete',
      ),
    ).toMatchObject({ recipe: 'Rubber' });
  });
});

describe('refreshLineNode', () => {
  const wired = () => {
    const line = addLine(
      capture({
        outputs: [
          { id: 'plate', name: 'Plate', quantity: 1 },
          { id: 'rod', name: 'Rod', quantity: 1 },
        ],
      }),
    );

    for (const handle of ['plate', 'rod']) {
      const sink = addNode('outputNode');
      state().onConnect({
        source: line,
        target: sink,
        sourceHandle: handle,
        targetHandle: null,
      });
    }

    return line;
  };

  it('adopts the new reading', () => {
    const line = wired();
    state().refreshLineNode(
      line,
      'Renamed',
      capture({ outputs: [{ id: 'plate', name: 'Plate', quantity: 9 }] }),
    );

    const node = state().nodes.find(n => n.id === line)!;
    expect(node.type === 'lineNode' && node.data.name).toBe('Renamed');
    expect(node.type === 'lineNode' && node.data.capture.outputs).toEqual([
      { id: 'plate', name: 'Plate', quantity: 9 },
    ]);
  });

  it('keeps the edges of ports that survived and drops the rest', () => {
    const line = wired();
    expect(state().edges).toHaveLength(2);

    state().refreshLineNode(
      line,
      'Sub-line',
      capture({ outputs: [{ id: 'plate', name: 'Plate', quantity: 1 }] }),
    );

    expect(state().edges).toHaveLength(1);
    expect(state().edges[0]!.sourceHandle).toBe('plate');
  });

  it('re-reads the mirrors off the new amounts', () => {
    const line = wired();
    state().refreshLineNode(
      line,
      'Sub-line',
      capture({ outputs: [{ id: 'plate', name: 'Plate', quantity: 7 }] }),
    );

    const sink = state().nodes.find(
      n => n.type === 'outputNode' && n.data.name === 'Plate',
    )!;
    expect((sink.data as SinkNodeData).quantity).toBe(7);
  });
});

describe('an input node against a loop', () => {
  // R1 takes 4 Dust and makes 1 Plate; R2 takes that Plate and makes 3 Dust
  // back. The line eats 4 Dust a pass and returns 3, so only 1 has to come in
  const loop = (returned: number) => {
    const r1 = addNode('recipeNode');
    completeRecipe(r1);
    const dustIn = addInput(r1);
    state().updateRecipeInput(r1, dustIn, { name: 'Dust', quantity: 4 });
    const plateOut = addOutput(r1);
    state().updateRecipeOutput(r1, plateOut, { name: 'Plate', quantity: 1 });

    const r2 = addNode('recipeNode');
    completeRecipe(r2);
    const plateIn = addInput(r2);
    state().updateRecipeInput(r2, plateIn, { name: 'Plate', quantity: 1 });
    const dustOut = addOutput(r2);
    state().updateRecipeOutput(r2, dustOut, {
      name: 'Dust',
      quantity: returned,
    });

    state().onConnect({
      source: r1,
      target: r2,
      sourceHandle: plateOut,
      targetHandle: plateIn,
    });
    state().onConnect({
      source: r2,
      target: r1,
      sourceHandle: dustOut,
      targetHandle: dustIn,
    });

    const feed = addNode('inputNode');
    state().onConnect({
      source: feed,
      target: r1,
      sourceHandle: null,
      targetHandle: dustIn,
    });

    return { r1, r2, dustIn, dustOut, feed };
  };

  const feedData = (id: string) =>
    state().nodes.find(n => n.id === id)!.data as SinkNodeData;

  it('carries in only the shortfall the loop leaves', () => {
    const { feed } = loop(3);
    expect(feedData(feed)).toMatchObject({ name: 'Dust', quantity: 1 });
  });

  it('carries in nothing when the loop covers the whole demand', () => {
    const { feed } = loop(4);
    expect(feedData(feed).quantity).toBe(0);
  });

  it('never goes negative when the loop returns more than is needed', () => {
    // the over-production is the loop recipe's own surplus to report, not an
    // amount for the input node to carry in backwards
    const { feed } = loop(6);
    expect(feedData(feed).quantity).toBe(0);
  });

  it('follows the loop recipe’s multiplier', () => {
    const { r2, feed } = loop(3);
    // two passes of R2 make 6 Dust against R1's 4, so nothing has to come in
    state().updateRecipe(r2, { multiplier: 2 });
    expect(feedData(feed).quantity).toBe(0);
  });

  it('still asks for the whole amount with no loop wired in', () => {
    const r1 = addNode('recipeNode');
    completeRecipe(r1);
    const dustIn = addInput(r1);
    state().updateRecipeInput(r1, dustIn, { name: 'Dust', quantity: 4 });
    const feed = addNode('inputNode');
    state().onConnect({
      source: feed,
      target: r1,
      sourceHandle: null,
      targetHandle: dustIn,
    });
    expect(feedData(feed).quantity).toBe(4);
  });

  it('shares an over-subscribed output out in proportion to what was asked', () => {
    // one output of 3 against two consumers wanting 6 and 2: the first is owed
    // 3 x 6/8, so its input node makes up the other 3.75
    const source = addNode('recipeNode');
    completeRecipe(source);
    const outId = addOutput(source);
    state().updateRecipeOutput(source, outId, { name: 'Dust', quantity: 3 });

    const big = addNode('recipeNode');
    completeRecipe(big);
    const bigIn = addInput(big);
    state().updateRecipeInput(big, bigIn, { name: 'Dust', quantity: 6 });

    const small = addNode('recipeNode');
    completeRecipe(small);
    const smallIn = addInput(small);
    state().updateRecipeInput(small, smallIn, { name: 'Dust', quantity: 2 });

    for (const [target, handle] of [
      [big, bigIn],
      [small, smallIn],
    ] as const)
      state().onConnect({
        source,
        target,
        sourceHandle: outId,
        targetHandle: handle,
      });

    const feed = addNode('inputNode');
    state().onConnect({
      source: feed,
      target: big,
      sourceHandle: null,
      targetHandle: bigIn,
    });
    expect(feedData(feed).quantity).toBeCloseTo(3.75, 10);
  });
});

describe('validateGraph against a loop an input node tops up', () => {
  // the same R1/R2 loop: R1 wants 4 Dust, R2 returns 3, an input leaf carries
  // in the last 1. Nothing is short, and the validator has to agree
  const loop = (returned: number, withFeed: boolean) => {
    const r1 = addNode('recipeNode');
    completeRecipe(r1);
    state().renameNode(r1, 'R1');
    const dustIn = addInput(r1);
    state().updateRecipeInput(r1, dustIn, { name: 'Dust', quantity: 4 });
    const plateOut = addOutput(r1);
    state().updateRecipeOutput(r1, plateOut, { name: 'Plate', quantity: 1 });

    const r2 = addNode('recipeNode');
    completeRecipe(r2);
    state().renameNode(r2, 'R2');
    const plateIn = addInput(r2);
    state().updateRecipeInput(r2, plateIn, { name: 'Plate', quantity: 1 });
    const dustOut = addOutput(r2);
    state().updateRecipeOutput(r2, dustOut, {
      name: 'Dust',
      quantity: returned,
    });

    state().onConnect({
      source: r1,
      target: r2,
      sourceHandle: plateOut,
      targetHandle: plateIn,
    });
    state().onConnect({
      source: r2,
      target: r1,
      sourceHandle: dustOut,
      targetHandle: dustIn,
    });

    if (withFeed) {
      const feed = addNode('inputNode');
      state().onConnect({
        source: feed,
        target: r1,
        sourceHandle: null,
        targetHandle: dustIn,
      });
    }

    return validateGraph(state().nodes, state().edges);
  };

  it('reports nothing starved on the handle the leaf covers', () => {
    expect(loop(3, true).filter(issue => issue.kind === 'starved')).toEqual([]);
  });

  it('reports no surplus for the loop output either', () => {
    expect(loop(3, true).filter(issue => issue.kind === 'surplus')).toEqual([]);
  });

  it('reports a loop that decays as starved when no leaf tops it up', () => {
    // R2 hands back 3 of the 4 R1 needs, so each round of the loop runs at
    // three quarters of the one before it and the pair grinds to a halt
    expect(loop(3, false)).toContainEqual(
      expect.objectContaining({ kind: 'starved', recipe: 'R1', item: 'Dust' }),
    );
  });

  it('sustains a loop that returns everything it takes', () => {
    expect(loop(4, false)).toEqual([]);
  });
});

describe('steadyRates — what a running line actually moves', () => {
  // a recipe node making `out` of an item every `seconds`, at a draw low
  // enough that nothing overclocks
  const maker = (name: string, quantity: number, seconds: number) => {
    const id = addNode('recipeNode');
    state().renameNode(id, name);
    const handle = addOutput(id);
    state().updateRecipeOutput(id, handle, { name: 'Ore', quantity });
    state().updateRecipe(id, { eu: 6 * seconds, time: seconds });
    return { id, handle };
  };

  // a recipe node eating `quantity` Ore and handing back one Plate
  const eater = (name: string, quantity: number, seconds: number) => {
    const id = addNode('recipeNode');
    state().renameNode(id, name);
    const input = addInput(id);
    state().updateRecipeInput(id, input, { name: 'Ore', quantity });
    const output = addOutput(id);
    state().updateRecipeOutput(id, output, { name: 'Plate', quantity: 1 });
    state().updateRecipe(id, { eu: 6 * seconds, time: seconds });
    return { id, input, output };
  };

  const sink = (source: string, handle: string) => {
    const id = addNode('outputNode');
    state().onConnect({
      source,
      target: id,
      sourceHandle: handle,
      targetHandle: null,
    });
    return id;
  };

  const wire = (
    from: { id: string; handle: string },
    to: { id: string; input: string },
  ) =>
    state().onConnect({
      source: from.id,
      target: to.id,
      sourceHandle: from.handle,
      targetHandle: to.input,
    });

  it('runs a consumer at its own capacity when it is fed enough', () => {
    const a = maker('A', 10, 5); // 2 Ore/s
    const b = eater('B', 10, 10); // wants 1 Ore/s, makes 0.1 Plate/s
    wire(a, b);
    const plates = sink(b.id, b.output);

    const { leaves } = steadyRates(state().nodes, state().edges);
    expect(leaves.get(plates)).toBeCloseTo(0.1);
  });

  it('holds a consumer down to what reaches it', () => {
    const a = maker('A', 1, 10); // 0.1 Ore/s
    const b = eater('B', 1, 1); // could eat 1 Ore/s
    wire(a, b);
    const plates = sink(b.id, b.output);

    // starved to a tenth of its machine's capacity
    expect(
      steadyRates(state().nodes, state().edges).leaves.get(plates),
    ).toBeCloseTo(0.1);
  });

  it('leaves a sink the part of an output no recipe takes', () => {
    const a = maker('A', 10, 5); // 2 Ore/s
    const b = eater('B', 10, 10); // takes 1 Ore/s
    wire(a, b);
    const spare = sink(a.id, a.handle);

    expect(
      steadyRates(state().nodes, state().edges).leaves.get(spare),
    ).toBeCloseTo(1);
  });

  it('is unmoved by a multiplier, which is a ratio and not a rate', () => {
    const a = maker('A', 10, 5);
    const b = eater('B', 10, 10);
    wire(a, b);
    const plates = sink(b.id, b.output);

    const before = steadyRates(state().nodes, state().edges).leaves.get(plates);
    // three cycles per pass move three times as much over three times as long
    state().updateRecipe(b.id, { multiplier: 3 });
    const after = steadyRates(state().nodes, state().edges).leaves.get(plates);

    expect(after).toBeCloseTo(before!);
  });

  it('does not let a slow side branch throttle what it never feeds', () => {
    // the Biomass shape: an Electrolyzer with the longest cycle in the graph
    // sits on a branch of its own, and used to divide the whole line's rates
    const a = maker('A', 20, 5); // 4 Ore/s
    const fast = eater('Fast', 10, 5); // 2 Ore/s -> 0.2 Plate/s
    const slow = eater('Slow', 1, 100); // 0.01 Ore/s
    wire(a, fast);
    wire(a, slow);
    const plates = sink(fast.id, fast.output);

    expect(
      steadyRates(state().nodes, state().edges).leaves.get(plates),
    ).toBeCloseTo(0.2);
  });

  it('lets an input leaf stand for the outside world topping a handle up', () => {
    const b = eater('B', 10, 10);
    const feed = addNode('inputNode');
    state().onConnect({
      source: feed,
      target: b.id,
      sourceHandle: null,
      targetHandle: b.input,
    });
    const plates = sink(b.id, b.output);

    const { leaves } = steadyRates(state().nodes, state().edges);
    expect(leaves.get(plates)).toBeCloseTo(0.1); // full capacity
    expect(leaves.get(feed)).toBeCloseTo(1); // 10 Ore every 10s
  });

  it("reads a sub-line's turnover off its own slowest step", () => {
    const line = addLine(
      capture({
        time: 20,
        bottleneck: 5,
        outputs: [{ id: 'ore', name: 'Ore', quantity: 100 }],
      }),
    );
    const out = addNode('outputNode');
    state().onConnect({
      source: line,
      target: out,
      sourceHandle: 'ore',
      targetHandle: null,
    });

    // 100 per pass, one pass every 5s — the critical path is the first pass
    expect(
      steadyRates(state().nodes, state().edges).leaves.get(out),
    ).toBeCloseTo(20);
  });
});
