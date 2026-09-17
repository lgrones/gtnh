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
    meMode: false,
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
  it('mirrors the ME flag into the doc so it travels with the graph', () => {
    useProductionStore.setState({ meMode: true });
    expect(graph.meta.get('meMode')).toBe(true);
  });

  it('deletes the key rather than storing the default', () => {
    useProductionStore.setState({ meMode: true });
    useProductionStore.setState({ meMode: false });

    // a graph that never turned ME mode on carries no entry for it, so an old
    // snapshot and a deliberately-wired one look the same on the wire
    expect(graph.meta.has('meMode')).toBe(false);
  });

  it('applies a remote ME flag into the store', () => {
    graph.doc.transact(() => graph.meta.set('meMode', true), 'rtdb');
    expect(useProductionStore.getState().meMode).toBe(true);
  });

  it('reads a graph with no stored flag as a wired line', () => {
    graph.doc.transact(() => graph.meta.set('meMode', true), 'rtdb');
    graph.doc.transact(() => graph.meta.delete('meMode'), 'rtdb');
    expect(useProductionStore.getState().meMode).toBe(false);
  });
});

describe('binding: switching graphs', () => {
  it('does not carry a per-graph setting into the next graph', () => {
    // the sequence session.open() runs: tear the old binding down, reset the
    // store, then bind the next doc. Getting that order wrong would push the
    // outgoing graph's settings into the incoming one, which is invisible until
    // someone opens an unrelated line and finds it in ME mode
    useProductionStore.getState().setMeMode(true);
    expect(graph.meta.get('meMode')).toBe(true);

    binding.destroy();
    useProductionStore.getState().reset();

    const next = createGraphDoc();
    const nextBinding = bindStore(next);

    expect(next.meta.get('meMode')).toBeUndefined();
    expect(useProductionStore.getState().meMode).toBe(false);

    nextBinding.destroy();
    next.doc.destroy();
    // afterEach destroys `binding`; rebind so that stays valid
    binding = bindStore(graph);
  });
});
