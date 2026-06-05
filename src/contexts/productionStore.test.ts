import type { Edge } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  layoutNodes,
  lineEnergy,
  demandByTier,
  recipePower,
  useProductionStore,
  validateGraph,
  type RecipeNodeData,
  type SinkNodeData,
  type ProductionNode,
  type ProductionNodeType,
} from './productionStore';

const store = useProductionStore;
const state = () => store.getState();
const history = () => store.temporal.getState();

// flush the debounced history push (handleSet is debounced by 400ms)
const flushHistory = () => vi.advanceTimersByTime(400);

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

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  // clean slate without leaking a debounced push into the next test
  store.setState({ nodes: [], edges: [] });
  vi.runAllTimers();
  history().clear();
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
    state().updateRecipe(b, { eu: 1280, time: 16 }); // 4 EU/t

    // multiplier scales time, not instantaneous draw -> 24 EU/t total
    expect(lineEnergy(state().nodes, state().edges).demand).toBe(24);
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
    const a = addNode('recipeNode');
    state().updateRecipe(a, { eu: 6400, time: 16, voltage: 'MV', amperage: 2 }); // 20 EU/t
    const b = addNode('recipeNode');
    state().updateRecipe(b, { eu: 1280, time: 16, voltage: 'MV', amperage: 1 }); // 4 EU/t
    const c = addNode('recipeNode');
    state().updateRecipe(c, { eu: 320, time: 16, voltage: 'LV', amperage: 1 }); // 1 EU/t

    const byTier = demandByTier(state().nodes);
    // MV power summed (24), but amps is the max of the two machines (2), not 3
    expect(byTier.get('MV')).toEqual({ power: 24, amps: 2 });
    expect(byTier.get('LV')).toEqual({ power: 1, amps: 1 });
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
  it('clears the graph and history when called with no args', () => {
    addNode('recipeNode');
    flushHistory();
    expect(history().pastStates.length).toBeGreaterThan(0);

    state().reset();

    expect(state().nodes).toHaveLength(0);
    expect(state().edges).toHaveLength(0);
    expect(history().pastStates).toHaveLength(0);
  });

  it('loads a saved graph and wipes history', () => {
    addNode('recipeNode');
    flushHistory();

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
    expect(history().pastStates).toHaveLength(0);
  });

  it('does not leave a phantom undo entry after the debounce window', () => {
    const nodes: ProductionNode[] = [
      {
        id: 'n1',
        type: 'inputNode',
        position: { x: 1, y: 2 },
        data: { name: 'Ore', quantity: 1 },
      },
    ];
    state().reset(nodes, []);
    // the debounced push must not fire a recording for the load itself
    flushHistory();
    expect(history().pastStates).toHaveLength(0);
  });
});

describe('undo / redo', () => {
  it('undoes and redoes a node add', () => {
    addNode('recipeNode');
    flushHistory();
    expect(state().nodes).toHaveLength(1);

    history().undo();
    expect(state().nodes).toHaveLength(0);

    history().redo();
    expect(state().nodes).toHaveLength(1);
  });

  it('keeps the redo stack across volatile (selection) changes', () => {
    const a = addNode('recipeNode');
    flushHistory();
    addNode('recipeNode');
    flushHistory();
    expect(state().nodes).toHaveLength(2);

    history().undo();
    expect(state().nodes).toHaveLength(1);
    expect(history().futureStates).toHaveLength(1);

    // React Flow selecting/measuring a node must not record or wipe redo
    state().onNodesChange([{ id: a, type: 'select', selected: true }]);
    flushHistory();
    expect(history().futureStates).toHaveLength(1);

    history().redo();
    expect(state().nodes).toHaveLength(2);
  });

  it('groups a burst of sets into one undo step', () => {
    // two adds within the debounce window => single history entry,
    // snapshotting the state from before the burst
    addNode('recipeNode');
    addNode('recipeNode');
    flushHistory();
    expect(state().nodes).toHaveLength(2);
    expect(history().pastStates).toHaveLength(1);

    history().undo();
    expect(state().nodes).toHaveLength(0);
  });
});
