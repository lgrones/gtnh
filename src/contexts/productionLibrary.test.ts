import { beforeEach, describe, expect, it } from 'vitest';

import { useProductionLibrary } from './productionLibrary';
import { type ProductionNode } from './productionStore';

const lib = useProductionLibrary;
const state = () => lib.getState();

const node: ProductionNode = {
  id: 'n1',
  type: 'inputNode',
  position: { x: 0, y: 0 },
  data: { name: 'Ore', quantity: 1 },
};

beforeEach(() => {
  lib.setState({
    graphs: [{ id: 'a', name: 'Line 1', nodes: [], edges: [] }],
    activeId: 'a',
  });
});

describe('productionLibrary', () => {
  it('creates a new empty graph and makes it active', () => {
    state().createGraph();
    expect(state().graphs).toHaveLength(2);
    expect(state().activeId).toBe(state().graphs[1]!.id);
    expect(state().graphs[1]!.nodes).toEqual([]);
  });

  it('selects a graph', () => {
    state().createGraph();
    state().selectGraph('a');
    expect(state().activeId).toBe('a');
  });

  it('renames a graph', () => {
    state().renameGraph('a', 'Steel');
    expect(state().graphs[0]!.name).toBe('Steel');
  });

  it('saveActive writes the working graph into the active entry', () => {
    state().saveActive([node], []);
    expect(state().graphs[0]!.nodes).toHaveLength(1);
    expect(state().graphs[0]!.nodes[0]!.id).toBe('n1');
  });

  it('removeGraph drops the graph and keeps activeId valid', () => {
    state().createGraph();
    const second = state().activeId!;
    state().removeGraph(second);
    expect(state().graphs.find(g => g.id === second)).toBeUndefined();
    expect(state().activeId).toBe('a');
  });

  it('allows removing the last graph, leaving none active', () => {
    state().removeGraph('a');
    expect(state().graphs).toHaveLength(0);
    expect(state().activeId).toBeNull();
  });

  it('saveActive is a no-op when nothing is active', () => {
    state().removeGraph('a');
    state().saveActive([node], []);
    expect(state().graphs).toHaveLength(0);
  });
});
