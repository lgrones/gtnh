import type { Edge } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useProductionStore,
  type InputNodeData,
  type MachineNodeData,
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
    store.setState({ edges: [{ id: 'e1', source: a, target: b }] as Edge[] });

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

describe('setInputQuantity', () => {
  it('updates an input node quantity', () => {
    const id = addNode('inputNode');
    state().setInputQuantity(id, 7);
    expect((state().nodes[0]!.data as InputNodeData).quantity).toBe(7);
  });

  it('is a no-op on a non-input node', () => {
    const id = addNode('outputNode');
    state().setInputQuantity(id, 7);
    expect((state().nodes[0]!.data as SinkNodeData).quantity).toBe(0);
  });
});

describe('machine outputs', () => {
  it('adds an output with sensible defaults', () => {
    const id = addNode('machineNode');
    state().addMachineOutput(id);
    const data = state().nodes[0]!.data as MachineNodeData;
    expect(data.outputs).toHaveLength(1);
    expect(data.outputs[0]).toMatchObject({ name: '', quantity: 1 });
  });

  it('updates an existing output', () => {
    const id = addNode('machineNode');
    state().addMachineOutput(id);
    const outputId = (state().nodes[0]!.data as MachineNodeData).outputs[0]!.id;
    state().updateMachineOutput(id, outputId, { name: 'Slag', quantity: 4 });
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

describe('sink sync', () => {
  // wire a machine output handle to a sink node, return [machineId, outputId, sinkId]
  const wire = (sinkType: ProductionNodeType) => {
    const machine = addNode('machineNode');
    state().addMachineOutput(machine);
    const outputId = (
      state().nodes.find(n => n.id === machine)!.data as MachineNodeData
    ).outputs[0]!.id;
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
    const { machine, outputId, sink } = wire('outputNode');
    state().updateMachineOutput(machine, outputId, { quantity: 9 });
    const data = state().nodes.find(n => n.id === sink)!.data as SinkNodeData;
    expect(data.quantity).toBe(9);
  });

  it('drops the dangling edge when the source output is removed', () => {
    const { machine, outputId } = wire('outputNode');
    state().removeMachineOutput(machine, outputId);
    expect(state().edges).toHaveLength(0);
  });

  it('lets a sink hold only one input — a new connection replaces the old', () => {
    const m1 = addNode('machineNode');
    state().addMachineOutput(m1);
    const o1 = (state().nodes.find(n => n.id === m1)!.data as MachineNodeData)
      .outputs[0]!.id;
    const m2 = addNode('machineNode');
    state().addMachineOutput(m2);
    const o2 = (state().nodes.find(n => n.id === m2)!.data as MachineNodeData)
      .outputs[0]!.id;
    const sink = addNode('outputNode');

    state().onConnect({
      source: m1,
      target: sink,
      sourceHandle: o1,
      targetHandle: null,
    });
    state().onConnect({
      source: m2,
      target: sink,
      sourceHandle: o2,
      targetHandle: null,
    });

    const incoming = state().edges.filter(e => e.target === sink);
    expect(incoming).toHaveLength(1);
    expect(incoming[0]!.source).toBe(m2);
  });

  it('mirrors an unnamed output as-is (empty name, quantity 1)', () => {
    const machine = addNode('machineNode');
    state().addMachineOutput(machine);
    const outputId = (
      state().nodes.find(n => n.id === machine)!.data as MachineNodeData
    ).outputs[0]!.id;
    const sink = addNode('outputNode');
    state().onConnect({
      source: machine,
      target: sink,
      sourceHandle: outputId,
      targetHandle: null,
    });
    const data = state().nodes.find(n => n.id === sink)!.data as SinkNodeData;
    expect(data).toMatchObject({ name: '', quantity: 1 });
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

  it('rewires copied edges + machine output handles to the new nodes', () => {
    const machine = addNode('machineNode');
    state().addMachineOutput(machine);
    const outputId = (
      state().nodes.find(n => n.id === machine)!.data as MachineNodeData
    ).outputs[0]!.id;
    const sink = addNode('outputNode');
    state().onConnect({
      source: machine,
      target: sink,
      sourceHandle: outputId,
      targetHandle: null,
    });
    select(machine);
    select(sink);
    state().copySelection();
    state().paste();

    // 2 originals + 2 copies
    expect(state().nodes).toHaveLength(4);
    expect(state().edges).toHaveLength(2);

    const pastedMachine = state().nodes.find(
      n => n.id !== machine && n.type === 'machineNode',
    )!;
    const pastedSink = state().nodes.find(
      n => n.id !== sink && n.type === 'outputNode',
    )!;
    const pastedOutputId = (pastedMachine.data as MachineNodeData).outputs[0]!
      .id;
    const pastedEdge = state().edges.find(e => e.source === pastedMachine.id)!;

    expect(pastedEdge.target).toBe(pastedSink.id);
    expect(pastedEdge.sourceHandle).toBe(pastedOutputId);
    expect(pastedOutputId).not.toBe(outputId);
  });

  it('excludes edges that leave the copied selection', () => {
    const machine = addNode('machineNode');
    state().addMachineOutput(machine);
    const outputId = (
      state().nodes.find(n => n.id === machine)!.data as MachineNodeData
    ).outputs[0]!.id;
    const sink = addNode('outputNode');
    state().onConnect({
      source: machine,
      target: sink,
      sourceHandle: outputId,
      targetHandle: null,
    });
    // copy only the machine — the edge to the sink must not come along
    select(machine);
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
