import { useMemo } from 'react';

import { decodeGraph } from '@/contexts/collab/decode';
import {
  captureLine,
  type LineCapture,
  type LineNodeData,
} from '@/contexts/productionStore';

import {
  graphSnapshot,
  useProductionLibrary,
  type GraphMeta,
} from './productionLibrary';

// what a saved line looks like from the OUTSIDE — the reading a collapsed
// sub-line node takes of it. Everything here comes off that line's durable
// snapshot, which the library subscription already keeps cached client-side, so
// no extra Firestore read happens for any of it.
export interface LineSource {
  name: string; // what to call it on the node
  capture: LineCapture;
  // graph ids of the sub-line nodes INSIDE it, for the cycle check
  references: string[];
}

// one reading per (graph, version). Decoding a Yjs snapshot and walking the
// line behind it is not free, and every rendered sub-line node asks for it —
// keyed on that graph's own save counter, so an edit invalidates exactly the
// line it was made to
const cache = new Map<string, { version: number; source: LineSource }>();

// how a line is named on a node that stands for it. The line's own name is what
// the user thinks of it as; the alternative only earns a mention when it is not
// the one the line opens on
const label = (meta: GraphMeta, graphs: GraphMeta[]): string => {
  const siblings = graphs.filter(graph => graph.groupId === meta.groupId);
  const primary = siblings.find(graph => graph.favorite) ?? siblings[0];

  return primary?.id === meta.id
    ? meta.groupName
    : `${meta.groupName} · ${meta.name}`;
};

const read = (
  meta: GraphMeta,
  graphs: GraphMeta[],
  version: number,
): LineSource => {
  const name = label(meta, graphs);
  const hit = cache.get(meta.id);

  if (hit?.version === version && hit.source.name === name) return hit.source;

  const { nodes, edges } = decodeGraph(graphSnapshot(meta.id));

  const source: LineSource = {
    name,
    capture: captureLine(nodes, edges),
    references: [
      ...new Set(
        nodes.flatMap(node =>
          node.type === 'lineNode' ? [node.data.graphId] : [],
        ),
      ),
    ],
  };

  cache.set(meta.id, { version, source });
  return source;
};

// the current reading of a saved line, or undefined when no such line exists
// any more (it was deleted while a node still pointed at it)
export const lineSource = (graphId: string): LineSource | undefined => {
  const { graphs, snapshotVersions } = useProductionLibrary.getState();
  const meta = graphs.find(graph => graph.id === graphId);

  return meta === undefined
    ? undefined
    : read(meta, graphs, snapshotVersions[graphId] ?? 0);
};

// would dropping `candidate` into `host` make a line contain itself? Directly,
// or through however many levels of sub-line the candidate already has. A cycle
// here is not a drawing problem — it is a capture that can never settle, since
// each side's cost would be defined in terms of the other's
export const wouldRecurse = (candidate: string, host: string): boolean => {
  if (candidate === host) return true;

  const seen = new Set<string>();
  const queue = [candidate];

  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);

    for (const next of lineSource(id)?.references ?? []) {
      if (next === host) return true;
      queue.push(next);
    }
  }

  return false;
};

// reactive `lineSource` — re-reads when the line's durable snapshot moves or it
// is renamed, which is what tells a node on the canvas that it went out of date
export const useLineSource = (graphId: string): LineSource | undefined => {
  const version = useProductionLibrary(
    state => state.snapshotVersions[graphId] ?? 0,
  );
  const graphs = useProductionLibrary(state => state.graphs);

  return useMemo(() => {
    const meta = graphs.find(graph => graph.id === graphId);

    return meta === undefined ? undefined : read(meta, graphs, version);
  }, [graphId, graphs, version]);
};

// what a collapsed node should be showing, against what it IS showing. `stale`
// means the source moved on since the capture was taken; adopting it is the
// user's call (`refreshLineNode`), never an automatic re-plan of their graph
export interface LineStatus {
  source: LineSource | undefined;
  stale: boolean;
}

export const useLineStatus = (data: LineNodeData): LineStatus => {
  const source = useLineSource(data.graphId);

  const stale = useMemo(
    () =>
      source !== undefined &&
      (source.name !== data.name ||
        JSON.stringify(source.capture) !== JSON.stringify(data.capture)),
    [source, data.name, data.capture],
  );

  return { source, stale };
};
