import { type Connection, type Edge } from '@xyflow/react';

// inline import() type, not a static `import` — a static (even type-only) import
// from elkjs makes the bundler treat the module as statically loaded and refuse
// to split it out of the main chunk (INEFFECTIVE_DYNAMIC_IMPORT). this keeps the
// only elkjs reference the dynamic import() in getElk below.
type ElkNode = import('elkjs/lib/elk.bundled.js').ElkNode;
type ElkPort = import('elkjs/lib/elk.bundled.js').ElkPort;

import type { MachineConfig } from '@/domain/machines/types';
import { hatchVoltage, overclock } from '@/domain/overclock';
import { TICKS_PER_SECOND, TIER_EU } from '@/domain/tiers';

import {
  DEFAULT_HATCH_AMPS,
  DRAG_HANDLE_CLASS,
  type LineCapture,
  type LineNodeData,
  type LinePort,
  type MachineEntry,
  type PlaceableNodeType,
  type ProductionNode,
  type ProductionNodeType,
  type EnergyHatch,
  type RecipeItem,
  type RecipeKind,
  type RecipeNodeData,
  type Waypoint,
  type VoltageTier,
} from './types';

// declared with the node shapes it is stored on, re-exported here so every
// caller keeps reading the graph vocabulary out of one module
export type { LineCapture, LinePort, MachineEntry } from './types';

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
  type: PlaceableNodeType,
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
          kind: 'single',
          machine: '',
          inputs: [],
          outputs: [],
          voltage: 'LV',
          amperage: 1,
          multiplier: 1,
          eu: 0,
          time: 0,
        },
      };
    case 'inputNode':
      return { ...base, type, data: { name: 'Input', quantity: 0 } };
    case 'outputNode':
      return { ...base, type, data: { name: 'Output', quantity: 0 } };
    case 'byproductNode':
      return { ...base, type, data: { name: 'Byproduct', quantity: 0 } };
  }
};

// backfill fields added after some graphs were already persisted — `multiplier`,
// `eu`, `time` and `kind` are absent from recipe nodes saved before they existed;
// default them on load so older lines keep working. every pre-existing recipe was
// a singleblock, which is also the no-overclock behaviour, so that default is safe.
// fields are listed explicitly so a node switched between machine shapes cannot
// carry the other shape's leftovers around
// every field either machine shape has ever persisted, all optional. spelled out
// rather than derived from the two arms: `Omit`/`Pick` over a type carrying a
// `Record<string, unknown>` index signature throws the named properties away
interface PersistedRecipe {
  name?: string;
  machine?: string;
  inputs?: RecipeItem[];
  outputs?: RecipeItem[];
  multiplier?: number;
  eu?: number;
  time?: number;
  kind?: RecipeKind;
  voltage?: VoltageTier;
  amperage?: number;
  // `amps` is optional here and required on EnergyHatch: a hatch saved before
  // it existed has none, and filling it in is what the backfill is for
  hatches?: (Omit<EnergyHatch, 'amps'> & { amps?: number })[];
  config?: MachineConfig;
  recipeHeat?: number;
  parallelLimit?: number;
  // v1, read-only forever. a Yjs snapshot from last year still arrives
  // tomorrow, and it will still carry these two
  overclock?: 'imperfect' | 'perfect';
  parallels?: number;
}

// whether a persisted recipe is missing anything, or still carries fields from
// the machine shape it is no longer. checked first so an already-current node is
// returned by identity — this runs on every remote collab update, and handing
// back fresh `data` objects each time would re-render the whole canvas
const needsBackfill = (data: PersistedRecipe): boolean =>
  data.kind === undefined ||
  data.multiplier === undefined ||
  data.eu === undefined ||
  data.time === undefined ||
  data.amperage === undefined ||
  (data.kind === 'multi'
    ? data.hatches === undefined ||
      data.voltage !== undefined ||
      // every hatch needs its amperage, and the two v1 fields have to go —
      // they are what the old heuristic read, and the machine catalog now
      // declares both the overclock ratio and the parallel cap
      data.hatches.some(hatch => hatch.amps === undefined) ||
      data.overclock !== undefined ||
      data.parallels !== undefined
    : data.voltage === undefined || data.hatches !== undefined);

export const normalizeNodes = (nodes: ProductionNode[]): ProductionNode[] =>
  nodes.map(persisted => {
    // byproduct nodes were called disposal nodes, and graphs saved under that
    // name still carry the old discriminator. without this they decode to a
    // type React Flow has no renderer for and drop out of the line silently
    const node: ProductionNode =
      (persisted.type as string) === 'disposalNode'
        ? ({ ...persisted, type: 'byproductNode' } as ProductionNode)
        : persisted;

    if (node.type !== 'recipeNode') return node;
    const data = node.data as PersistedRecipe;
    if (!needsBackfill(data)) return node;

    const shared = {
      name: data.name ?? 'Recipe',
      machine: data.machine ?? '',
      inputs: data.inputs ?? [],
      outputs: data.outputs ?? [],
      multiplier: data.multiplier ?? 1,
      eu: data.eu ?? 0,
      time: data.time ?? 0,
      amperage: data.amperage ?? 1,
    };

    return {
      ...node,
      data:
        data.kind === 'multi'
          ? {
              ...shared,
              kind: 'multi' as const,
              // a multiblock saved before hatches existed described its supply
              // as a tier plus an amp count, which is one hatch group
              hatches: (
                data.hatches ?? [{ tier: data.voltage ?? 'LV', count: 1 }]
              ).map(hatch => ({
                ...hatch,
                amps: hatch.amps ?? DEFAULT_HATCH_AMPS,
              })),
              // `overclock` and `parallels` are deliberately not carried over.
              // the catalog declares the overclock ratio, and the real machine
              // cap replaces a number someone typed in — see decision 7 in
              // MULTIBLOCK_PORT.md. spread conditionally, because writing
              // `config: undefined` puts an explicit undefined key in the
              // object, which survives JSON.stringify inconsistently across the
              // historyKey, isDeepEqual and Yjs paths and shows up as spurious
              // history entries
              ...(data.config === undefined ? {} : { config: data.config }),
              ...(data.recipeHeat === undefined
                ? {}
                : { recipeHeat: data.recipeHeat }),
              ...(data.parallelLimit === undefined
                ? {}
                : { parallelLimit: data.parallelLimit }),
            }
          : {
              ...shared,
              kind: 'single' as const,
              voltage: data.voltage ?? 'LV',
            },
    };
  });

// the tier a machine is represented by in per-tier groupings. a multiblock can
// in principle be fed by mixed hatches, in which case its highest tier stands
// for it
export const machineTier = (data: RecipeNodeData): VoltageTier =>
  data.kind === 'single'
    ? data.voltage
    : (data.hatches.reduce<VoltageTier | undefined>(
        (best, hatch) =>
          best === undefined || TIER_EU[hatch.tier] > TIER_EU[best]
            ? hatch.tier
            : best,
        undefined,
      ) ?? 'LV');

// amps the recipe draws. shared by both machine shapes — a multiblock recipe can
// require several amps just as a singleblock one can
export const machineAmps = (data: RecipeNodeData): number => data.amperage;

// fallback node size when React Flow hasn't measured a node yet
const DEFAULT_NODE_SIZE = { width: 400, height: 160 };

// elk.bundled.js is a ~1.4MB GWT blob — load it only when a layout is actually
// requested (an explicit user action), not in the initial app bundle. cached
// after first use.
let elkInstance:
  | Promise<InstanceType<typeof import('elkjs/lib/elk.bundled.js').default>>
  | undefined;
const getElk = () =>
  (elkInstance ??= import('elkjs/lib/elk.bundled.js').then(
    module => new module.default(),
  ));

// where a recipe node's handles actually sit, measured from the DOM: node id
// -> handle id -> centre offset from the node's top-left. feeding these to ELK
// lets it route around nodes with the same geometry React Flow draws
export type HandleOffsets = Map<string, Map<string, Waypoint>>;

// ELK resolves an edge's endpoint by port id across the WHOLE graph, while a
// handle id is only unique within its node — and a sub-line's ports are named
// after the items they carry, so two lines that both move Hydrogen offer the
// same handle id. Unnamespaced, ELK hands both edges to whichever node it saw
// first and routes them from a machine that has nothing to do with them.
const portId = (nodeId: string, handleId: string): string =>
  `${nodeId}::${handleId}`;

// arrange the graph into left-to-right layers with ELK and keep the routes it
// computes. recipe input/output handles become ports (inputs WEST, outputs
// EAST), placed at their measured offsets when those are known so ELK's
// orthogonal routing lines up with the real handles; otherwise they are merely
// fixed in order. the bend points ELK returns are written onto each edge as
// waypoints, which is what stops edges cutting through nodes and each other.
// uses measured sizes (falls back to a default); ELK returns top-left positions
export const layoutNodes = async (
  nodes: ProductionNode[],
  edges: Edge[],
  handleOffsets?: HandleOffsets,
): Promise<{ nodes: ProductionNode[]; edges: Edge[] }> => {
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      // orthogonal routing is the point of all this: ELK then owns the bend
      // points, routing them through the gaps instead of over the nodes
      'elk.edgeRouting': 'ORTHOGONAL',
      // wider layer gaps than nodes need, because the gaps are also where the
      // edge lanes live — too tight and ELK stacks routes on top of each other
      'elk.layered.spacing.nodeNodeBetweenLayers': '160',
      'elk.spacing.nodeNode': '48',
      'elk.spacing.edgeNode': '24',
      'elk.spacing.edgeEdge': '16',
      'elk.layered.spacing.edgeNodeBetweenLayers': '24',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '16',
      // never bundle two edges onto one shared segment: on a production line
      // two overlapping routes read as one wire feeding the wrong machine
      'elk.layered.mergeEdges': 'false',
      'elk.layered.thoroughness': '20',
    },
    children: nodes.map(node => {
      const base = {
        id: node.id,
        width: node.measured?.width ?? DEFAULT_NODE_SIZE.width,
        height: node.measured?.height ?? DEFAULT_NODE_SIZE.height,
      };
      // recipes and collapsed sub-lines both hang their edges off per-item
      // handles; everything else is a single anchor ELK needs no ports for
      const items = nodeItems(node);
      if (items === undefined) return base;

      const offsets = handleOffsets?.get(node.id);
      const port = (
        id: string,
        side: 'WEST' | 'EAST',
        index: number,
      ): ElkPort => {
        const at = offsets?.get(id);
        return at
          ? {
              id: portId(node.id, id),
              x: at.x,
              y: at.y,
              width: 0,
              height: 0,
              layoutOptions: { 'elk.port.side': side },
            }
          : {
              id: portId(node.id, id),
              layoutOptions: {
                'elk.port.side': side,
                'elk.port.index': String(index),
              },
            };
      };

      // ELK numbers ports clockwise: WEST runs bottom->top (invert the row
      // index), EAST runs top->bottom (row index as-is)
      const ports = [
        ...items.inputs.map((input, i) =>
          port(input.id, 'WEST', items.inputs.length - 1 - i),
        ),
        ...items.outputs.map((output, i) => port(output.id, 'EAST', i)),
      ];
      // a sub-line that both produces and sheds the same item offers that port
      // twice; ELK refuses a repeated port id, and the second one would draw on
      // top of the first anyway
      const unique = [...new Map(ports.map(p => [p.id, p])).values()];
      // measured offsets pin each port exactly; without them all we can state
      // is the order the rows appear in
      const known = unique.every(p => p.x !== undefined);
      return {
        ...base,
        ports: unique,
        layoutOptions: {
          'elk.portConstraints': known ? 'FIXED_POS' : 'FIXED_ORDER',
        },
      };
    }),
    edges: edges.map(edge => ({
      id: edge.id,
      sources: [
        edge.sourceHandle
          ? portId(edge.source, edge.sourceHandle)
          : edge.source,
      ],
      targets: [
        edge.targetHandle
          ? portId(edge.target, edge.targetHandle)
          : edge.target,
      ],
    })),
  };

  const elk = await getElk();
  const laid = await elk.layout(graph);
  const positions = new Map(laid.children?.map(child => [child.id, child]));

  // ELK reports a route as sections of start/bend/end points in root
  // coordinates — the same space as node positions, and as edge waypoints.
  // only the bends are ours to keep: React Flow anchors the ends at the live
  // handle positions itself
  const routes = new Map(
    laid.edges?.map(edge => [
      edge.id,
      (edge.sections ?? []).flatMap(section => section.bendPoints ?? []),
    ]),
  );

  return {
    nodes: nodes.map(node => {
      const child = positions.get(node.id);
      return child
        ? { ...node, position: { x: child.x ?? 0, y: child.y ?? 0 } }
        : node;
    }),
    edges: edges.map(edge => {
      const bends = routes.get(edge.id);
      // a route with no bends is a straight shot — drop the waypoints so the
      // edge falls back to its default path rather than carrying stale ones
      return {
        ...edge,
        data: {
          ...edge.data,
          points: bends?.length
            ? bends.map(p => ({ x: p.x, y: p.y }))
            : undefined,
        },
      };
    }),
  };
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

// update data of a single collapsed sub-line node, leaving other nodes untouched
export const mapLine = (
  nodes: ProductionNode[],
  nodeId: string,
  update: (data: LineNodeData) => LineNodeData,
): ProductionNode[] =>
  nodes.map(node =>
    node.id === nodeId && node.type === 'lineNode'
      ? { ...node, data: update(node.data) }
      : node,
  );

// sink (output/byproduct) nodes mirror a recipe output they receive
export const SINK_TYPES = new Set<ProductionNodeType>([
  'outputNode',
  'byproductNode',
]);

// how many times over a recipe's listed item quantities actually move per pass:
// its sequential cycles times the concurrent recipes its machine runs. parallels
// raise throughput without lengthening the cycle, so they scale I/O exactly as
// the cycle count does
export const recipeScale = (data: RecipeNodeData): number =>
  data.multiplier * overclock(data).parallels;

// what one recipe row moves per pass of its node — the unit every balance check
// has always worked in
export const itemPerPass = (data: RecipeNodeData, item: RecipeItem): number =>
  item.quantity * recipeScale(data);

// items per SECOND one recipe row moves. `multiplier` cancels out of this:
// running a recipe twice in sequence moves twice as much over twice the
// wall-clock, so the rate is unchanged. parallels do not cancel — they raise
// throughput without lengthening the cycle, which is the whole point of them
export const itemRate = (data: RecipeNodeData, item: RecipeItem): number => {
  const { time, parallels } = overclock(data);

  // an unfilled duration is already reported as `incomplete`; answer "no
  // throughput" rather than dividing by zero and poisoning every sum downstream
  return time > 0 ? (item.quantity * parallels) / time : 0;
};

// the items a node offers the graph as handles, and how many times over it
// moves them per pass. Two node types have them: a recipe, whose rows are the
// items themselves, and a collapsed sub-line, whose ports are a whole line's
// worth of I/O. Everything downstream of this — balance, mirrors, validation —
// asks this question and no longer cares which of the two it is holding
export const nodeItems = (
  node: ProductionNode,
):
  | {
      inputs: readonly RecipeItem[];
      outputs: readonly RecipeItem[];
      scale: number;
    }
  | undefined => {
  if (node.type === 'recipeNode')
    return {
      inputs: node.data.inputs,
      outputs: node.data.outputs,
      scale: recipeScale(node.data),
    };

  if (node.type === 'lineNode')
    return {
      inputs: node.data.capture.inputs,
      // a sub-line's byproducts leave by the same side as its products. They
      // are listed after them so the handles keep a stable order, and the
      // parent decides what to do with them like any other leftover
      outputs: [...node.data.capture.outputs, ...node.data.capture.byproducts],
      scale: node.data.multiplier,
    };

  return undefined;
};

// `${nodeId}:${itemId}` -> item, indexed for both inputs and outputs, plus each
// node's item scale (a recipe's cycles x parallels, a sub-line's copies)
interface ItemIndex {
  outputs: Map<string, RecipeItem>;
  inputs: Map<string, RecipeItem>;
  scales: Map<string, number>;
}

const indexItems = (nodes: ProductionNode[]): ItemIndex => {
  const outputs = new Map<string, RecipeItem>();
  const inputs = new Map<string, RecipeItem>();
  const scales = new Map<string, number>();

  for (const node of nodes) {
    const items = nodeItems(node);
    if (items === undefined) continue;

    scales.set(node.id, items.scale);
    for (const output of items.outputs)
      outputs.set(`${node.id}:${output.id}`, output);
    for (const input of items.inputs)
      inputs.set(`${node.id}:${input.id}`, input);
  }

  return { outputs, inputs, scales };
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
    // the consumer's own scale decides the amount — a recipe's cycles and
    // parallels per pass, or the copies a sub-line node is built in
    const scale = index.scales.get(edge.target);
    if (scale === undefined) continue;
    const key = `${edge.source}:${edge.sourceHandle}`;
    demand.set(key, (demand.get(key) ?? 0) + input.quantity * scale);
  }

  return demand;
};

// per recipe-input handle, Σ what the recipe outputs wired into it actually
// deliver. Two rules make a loop's contribution a number rather than a wish: an
// output never delivers more than it makes, and one that is over-subscribed is
// shared out in proportion to what each consumer asked for. keyed
// `${target}:${targetHandle}`
const supplyByInput = (
  index: ItemIndex,
  edges: Edge[],
): Map<string, number> => {
  const claims = demandByOutput(index, edges);
  const supplied = new Map<string, number>();

  for (const edge of edges) {
    if (!edge.sourceHandle || !edge.targetHandle) continue;
    const output = recipeItem(index, edge.source, edge.sourceHandle, 'outputs');
    const input = recipeItem(index, edge.target, edge.targetHandle, 'inputs');
    if (output === undefined || input === undefined) continue;

    const sourceScale = index.scales.get(edge.source);
    const targetScale = index.scales.get(edge.target);
    if (sourceScale === undefined || targetScale === undefined) continue;

    const asked = input.quantity * targetScale;
    const claimed = claims.get(`${edge.source}:${edge.sourceHandle}`) ?? 0;
    // `claimed` is the sum this edge's `asked` is part of, so it is only zero
    // when nothing was asked at all
    if (asked <= 0 || claimed <= 0) continue;

    const made = output.quantity * sourceScale;
    const delivered = Math.min(made, claimed) * (asked / claimed);

    const key = `${edge.target}:${edge.targetHandle}`;
    supplied.set(key, (supplied.get(key) ?? 0) + delivered);
  }

  return supplied;
};

// a connection is valid unless it joins two recipe items whose names disagree.
// leaf connections (input-node -> recipe, recipe -> sink) always mirror, so are
// always allowed. names compared case-insensitively, trimmed; empty can't match
export const isValidConnection = (
  nodes: ProductionNode[],
  connection: Connection | Edge,
): boolean => {
  const index = indexItems(nodes);
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

// drop edges already occupying the single leaf slot that `connection` claims —
// a sink mirrors one incoming edge, an input leaf emits one — so a new edge to
// that endpoint evicts the old. `keepId` is preserved (the edge being
// reconnected onto the slot is the one we're keeping, not evicting)
export const freeSingleSlot = (
  nodes: ProductionNode[],
  edges: Edge[],
  connection: Connection | Edge,
  keepId?: string,
): Edge[] => {
  const targetIsSink = nodes.some(
    node => node.id === connection.target && SINK_TYPES.has(node.type),
  );
  const sourceIsInput = nodes.some(
    node => node.id === connection.source && node.type === 'inputNode',
  );

  return edges.filter(
    edge =>
      edge.id === keepId ||
      (!(targetIsSink && edge.target === connection.target) &&
        !(sourceIsInput && edge.source === connection.source)),
  );
};

// sync every mirror leaf's name + quantity to its connected recipe item:
//   - sinks (output/byproduct) mirror the upstream recipe OUTPUT they receive,
//     but only the leftover quantity after downstream recipes take their share
//     (may go negative -> visible over-draw warning)
//   - input nodes mirror the downstream recipe INPUT they feed, less whatever
//     a recipe already delivers into that same handle — an item a line loops
//     back into itself is fed once, not twice
// recipe->recipe edges are left untouched (recipes are the editable source of
// truth); leaves with no connecting edge keep their current values
export const syncMirrors = (
  nodes: ProductionNode[],
  edges: Edge[],
): ProductionNode[] => {
  const index = indexItems(nodes);
  const demand = demandByOutput(index, edges);
  const supplied = supplyByInput(index, edges);

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
        const supply = output.quantity * (index.scales.get(edge.source) ?? 1);
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
      if (input !== undefined) {
        const needed = input.quantity * (index.scales.get(edge.target) ?? 1);
        const loop = supplied.get(`${edge.target}:${edge.targetHandle}`) ?? 0;
        mirrors.set(edge.source, {
          name: input.name,
          // the shortfall, never a negative amount to carry in: an output that
          // loops back MORE than the input needs is over-production, and it is
          // the source's own `surplus` that says so
          quantity: Math.max(0, needed - loop),
        });
      }
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

// items are free text, so item identity is a normalized key: trimmed,
// lowercased, internal runs of whitespace collapsed. deliberately no looser
// than that — stripping plurals or punctuation would merge items that differ
export const itemKey = (name: string): string =>
  name.trim().toLowerCase().replace(/\s+/g, ' ');

// rates are divisions, so an item that balances exactly can still land a few
// ULPs off zero. without a tolerance that dust reads as a real imbalance
const NET_EPSILON = 1e-9;

// the same tolerance for per-PASS amounts, which is what the wired-mode balance
// check compares. a fractional row — how a chance-based output is written — makes
// those amounts floats too, and 3 runs of 0.8 lands a hair off 2.4, which reads
// as a deficit and a surplus of the same item at once. it scales with the
// amounts because float dust does: an epsilon that suits 2.4 is far too tight
// against a stargate line's millions
const balanceEpsilon = (supply: number, demand: number): number =>
  Math.max(Math.abs(supply), Math.abs(demand), 1) * NET_EPSILON;

// a problem found by validateGraph (run on demand, not while editing)
export interface GraphIssue {
  recipe: string; // recipe node display name (receiver for deficit, else owner)
  item: string; // item name (or the missing field, for `incomplete`)
  kind:
    | 'deficit'
    | 'surplus'
    | 'unfed'
    | 'incomplete'
    | 'mismatch'
    | 'underpowered'
    | 'underheated'
    | 'throttled'
    | 'overparallel'
    | 'unmodeled';
  // deficit/surplus: the output's quantity and the demand on it
  // overparallel: the parallels running under the node's ceiling, and the cap
  //   the machine would otherwise have run
  // underheated: the machine's heat and the recipe's, both in K
  supply?: number;
  demand?: number;
}

// recipe fields that must be filled for the line to be computable, paired with
// the test that flags them as missing. `incomplete` issues report one per gap.
const REQUIRED_RECIPE_FIELDS: {
  label: string;
  missing: (data: RecipeNodeData) => boolean;
}[] = [
  { label: 'name', missing: data => data.name.trim() === '' },
  { label: 'energy (EU)', missing: data => data.eu <= 0 },
  { label: 'duration', missing: data => data.time <= 0 },
];

// overclock, heat and parallel problems on a recipe node, each phrased as the
// thing the user can act on. The kernel already decided what happened; this
// only picks which of its answers are worth interrupting someone about
const overclockIssues = (data: RecipeNodeData): GraphIssue[] => {
  const recipe = data.name.trim() === '' ? 'Unnamed recipe' : data.name;
  const result = overclock(data);
  const issues: GraphIssue[] = [];

  // a machine parameter the catalog marks required and the node never set. it
  // runs on the declared default meanwhile, which for an EBF is Cupronickel —
  // a real answer, but not this machine's
  if (data.kind === 'multi')
    for (const param of result.machine.parameters)
      if (param.required === true && data.config?.[param.id] === undefined)
        issues.push({ recipe, item: param.label, kind: 'incomplete' });

  // GT would not accept the recipe at all: it matches on heat before anything
  // else. reported ahead of power, because it is the harder stop of the two
  if (result.underheated)
    issues.push({
      recipe,
      item: result.machine.name === '' ? 'heat' : result.machine.name,
      kind: 'underheated',
      supply: result.heat.machine,
      demand: result.heat.recipe,
    });

  // the supply cannot pay for even one recipe, so nothing runs
  if (result.underpowered)
    issues.push({
      recipe,
      item: `${result.supply} supplied, ${result.demand} required`,
      kind: 'underpowered',
    });

  // a ceiling the user set, holding the machine below what it would otherwise
  // run. deliberate, so it is a reminder rather than a fault — and it fires
  // only when someone actually filled the field in
  if (result.parallel.limitedBy === 'node')
    issues.push({
      recipe,
      item: 'parallel limit',
      kind: 'overparallel',
      supply: result.parallel.running,
      demand: result.parallel.effectiveCap,
    });

  // overclocks that bought nothing and were charged for anyway — GT takes
  // 4^n whether or not the duration moved. Two ways it happens: a cap refused
  // ones the supply would have paid for, or the one tick floor swallowed the
  // time ones already applied would have saved. the second is a singleblock
  // problem; on a multiblock those come back as parallels, which is exactly
  // what a sub-tick multiplier above 1 means
  const spentForNothing =
    result.oc.wasted + (result.parallel.subTick > 1 ? 0 : result.oc.floored);

  if (spentForNothing > 0)
    issues.push({
      recipe,
      item: `${spentForNothing} overclock${spentForNothing > 1 ? 's' : ''}`,
      kind: 'throttled',
    });

  // a name the catalog never heard of, or one the extractor could not read out
  // of GT's source. either way the numbers below it are a guess
  if (
    data.kind === 'multi' &&
    !(result.machine.known && result.machine.modeled)
  )
    issues.push({
      recipe,
      item: data.machine === '' ? 'machine' : data.machine,
      kind: 'unmodeled',
    });

  return issues;
};

// check quantity balance between recipes:
//   - deficit: a recipe output feeds downstream recipes that demand more than
//     it produces (reported against each RECEIVING recipe)
//   - surplus: a recipe output has leftover quantity (incl. fully unconnected)
//     with no sink to absorb it
//   - unfed: a recipe input has no incoming edge (no source at all)
//
// everything else here — missing fields, name mismatches, and the machine
// problems `overclockIssues` finds — is about the recipe DATA rather than the
// wiring.
export const validateGraph = (
  nodes: ProductionNode[],
  edges: Edge[],
): GraphIssue[] => {
  const index = indexItems(nodes);
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
  // output handle key -> ids of the recipes it feeds, minus any whose input
  // handle an input leaf tops up
  const receivers = new Map<string, Set<string>>();

  // input handle keys an input leaf feeds. A leaf carries in exactly the
  // shortfall its handle is left with (see syncMirrors), so a handle in here
  // cannot be short however little the recipes wired into it deliver — the
  // deficit belongs to whatever ELSE that output owes, not to this receiver
  const inputIds = new Set(
    nodes.filter(node => node.type === 'inputNode').map(node => node.id),
  );
  const toppedUp = new Set(
    edges
      .filter(edge => edge.targetHandle && inputIds.has(edge.source))
      .map(edge => `${edge.target}:${edge.targetHandle ?? ''}`),
  );

  for (const edge of edges) {
    if (edge.targetHandle) fed.add(`${edge.target}:${edge.targetHandle}`);
    if (!edge.sourceHandle) continue;
    const key = `${edge.source}:${edge.sourceHandle}`;
    if (sinkIds.has(edge.target)) absorbed.add(key);

    const output = recipeItem(index, edge.source, edge.sourceHandle, 'outputs');
    const input =
      edge.targetHandle &&
      recipeItem(index, edge.target, edge.targetHandle, 'inputs');

    if (input) {
      if (!toppedUp.has(`${edge.target}:${edge.targetHandle ?? ''}`)) {
        let set = receivers.get(key);
        if (set === undefined) receivers.set(key, (set = new Set()));
        set.add(edge.target);
      }

      // a recipe<->recipe edge whose two item names disagree — usually the
      // aftermath of renaming one side; the link is kept but flagged here
      if (output) {
        const a = output.name.trim().toLowerCase();
        const b = input.name.trim().toLowerCase();
        if (a !== b)
          issues.push({
            recipe: names.get(edge.source) ?? '',
            item: `"${output.name}" → "${input.name}"`,
            kind: 'mismatch',
          });
      }
    }
  }

  for (const node of nodes) {
    if (node.type === 'recipeNode') {
      // missing recipe fields the metrics depend on (name / energy / duration)
      for (const field of REQUIRED_RECIPE_FIELDS)
        if (field.missing(node.data))
          issues.push({
            recipe:
              node.data.name.trim() === '' ? 'Unnamed recipe' : node.data.name,
            item: field.label,
            kind: 'incomplete',
          });

      for (const issue of overclockIssues(node.data)) issues.push(issue);
    }

    // a sub-line is only as good as the line it was captured from: recipes with
    // no EU or no duration inside it are missing from its demand and its
    // critical path, and nothing about the collapsed node would otherwise say so
    if (node.type === 'lineNode' && node.data.capture.incomplete > 0)
      issues.push({
        recipe: node.data.name,
        item: `${node.data.capture.incomplete} unfilled recipe${
          node.data.capture.incomplete > 1 ? 's' : ''
        } in the source line`,
        kind: 'incomplete',
      });

    // recipes and collapsed sub-lines answer the balance questions alike — one
    // per row, the other per port covering a whole line's worth of them
    const items = nodeItems(node);
    if (items === undefined) continue;

    for (const output of items.outputs) {
      const key = `${node.id}:${output.id}`;
      const needed = demand.get(key) ?? 0;
      // produced over all runs of this recipe / copies of this sub-line
      const supply = output.quantity * items.scale;
      const slack = balanceEpsilon(supply, needed);

      if (needed > supply + slack)
        // deficit — blame each receiving recipe
        for (const recipeId of receivers.get(key) ?? [])
          issues.push({
            recipe: names.get(recipeId) ?? '',
            item: output.name,
            kind: 'deficit',
            supply,
            demand: needed,
          });
      else if (!absorbed.has(key) && supply - needed > slack)
        // leftover with nowhere to go (no sink); includes unconnected outputs
        issues.push({
          recipe: node.data.name,
          item: output.name,
          kind: 'surplus',
          supply,
          demand: needed,
        });
    }

    for (const input of items.inputs)
      if (!fed.has(`${node.id}:${input.id}`))
        issues.push({
          recipe: node.data.name,
          item: input.name,
          kind: 'unfed',
        });
  }

  return issues;
};

export { TICKS_PER_SECOND };

// a recipe's instantaneous power draw (EU/t), after any overclock its machine
// achieves. `multiplier` (sequential run count) scales TIME, not power — one
// machine still runs a single cycle at a time — so it is intentionally absent
export const recipePower = (data: RecipeNodeData): number =>
  overclock(data).power;

// a recipe node's wall-clock time: one overclocked cycle × its sequential runs
const recipeTime = (data: RecipeNodeData): number =>
  overclock(data).time * data.multiplier;

export interface LineEnergy {
  demand: number; // peak power draw (EU/t) — all recipes assumed concurrent
  time: number; // critical-path duration (seconds)
}

// peak demand and total runtime for a production line:
//   - demand: Σ EU/t over every recipe (each its own machine)
//   - time: longest dependency chain through the graph (edges = ordering).
//     independent branches run in parallel; copying a node parallelizes its
//     runs. node weight = recipeTime; leaf nodes (input/output/byproduct) weigh 0
export const lineEnergy = (
  nodes: ProductionNode[],
  edges: Edge[],
): LineEnergy => {
  let demand = 0;

  const weight = new Map<string, number>();
  for (const node of nodes) {
    if (node.type === 'recipeNode') {
      demand += recipePower(node.data);
      weight.set(node.id, recipeTime(node.data));
      continue;
    }

    // a collapsed sub-line draws what its own machines draw, and running it
    // again does not build a second set of them: cycles cost time, not power.
    // Another copy of the line is another node on the canvas
    if (node.type === 'lineNode') {
      demand += node.data.capture.demand;
      weight.set(node.id, node.data.capture.time * node.data.multiplier);
    }
  }

  // successor adjacency: an edge source must finish before its target starts
  const successors = new Map<string, string[]>();
  for (const edge of edges) {
    let list = successors.get(edge.source);
    if (list === undefined) successors.set(edge.source, (list = []));
    list.push(edge.target);
  }

  return { demand, time: longestPath(successors, weight, nodes) };
};

// longest path ending-inclusive at each node, memoized; `visiting` guards
// against cycles (a malformed graph) by treating the back-edge as weight 0
const longestPath = (
  successors: Map<string, string[]>,
  weight: Map<string, number>,
  nodes: ProductionNode[],
): number => {
  const longest = new Map<string, number>();
  const visiting = new Set<string>();

  const walk = (id: string): number => {
    const cached = longest.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;

    visiting.add(id);
    let downstream = 0;
    for (const next of successors.get(id) ?? [])
      downstream = Math.max(downstream, walk(next));
    visiting.delete(id);

    const total = (weight.get(id) ?? 0) + downstream;
    longest.set(id, total);
    return total;
  };

  let time = 0;
  for (const node of nodes) time = Math.max(time, walk(node.id));

  return time;
};

// electric load at a voltage tier: total power draw and peak single-machine
// amperage. a generator outputs exactly 1A, so a machine drawing N amps needs N
// generators feeding it — the tier therefore needs at least `amps` (the highest
// single machine's draw) generators, regardless of how the power total divides
export interface TierDemand {
  power: number; // EU/t summed over machines at this tier
  amps: number; // highest amperage of any single machine at this tier
}

// electric demand split by machine voltage tier. a generator may only power a
// machine of its own tier — overvolting makes machines explode — so generators
// must be sized per bucket, not against the lumped total
export const demandByTier = (
  nodes: ProductionNode[],
): Map<VoltageTier, TierDemand> => {
  const byTier = new Map<VoltageTier, TierDemand>();

  const add = (tier: VoltageTier, power: number, amps: number) => {
    const current = byTier.get(tier) ?? { power: 0, amps: 0 };
    current.power += power;
    current.amps = Math.max(current.amps, amps);
    byTier.set(tier, current);
  };

  for (const node of nodes) {
    // a sub-line arrives with its buckets already split — it was summed over
    // the machines inside it when it was captured
    if (node.type === 'lineNode') {
      for (const tier of node.data.capture.tiers)
        // its cycle count changes how long those machines run, not how many
        // there are or what any one of them pulls
        add(tier.tier, tier.power, tier.amps);
      continue;
    }

    if (node.type !== 'recipeNode') continue;
    const power = recipePower(node.data);
    if (power <= 0) continue;

    if (node.data.kind === 'single') {
      add(node.data.voltage, power, node.data.amperage);
      continue;
    }

    // a multiblock draws through its hatches, so each tier carries the share of
    // the load its own hatches can deliver
    const total = hatchVoltage(node.data.hatches);
    for (const hatch of node.data.hatches)
      add(
        hatch.tier,
        total > 0 ? power * ((TIER_EU[hatch.tier] * hatch.count) / total) : 0,
        node.data.amperage,
      );
  }

  return byTier;
};

// a named amount on a leaf node (input / output / byproduct)
export interface Entry {
  name: string;
  quantity: number;
}

// the aggregate profile of a whole line, used to compare alternatives side by
// side. leaf quantities are resolved through syncMirrors first (so they reflect
// the recipes that feed/drain them); time + demand reuse lineEnergy.
export interface LineMetrics {
  inputs: Entry[];
  outputs: Entry[];
  byproducts: Entry[];
  machines: MachineEntry[];
  time: number; // critical-path seconds
  demand: number; // peak EU/t
  // recipes missing the EU or the duration every figure here is built from. A
  // line with any of these has holes in `demand` and `time`, and printing the
  // resulting 0 as though it were a measurement is how an unfilled node wins a
  // comparison it never ran
  incomplete: number;
}

// tally one machine entry into a list, merging on machine + tier. the same
// machine at two voltages is two builds, so the tier is part of the identity
const addMachine = (machines: MachineEntry[], entry: MachineEntry) => {
  const found = machines.find(
    x => x.machine === entry.machine && x.voltage === entry.voltage,
  );

  if (found) found.quantity += entry.quantity;
  else machines.push({ ...entry });
};

// leaf tallies merged per item, keyed by `itemKey` so two spellings of one item
// do not become two ports. The key is also the handle id, which is what keeps a
// refreshed sub-line's edges attached — see `LinePort`
const toPorts = (entries: Entry[]): LinePort[] => {
  const byKey = new Map<string, LinePort>();

  for (const entry of entries) {
    const id = itemKey(entry.name);
    // a leaf nobody named has no port to offer — it would collide with every
    // other unnamed one and answer for none of them
    if (id === '') continue;

    const port = byKey.get(id);
    if (port) port.quantity += entry.quantity;
    else
      byKey.set(id, { id, name: entry.name.trim(), quantity: entry.quantity });
  }

  // a port for nothing is nothing to wire. Half-built lines are full of leaves
  // that are not connected to anything yet, and each one would otherwise arrive
  // in the parent graph as a handle asking to be fed zero of something
  return [...byKey.values()].filter(port => port.quantity > 0);
};

// read a saved line down to the contract a collapsed node exposes: what it must
// be fed, what it hands back, and what it costs to run.
//
// The amounts are per PASS of the source line, the same unit the parent graph's
// balance arithmetic works in, so a sub-line's port wires to a recipe row with
// no conversion between them.
export const captureLine = (
  nodes: ProductionNode[],
  edges: Edge[],
): LineCapture => {
  const { inputs, outputs, byproducts, machines, time, demand, incomplete } =
    lineMetrics(nodes, edges);

  return {
    inputs: toPorts(inputs),
    outputs: toPorts(outputs),
    byproducts: toPorts(byproducts),
    machines,
    tiers: [...demandByTier(nodes).entries()].map(([tier, entry]) => ({
      tier,
      power: entry.power,
      amps: entry.amps,
    })),
    demand,
    time,
    incomplete,
  };
};

export const lineMetrics = (
  nodes: ProductionNode[],
  edges: Edge[],
): LineMetrics => {
  const synced = syncMirrors(nodes, edges);

  const inputs: Entry[] = [];
  const outputs: Entry[] = [];
  const byproducts: Entry[] = [];
  const machines: MachineEntry[] = [];

  for (const node of synced) {
    switch (node.type) {
      case 'inputNode':
        inputs.push({ name: node.data.name, quantity: node.data.quantity });
        break;
      case 'outputNode':
        outputs.push({ name: node.data.name, quantity: node.data.quantity });
        break;
      case 'byproductNode':
        byproducts.push({ name: node.data.name, quantity: node.data.quantity });
        break;
      case 'recipeNode':
        addMachine(machines, {
          machine: node.data.machine,
          quantity: 1,
          voltage: machineTier(node.data),
        });
        break;
      // the whole point of collapsing a line: the machines inside it are still
      // machines someone has to build. One set of them, however many cycles
      // the node runs
      case 'lineNode':
        for (const entry of node.data.capture.machines)
          addMachine(machines, entry);
        break;
    }
  }

  // every gap the figures below are built on top of
  let incomplete = 0;
  for (const node of synced)
    if (
      node.type === 'recipeNode' &&
      (node.data.eu <= 0 || node.data.time <= 0)
    )
      incomplete++;
    // a sub-line's own holes are holes in this line's figures too, and they
    // travel up however many levels the nesting goes
    else if (node.type === 'lineNode')
      incomplete += node.data.capture.incomplete;

  const { demand, time } = lineEnergy(synced, edges);

  return { inputs, outputs, byproducts, machines, time, demand, incomplete };
};
