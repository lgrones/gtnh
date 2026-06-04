import type { Edge } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useProductionStore,
  type MachineNodeData,
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

  it('appends a machine node with an empty outputs list', () => {
    const id = addNode('machineNode');
    const node = state().nodes.find(n => n.id === id)!;
    expect(node.type).toBe('machineNode');
    expect((node.data as MachineNodeData).outputs).toEqual([]);
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
    const a = addNode('machineNode');
    const b = addNode('machineNode');
    store.setState({
      edges: [{ id: 'e1', source: a, target: b }] as Edge[],
    });

    state().removeNode(a);

    expect(state().nodes.map(n => n.id)).toEqual([b]);
    expect(state().edges).toHaveLength(0);
  });
});

describe('renameNode', () => {
  it('updates the node name', () => {
    const id = addNode('inputNode');
    state().renameNode(id, 'Iron Ore');
    expect(state().nodes[0]!.data.name).toBe('Iron Ore');
  });

  it('leaves other nodes untouched', () => {
    const a = addNode('inputNode');
    const b = addNode('outputNode');
    state().renameNode(a, 'Renamed');
    expect(state().nodes.find(n => n.id === b)!.data.name).toBe('Output');
  });
});

describe('machine outputs', () => {
  it('adds an output with sensible defaults', () => {
    const id = addNode('machineNode');
    state().addMachineOutput(id);
    const data = state().nodes[0]!.data as MachineNodeData;
    expect(data.outputs).toHaveLength(1);
    expect(data.outputs[0]).toMatchObject({
      name: '',
      quantity: 1,
    });
  });

  it('updates an existing output', () => {
    const id = addNode('machineNode');
    state().addMachineOutput(id);
    const outputId = (state().nodes[0]!.data as MachineNodeData).outputs[0]!.id;
    state().updateMachineOutput(id, outputId, {
      name: 'Slag',
      quantity: 4,
    });
    const output = (state().nodes[0]!.data as MachineNodeData).outputs[0]!;
    expect(output).toMatchObject({ name: 'Slag', quantity: 4 });
  });

  it('removes an output', () => {
    const id = addNode('machineNode');
    state().addMachineOutput(id);
    const outputId = (state().nodes[0]!.data as MachineNodeData).outputs[0]!.id;
    state().removeMachineOutput(id, outputId);
    expect((state().nodes[0]!.data as MachineNodeData).outputs).toHaveLength(0);
  });

  it('is a no-op on a non-machine node', () => {
    const id = addNode('inputNode');
    state().addMachineOutput(id);
    const node = state().nodes[0]!;
    expect(node.type).toBe('inputNode');
    expect('outputs' in node.data).toBe(false);
  });
});

describe('onConnect', () => {
  it('adds an animated edge', () => {
    const a = addNode('machineNode');
    const b = addNode('machineNode');
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

describe('sink relabeling', () => {
  // wire a machine output handle to a sink node, return [machineId, outputId, sinkId]
  const wire = (sinkType: ProductionNodeType) => {
    const machine = addNode('machineNode');
    state().addMachineOutput(machine);
    const outputId = (state().nodes.find(n => n.id === machine)!
      .data as MachineNodeData).outputs[0]!.id;
    state().updateMachineOutput(machine, outputId, {
      name: 'Iron Plate',
      quantity: 4,
    });
    const sink = addNode(sinkType);
    state().onConnect({
      source: machine,
      target: sink,
      sourceHandle: outputId,
      targetHandle: null,
    });
    return { machine, outputId, sink };
  };

  it('renames an output node to "name xquantity" on connect', () => {
    const { sink } = wire('outputNode');
    expect(state().nodes.find(n => n.id === sink)!.data.name).toBe(
      'Iron Plate x4',
    );
  });

  it('renames a disposal node on connect too', () => {
    const { sink } = wire('disposalNode');
    expect(state().nodes.find(n => n.id === sink)!.data.name).toBe(
      'Iron Plate x4',
    );
  });

  it('propagates a later name/quantity edit to the connected sink', () => {
    const { machine, outputId, sink } = wire('outputNode');
    state().updateMachineOutput(machine, outputId, { quantity: 9 });
    expect(state().nodes.find(n => n.id === sink)!.data.name).toBe(
      'Iron Plate x9',
    );
  });

  it('drops the dangling edge when the source output is removed', () => {
    const { machine, outputId } = wire('outputNode');
    state().removeMachineOutput(machine, outputId);
    expect(state().edges).toHaveLength(0);
  });

  it('falls back to "Item" when the output has no name', () => {
    const machine = addNode('machineNode');
    state().addMachineOutput(machine);
    const outputId = (state().nodes.find(n => n.id === machine)!
      .data as MachineNodeData).outputs[0]!.id;
    const sink = addNode('outputNode');
    state().onConnect({
      source: machine,
      target: sink,
      sourceHandle: outputId,
      targetHandle: null,
    });
    expect(state().nodes.find(n => n.id === sink)!.data.name).toBe('Item x1');
  });
});

describe('reset', () => {
  it('clears the graph and history when called with no args', () => {
    addNode('machineNode');
    flushHistory();
    expect(history().pastStates.length).toBeGreaterThan(0);

    state().reset();

    expect(state().nodes).toHaveLength(0);
    expect(state().edges).toHaveLength(0);
    expect(history().pastStates).toHaveLength(0);
  });

  it('loads a saved graph and wipes history', () => {
    addNode('machineNode');
    flushHistory();

    const nodes: ProductionNode[] = [
      { id: 'n1', type: 'inputNode', position: { x: 1, y: 2 }, data: { name: 'Ore' } },
    ];
    const edges: Edge[] = [];
    state().reset(nodes, edges);

    expect(state().nodes).toEqual(nodes);
    expect(history().pastStates).toHaveLength(0);
  });
});

describe('undo / redo', () => {
  it('undoes and redoes a node add', () => {
    addNode('machineNode');
    flushHistory();
    expect(state().nodes).toHaveLength(1);

    history().undo();
    expect(state().nodes).toHaveLength(0);

    history().redo();
    expect(state().nodes).toHaveLength(1);
  });

  it('groups a burst of sets into one undo step', () => {
    // two adds within the debounce window => single history entry,
    // snapshotting the state from before the burst
    addNode('machineNode');
    addNode('machineNode');
    flushHistory();
    expect(state().nodes).toHaveLength(2);
    expect(history().pastStates).toHaveLength(1);

    history().undo();
    expect(state().nodes).toHaveLength(0);
  });
});

describe('persistence', () => {
  it('writes the graph to localStorage', () => {
    addNode('outputNode');
    const raw = localStorage.getItem('gtnh-production-line');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw!) as {
      state: { nodes: ProductionNode[] };
    };
    expect(persisted.state.nodes).toHaveLength(1);
    expect(persisted.state.nodes[0]!.type).toBe('outputNode');
  });
});
