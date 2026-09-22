import { type Edge } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useProductionStore, type ProductionNode } from '../productionStore';
import { bindStore, type Binding } from './binding';
import { createGraphDoc, type YjsGraph } from './doc';

const node = (id: string): ProductionNode => ({
  id,
  type: 'inputNode',
  position: { x: 0, y: 0 },
  data: { name: 'Ore', quantity: 1 },
});

let graph: YjsGraph;
let binding: Binding;

beforeEach(() => {
  useProductionStore.setState({
    nodes: [],
    edges: [],
    generator: null,
    generatorBank: null,
  });
  graph = createGraphDoc();
  binding = bindStore(graph);
});

afterEach(() => {
  binding.destroy();
});

describe('binding: store → doc', () => {
  it('mirrors a node added in the store into the Yjs map', () => {
    useProductionStore.setState({ nodes: [node('n1')] });
    expect(graph.nodes.has('n1')).toBe(true);
    expect(graph.nodes.get('n1')).toMatchObject({
      id: 'n1',
      type: 'inputNode',
    });
  });

  it('removes a node from the map when removed from the store', () => {
    useProductionStore.setState({ nodes: [node('n1')] });
    useProductionStore.setState({ nodes: [] });
    expect(graph.nodes.has('n1')).toBe(false);
  });

  it('excludes volatile XYFlow fields from the CRDT', () => {
    useProductionStore.setState({
      nodes: [
        { ...node('n1'), selected: true, measured: { width: 10, height: 10 } },
      ],
    });
    const record = graph.nodes.get('n1');
    expect(record && 'selected' in record).toBe(false);
    expect(record && 'measured' in record).toBe(false);
  });

  it('does not rewrite the record for a volatile-only change', () => {
    useProductionStore.setState({ nodes: [node('n1')] });
    const before = graph.nodes.get('n1');
    useProductionStore.setState({ nodes: [{ ...node('n1'), selected: true }] });
    // unchanged persistent fields => no Yjs write => same stored reference
    expect(graph.nodes.get('n1')).toBe(before);
  });
});

describe('binding: doc → store', () => {
  it('applies a remote node insert into the store', () => {
    graph.doc.transact(() => graph.nodes.set('r1', node('r1')), 'rtdb');
    expect(useProductionStore.getState().nodes.map(n => n.id)).toContain('r1');
  });

  it('applies a remote edge insert into the store', () => {
    const edge: Edge = { id: 'e1', source: 'a', target: 'b' };
    graph.doc.transact(() => graph.edges.set('e1', edge), 'rtdb');
    expect(useProductionStore.getState().edges.map(e => e.id)).toContain('e1');
  });
});

describe('binding: echo guard', () => {
  it('a local edit lands in the doc exactly once, no divergence', () => {
    useProductionStore.setState({ nodes: [node('n1')] });
    expect(graph.nodes.size).toBe(1);
    expect(useProductionStore.getState().nodes).toHaveLength(1);
  });
});

describe('binding: per-graph settings', () => {
  it('mirrors the generator selection into the doc so it travels with the graph', () => {
    useProductionStore.setState({
      generator: { categoryId: 'diesel', fuelName: null },
    });

    expect(graph.meta.get('generator')).toEqual({
      categoryId: 'diesel',
      fuelName: null,
    });
  });

  it('deletes the key rather than storing the default', () => {
    useProductionStore.setState({
      generator: { categoryId: 'diesel', fuelName: null },
    });
    useProductionStore.setState({ generator: null });

    // a graph nobody picked a generator for carries no entry for it, so an old
    // snapshot and a deliberately-cleared one look the same on the wire
    expect(graph.meta.has('generator')).toBe(false);
  });

  it('applies a remote generator selection into the store', () => {
    graph.doc.transact(
      () =>
        graph.meta.set('generator', { categoryId: 'steam', fuelName: null }),
      'rtdb',
    );

    expect(useProductionStore.getState().generator).toEqual({
      categoryId: 'steam',
      fuelName: null,
    });
  });

  it('mirrors a hand-built generator bank the same way', () => {
    const bank = [
      {
        id: 'row-1',
        categoryId: 'gas',
        tier: 'HV' as const,
        fuelName: 'Benzene',
        count: 2,
      },
    ];
    useProductionStore.setState({ generatorBank: bank });

    expect(graph.meta.get('generatorBank')).toEqual(bank);
  });

  it('tells an untouched bank apart from one emptied on purpose', () => {
    useProductionStore.setState({ generatorBank: [] });
    // an empty array is someone deleting every row, and has to survive the
    // round trip as one — `null` is what means "still following the suggestion"
    expect(graph.meta.get('generatorBank')).toEqual([]);

    useProductionStore.setState({ generatorBank: null });
    expect(graph.meta.has('generatorBank')).toBe(false);
  });

  it('applies a remote bank into the store', () => {
    graph.doc.transact(
      () =>
        graph.meta.set('generatorBank', [
          {
            id: 'row-1',
            categoryId: 'naquadah',
            tier: 'IV',
            fuelName: 'Tiberium Rod',
            count: 1,
          },
        ]),
      'rtdb',
    );

    expect(useProductionStore.getState().generatorBank).toMatchObject([
      { categoryId: 'naquadah', tier: 'IV', count: 1 },
    ]);
  });

  it('reads a graph with no stored selection as unpicked', () => {
    graph.doc.transact(
      () =>
        graph.meta.set('generator', { categoryId: 'steam', fuelName: null }),
      'rtdb',
    );
    graph.doc.transact(() => graph.meta.delete('generator'), 'rtdb');

    expect(useProductionStore.getState().generator).toBeNull();
  });
});

describe('binding: switching graphs', () => {
  it('does not carry a per-graph setting into the next graph', () => {
    // the sequence session.open() runs: tear the old binding down, reset the
    // store, then bind the next doc. Getting that order wrong would push the
    // outgoing graph's settings into the incoming one, which is invisible until
    // someone opens an unrelated line and finds it running on someone else's
    // generator
    useProductionStore
      .getState()
      .setGenerator({ categoryId: 'diesel', fuelName: null });
    expect(graph.meta.get('generator')).toEqual({
      categoryId: 'diesel',
      fuelName: null,
    });

    binding.destroy();
    useProductionStore.getState().reset();

    const next = createGraphDoc();
    const nextBinding = bindStore(next);

    expect(next.meta.get('generator')).toBeUndefined();
    expect(useProductionStore.getState().generator).toBeNull();

    nextBinding.destroy();
    next.doc.destroy();
    // afterEach destroys `binding`; rebind so that stays valid
    binding = bindStore(graph);
  });
});

// The failure this guards against, in the shape it actually took: a dev HMR
// update replaces the session module without tearing the old session down, so
// a binding holding graph A's doc is still subscribed to the store when graph B
// loads into it. Unguarded, it mirrors B's nodes into A and deletes A's own.
describe('binding: a superseded binding is read-only', () => {
  it("never writes the newly opened graph into the previous graph's doc", () => {
    // graph A, with content of its own
    useProductionStore.setState({ nodes: [node('a1')] });
    expect(graph.nodes.has('a1')).toBe(true);

    // graph B opens; the old binding is leaked rather than destroyed
    const next = createGraphDoc();
    const nextBinding = bindStore(next);

    useProductionStore.setState({ nodes: [node('b1')] });

    expect(next.nodes.has('b1')).toBe(true);
    // A keeps its own node and never receives B's
    expect(graph.nodes.has('b1')).toBe(false);
    expect(graph.nodes.has('a1')).toBe(true);

    nextBinding.destroy();
  });

  it('leaves the claim free for the next binding when destroyed', () => {
    const next = createGraphDoc();
    bindStore(next).destroy();

    const rebound = bindStore(next);
    useProductionStore.setState({ nodes: [node('n1')] });

    expect(next.nodes.has('n1')).toBe(true);
    rebound.destroy();
  });

  it('does not let a new empty graph empty the one it replaces', () => {
    useProductionStore.setState({ nodes: [node('a1')] });

    // opening a fresh graph pulls its (empty) contents into the store — the
    // outgoing binding must not read that as "the user deleted everything"
    const next = createGraphDoc();
    const nextBinding = bindStore(next);

    expect(useProductionStore.getState().nodes).toEqual([]);
    expect(graph.nodes.has('a1')).toBe(true);

    nextBinding.destroy();
  });
});
