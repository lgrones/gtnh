import { type Connection, type Edge } from '@xyflow/react';

// inline import() type, not a static `import` — a static (even type-only) import
// from elkjs makes the bundler treat the module as statically loaded and refuse
// to split it out of the main chunk (INEFFECTIVE_DYNAMIC_IMPORT). this keeps the
// only elkjs reference the dynamic import() in getElk below.
type ElkNode = import('elkjs/lib/elk.bundled.js').ElkNode;

import type { MachineConfig } from '@/domain/machines/types';
import { hatchVoltage, overclock } from '@/domain/overclock';
import { TICKS_PER_SECOND, TIER_EU } from '@/domain/tiers';

import {
  DEFAULT_HATCH_AMPS,
  DRAG_HANDLE_CLASS,
  type ProductionNode,
  type ProductionNodeType,
  type EnergyHatch,
  type RecipeItem,
  type RecipeKind,
  type RecipeNodeData,
  type StorageNodeData,
  type VoltageTier,
} from './types';

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
  type: ProductionNodeType,
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
    case 'disposalNode':
      return { ...base, type, data: { name: 'Disposal', quantity: 0 } };
    case 'storageNode':
      return { ...base, type, data: { name: 'On hand', items: [] } };
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
  nodes.map(node => {
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

// arrange the graph into left-to-right layers with ELK. recipe input/output
// handles become fixed-order ports (inputs WEST, outputs EAST) so ELK orders
// nodes to keep edges aligned with each recipe's row order — minimal crossings.
// uses measured sizes (falls back to a default); ELK returns top-left positions
export const layoutNodes = async (
  nodes: ProductionNode[],
  edges: Edge[],
): Promise<ProductionNode[]> => {
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '96',
      'elk.spacing.nodeNode': '32',
    },
    children: nodes.map(node => {
      const base = {
        id: node.id,
        width: node.measured?.width ?? DEFAULT_NODE_SIZE.width,
        height: node.measured?.height ?? DEFAULT_NODE_SIZE.height,
      };
      if (node.type !== 'recipeNode') return base;

      // ELK numbers ports clockwise: WEST runs bottom->top (invert the row
      // index), EAST runs top->bottom (row index as-is)
      const ports = [
        ...node.data.inputs.map((input, i) => ({
          id: input.id,
          layoutOptions: {
            'elk.port.side': 'WEST',
            'elk.port.index': String(node.data.inputs.length - 1 - i),
          },
        })),
        ...node.data.outputs.map((output, i) => ({
          id: output.id,
          layoutOptions: {
            'elk.port.side': 'EAST',
            'elk.port.index': String(i),
          },
        })),
      ];
      return {
        ...base,
        ports,
        layoutOptions: { 'elk.portConstraints': 'FIXED_ORDER' },
      };
    }),
    edges: edges.map(edge => ({
      id: edge.id,
      sources: [edge.sourceHandle ?? edge.source],
      targets: [edge.targetHandle ?? edge.target],
    })),
  };

  const elk = await getElk();
  const laid = await elk.layout(graph);
  const positions = new Map(laid.children?.map(child => [child.id, child]));

  return nodes.map(node => {
    const child = positions.get(node.id);
    return child
      ? { ...node, position: { x: child.x ?? 0, y: child.y ?? 0 } }
      : node;
  });
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

// update data of a single storage node, leaving other nodes untouched
export const mapStorage = (
  nodes: ProductionNode[],
  nodeId: string,
  update: (data: StorageNodeData) => StorageNodeData,
): ProductionNode[] =>
  nodes.map(node =>
    node.id === nodeId && node.type === 'storageNode'
      ? { ...node, data: update(node.data) }
      : node,
  );

// sink (output/disposal) nodes mirror a recipe output they receive
export const SINK_TYPES = new Set<ProductionNodeType>([
  'outputNode',
  'disposalNode',
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

// how much of an item a recipe row accounts for, in one unit or the other
type AmountOf = (data: RecipeNodeData, item: RecipeItem) => number;

// `${recipeId}:${itemId}` -> recipe item, indexed for both inputs and outputs,
// plus each recipe's item scale (cycles x parallels) keyed by node id
interface ItemIndex {
  outputs: Map<string, RecipeItem>;
  inputs: Map<string, RecipeItem>;
  scales: Map<string, number>;
  // each recipe node's data, so a sum can be taken in any unit an `AmountOf`
  // knows how to compute rather than only the pre-baked `scales`
  data: Map<string, RecipeNodeData>;
}

const indexRecipeItems = (nodes: ProductionNode[]): ItemIndex => {
  const outputs = new Map<string, RecipeItem>();
  const inputs = new Map<string, RecipeItem>();
  const scales = new Map<string, number>();
  const data = new Map<string, RecipeNodeData>();

  for (const node of nodes) {
    if (node.type !== 'recipeNode') continue;
    scales.set(node.id, recipeScale(node.data));
    data.set(node.id, node.data);
    for (const output of node.data.outputs)
      outputs.set(`${node.id}:${output.id}`, output);
    for (const input of node.data.inputs)
      inputs.set(`${node.id}:${input.id}`, input);
  }

  return { outputs, inputs, scales, data };
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
  amount: AmountOf = itemPerPass,
): Map<string, number> => {
  const demand = new Map<string, number>();

  for (const edge of edges) {
    if (!edge.sourceHandle || !edge.targetHandle) continue;
    const input = recipeItem(index, edge.target, edge.targetHandle, 'inputs');
    if (input === undefined) continue;
    // the consuming recipe's own data decides the amount — its cycles and
    // parallels per pass, or its cycle time as well when summing rates
    const data = index.data.get(edge.target);
    if (data === undefined) continue;
    const key = `${edge.source}:${edge.sourceHandle}`;
    demand.set(key, (demand.get(key) ?? 0) + amount(data, input));
  }

  return demand;
};

// a connection is valid unless it joins two recipe items whose names disagree.
// leaf connections (input-node -> recipe, recipe -> sink) always mirror, so are
// always allowed. names compared case-insensitively, trimmed; empty can't match
export const isValidConnection = (
  nodes: ProductionNode[],
  connection: Connection | Edge,
): boolean => {
  const index = indexRecipeItems(nodes);
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
//   - sinks (output/disposal) mirror the upstream recipe OUTPUT they receive,
//     but only the leftover quantity after downstream recipes take their share
//     (may go negative -> visible over-draw warning)
//   - input nodes mirror the downstream recipe INPUT they feed
// recipe->recipe edges are left untouched (recipes are the editable source of
// truth); leaves with no connecting edge keep their current values
export const syncMirrors = (
  nodes: ProductionNode[],
  edges: Edge[],
): ProductionNode[] => {
  const index = indexRecipeItems(nodes);
  const demand = demandByOutput(index, edges);

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
      if (input !== undefined)
        mirrors.set(edge.source, {
          name: input.name,
          quantity: input.quantity * (index.scales.get(edge.target) ?? 1),
        });
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

// ---------------------------------------------------------------------------
// ME mode: one shared AE2 network instead of machine-to-machine wiring
// ---------------------------------------------------------------------------

// one item's standing in the network, summed over every machine in the line
export interface LedgerEntry {
  name: string; // display spelling (the first one seen for this key)
  produced: number; // items/sec pushed into the network
  consumed: number; // items/sec pulled back out of it
  net: number; // produced - consumed
  producedPerPass: number;
  consumedPerPass: number;
  producers: string[]; // node ids, so a panel row can point at the machines
  consumers: string[];
  // what already answers this item's shortfall, when anything does. `covered`
  // is the items/sec absorbed — Infinity for an unlimited source
  coveredBy?: 'storage' | 'free';
  covered?: number;
}

export interface MeLedger {
  required: LedgerEntry[]; // net < 0 and nothing covers it — real work
  covered: LedgerEntry[]; // short, but storage or the world already answers it
  products: LedgerEntry[]; // net > 0 — the end products and the byproducts
  balanced: LedgerEntry[]; // net ~ 0 — made and eaten inside the line
}

// GTNH hands every base unlimited water — water hatches, reservoirs, rain
// collectors. It is never the thing standing between you and a product, so the
// ledger still reports it, but never as something you must go and supply.
const FREELY_AVAILABLE = new Set(['water']);

// items are free text, so the ledger groups on a normalized key: trimmed,
// lowercased, internal runs of whitespace collapsed. deliberately no looser
// than that — stripping plurals or punctuation would merge items that differ
export const itemKey = (name: string): string =>
  name.trim().toLowerCase().replace(/\s+/g, ' ');

// rates are divisions, so an item that balances exactly can still land a few
// ULPs off zero. without a tolerance every such intermediate would be reported
// as something you must go and supply
const NET_EPSILON = 1e-9;

// what the whole line does to the ME network, per item.
//
// Edges are not wiring here — they mean "this output goes straight into that
// machine, bypassing the network". Such an edge moves exactly what the
// consuming input asks for, uncapped: a producer that cannot keep up simply
// goes net-negative and the network tops the difference up, which is what
// actually happens in game, since an input bus does not care where an item came
// from. The consequence worth knowing is that an item's NET never depends on
// how the line is wired — a direct edge only moves which machine is credited
// with it. An item piped entirely direct cancels on both sides and drops out of
// the ledger, which is the point of drawing one.
export const meLedger = (nodes: ProductionNode[], edges: Edge[]): MeLedger => {
  const index = indexRecipeItems(nodes);

  // per producing output handle, what direct pipes carry away from it
  const pipedRate = demandByOutput(index, edges, itemRate);
  const pipedPass = demandByOutput(index, edges, itemPerPass);

  // input handles fed by a direct pipe — their whole demand arrived over it, so
  // they draw nothing from the network
  const pipedInputs = new Set<string>();
  for (const edge of edges) {
    if (!edge.sourceHandle || !edge.targetHandle) continue;
    if (
      recipeItem(index, edge.target, edge.targetHandle, 'inputs') === undefined
    )
      continue;
    pipedInputs.add(`${edge.target}:${edge.targetHandle}`);
  }

  // stock the base already has. Coverage is deliberately NOT production: a
  // storage node is not a machine, so it must never make an item look like
  // something this line yields. All it decides is whether a shortfall is real
  // work or already answered
  const storageRate = new Map<string, number>();
  const storageNodes = new Map<string, string[]>();

  for (const node of nodes) {
    if (node.type !== 'storageNode') continue;

    for (const item of node.data.items) {
      const key = itemKey(item.name);
      if (key === '') continue;

      // no rate means unlimited, and Infinity absorbs any cap added beside it
      storageRate.set(
        key,
        (storageRate.get(key) ?? 0) + (item.rate ?? Infinity),
      );

      const holders = storageNodes.get(key) ?? [];
      if (!holders.includes(node.id)) holders.push(node.id);
      storageNodes.set(key, holders);
    }
  }

  const entries = new Map<string, LedgerEntry>();

  const entryFor = (name: string): LedgerEntry => {
    const key = itemKey(name);
    let found = entries.get(key);

    if (found === undefined)
      entries.set(
        key,
        (found = {
          name: name.trim(),
          produced: 0,
          consumed: 0,
          net: 0,
          producedPerPass: 0,
          consumedPerPass: 0,
          producers: [],
          consumers: [],
        }),
      );

    return found;
  };

  for (const node of nodes) {
    if (node.type !== 'recipeNode') continue;

    for (const output of node.data.outputs) {
      // an unnamed row is a half-typed recipe, not an item the network holds
      if (itemKey(output.name) === '') continue;

      const key = `${node.id}:${output.id}`;
      const rate = itemRate(node.data, output) - (pipedRate.get(key) ?? 0);
      const pass = itemPerPass(node.data, output) - (pipedPass.get(key) ?? 0);

      if (rate === 0 && pass === 0) continue;

      const entry = entryFor(output.name);
      entry.produced += rate;
      entry.producedPerPass += pass;
      if (!entry.producers.includes(node.id)) entry.producers.push(node.id);
    }

    for (const input of node.data.inputs) {
      if (itemKey(input.name) === '') continue;
      if (pipedInputs.has(`${node.id}:${input.id}`)) continue;

      const rate = itemRate(node.data, input);
      const pass = itemPerPass(node.data, input);

      if (rate === 0 && pass === 0) continue;

      const entry = entryFor(input.name);
      entry.consumed += rate;
      entry.consumedPerPass += pass;
      if (!entry.consumers.includes(node.id)) entry.consumers.push(node.id);
    }
  }

  const required: LedgerEntry[] = [];
  const covered: LedgerEntry[] = [];
  const products: LedgerEntry[] = [];
  const balanced: LedgerEntry[] = [];

  for (const entry of entries.values()) {
    entry.net = entry.produced - entry.consumed;

    if (entry.net > NET_EPSILON) {
      products.push(entry);
      continue;
    }

    if (entry.net >= -NET_EPSILON) {
      balanced.push(entry);
      continue;
    }

    // short of the item. Is anything already answering that?
    const key = itemKey(entry.name);
    const free = FREELY_AVAILABLE.has(key);
    const cover = free ? Infinity : (storageRate.get(key) ?? 0);
    const shortfall = -entry.net;

    if (cover <= 0) {
      required.push(entry);
      continue;
    }

    entry.coveredBy = free ? 'free' : 'storage';
    entry.covered = Math.min(cover, shortfall);

    // clicking the row should frame where the item comes from as well as where
    // it goes, so the storage nodes holding it count as producers for that
    for (const holder of storageNodes.get(key) ?? [])
      if (!entry.producers.includes(holder)) entry.producers.push(holder);

    if (cover + NET_EPSILON >= shortfall) {
      covered.push(entry);
      continue;
    }

    // storage helps but does not finish the job, so what is left is still work.
    // the per-pass figure is scaled by the same fraction as the rate, or the
    // panel's two columns would disagree about how much is actually outstanding
    const remaining = (shortfall - cover) / shortfall;
    entry.consumedPerPass =
      entry.producedPerPass +
      (entry.consumedPerPass - entry.producedPerPass) * remaining;
    entry.net += cover;
    required.push(entry);
  }

  // the biggest need and the biggest yield lead their sections; intermediates
  // are a reference list, so they read alphabetically
  const byNet = (a: LedgerEntry, b: LedgerEntry) =>
    Math.abs(b.net) - Math.abs(a.net);
  const byName = (a: LedgerEntry, b: LedgerEntry) =>
    a.name.localeCompare(b.name);

  required.sort(byNet);
  products.sort(byNet);
  // covered and balanced are reference lists rather than to-do lists, so they
  // read alphabetically
  covered.sort(byName);
  balanced.sort(byName);

  return { required, covered, products, balanced };
};

// Levenshtein distance between two item keys. Item names are short, so the
// rolling single-row DP is more than fast enough and needs no dependency
const editDistance = (a: string, b: string): number => {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const row = [i];

    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );

    prev = row;
  }

  return prev[b.length] ?? 0;
};

// how far apart two spellings may be and still be called the same item. Two is
// a plural plus a case slip; three starts matching genuinely different items
const SIMILAR_DISTANCE = 2;

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
    | 'unmodeled'
    | 'similar';
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
// all three are per-EDGE questions, so `meMode` drops them: on an ME network
// there is nothing to wire, an unconnected input is the normal case, and
// leftovers go into the network rather than nowhere. `meLedger` answers the
// balance question globally instead. Everything else here — missing fields,
// name mismatches, and the machine problems `overclockIssues` finds — is about
// the recipe DATA rather than the wiring, so it is reported in both modes.
export const validateGraph = (
  nodes: ProductionNode[],
  edges: Edge[],
  meMode = false,
): GraphIssue[] => {
  const index = indexRecipeItems(nodes);
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
  // output handle key -> ids of the recipes it feeds
  const receivers = new Map<string, Set<string>>();

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
      let set = receivers.get(key);
      if (set === undefined) receivers.set(key, (set = new Set()));
      set.add(edge.target);

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
    if (node.type !== 'recipeNode') continue;

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

    if (meMode) continue;

    for (const output of node.data.outputs) {
      const key = `${node.id}:${output.id}`;
      const needed = demand.get(key) ?? 0;
      // produced over all runs of this recipe
      const supply = output.quantity * recipeScale(node.data);

      if (needed > supply)
        // deficit — blame each receiving recipe
        for (const recipeId of receivers.get(key) ?? [])
          issues.push({
            recipe: names.get(recipeId) ?? '',
            item: output.name,
            kind: 'deficit',
            supply,
            demand: needed,
          });
      else if (!absorbed.has(key) && supply - needed > 0)
        // leftover with nowhere to go (no sink); includes unconnected outputs
        issues.push({
          recipe: node.data.name,
          item: output.name,
          kind: 'surplus',
          supply,
          demand: needed,
        });
    }

    for (const input of node.data.inputs)
      if (!fed.has(`${node.id}:${input.id}`))
        issues.push({
          recipe: node.data.name,
          item: input.name,
          kind: 'unfed',
        });
  }

  // ME mode's one real failure mode. The ledger groups on the item name, so two
  // spellings of one item split into a shortage of the one and a surplus of the
  // other — both phantom, and both look like real work to go and do. Flagged
  // only when the split actually happened: a near-identical pair that both
  // balance is two genuinely different items, and saying so would be noise.
  if (meMode) {
    const ledger = meLedger(nodes, edges);

    for (const short of ledger.required)
      for (const spare of ledger.products)
        if (
          editDistance(itemKey(short.name), itemKey(spare.name)) <=
          SIMILAR_DISTANCE
        )
          issues.push({
            recipe: names.get(spare.producers[0] ?? '') ?? '',
            item: `"${spare.name}" / "${short.name}"`,
            kind: 'similar',
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
  time: number; // critical-path duration (seconds) of the whole line
}

// peak demand and total runtime for a production line:
//   - demand: Σ EU/t over every recipe (each its own machine)
//   - time: longest dependency chain through the graph (edges = ordering).
//     independent branches run in parallel; copying a node parallelizes its
//     runs. node weight = recipeTime; leaf nodes (input/output/disposal) weigh 0
export const lineEnergy = (
  nodes: ProductionNode[],
  edges: Edge[],
): LineEnergy => {
  let demand = 0;

  const weight = new Map<string, number>();
  for (const node of nodes) {
    if (node.type !== 'recipeNode') continue;
    demand += recipePower(node.data);
    weight.set(node.id, recipeTime(node.data));
  }

  // successor adjacency: an edge source must finish before its target starts
  const successors = new Map<string, string[]>();
  for (const edge of edges) {
    let list = successors.get(edge.source);
    if (list === undefined) successors.set(edge.source, (list = []));
    list.push(edge.target);
  }

  // longest path ending-inclusive at each node, memoized; `visiting` guards
  // against cycles (a malformed graph) by treating the back-edge as weight 0
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

  return { demand, time };
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

// a named amount on a leaf node (input / output / disposal)
export interface Entry {
  name: string;
  quantity: number;
}

// a machine entry for the alternatives comparison
export interface MachineEntry {
  machine: string;
  quantity: number;
  voltage: VoltageTier;
}

// the aggregate profile of a whole line, used to compare alternatives side by
// side. leaf quantities are resolved through syncMirrors first (so they reflect
// the recipes that feed/drain them); time + demand reuse lineEnergy.
export interface LineMetrics {
  inputs: Entry[];
  outputs: Entry[];
  disposals: Entry[];
  machines: MachineEntry[];
  time: number; // critical-path seconds
  demand: number; // peak EU/t
}

export const lineMetrics = (
  nodes: ProductionNode[],
  edges: Edge[],
  meMode = false,
): LineMetrics => {
  const synced = syncMirrors(nodes, edges);

  const inputs: Entry[] = [];
  const outputs: Entry[] = [];
  const disposals: Entry[] = [];
  const machines: MachineEntry[] = [];

  for (const node of synced) {
    switch (node.type) {
      case 'inputNode':
        if (!meMode)
          inputs.push({ name: node.data.name, quantity: node.data.quantity });
        break;
      case 'outputNode':
        if (!meMode)
          outputs.push({ name: node.data.name, quantity: node.data.quantity });
        break;
      case 'disposalNode':
        if (!meMode)
          disposals.push({
            name: node.data.name,
            quantity: node.data.quantity,
          });
        break;
      case 'recipeNode': {
        const machine = machines.find(
          x =>
            x.machine === node.data.machine &&
            x.voltage === machineTier(node.data),
        );

        if (machine) machine.quantity++;
        else
          machines.push({
            machine: node.data.machine,
            quantity: 1,
            voltage: machineTier(node.data),
          });

        break;
      }
    }
  }

  // an ME line has no leaves to tally: what it must be fed and what it yields
  // are the two ends of the network ledger. reported per pass, which is the
  // unit a wired alternative uses, so the two can be read side by side
  if (meMode) {
    const ledger = meLedger(nodes, edges);

    for (const entry of ledger.required)
      inputs.push({
        name: entry.name,
        quantity: entry.consumedPerPass - entry.producedPerPass,
      });

    for (const entry of ledger.products)
      outputs.push({
        name: entry.name,
        quantity: entry.producedPerPass - entry.consumedPerPass,
      });
  }

  const { time, demand } = lineEnergy(synced, edges);

  return { inputs, outputs, disposals, machines, time, demand };
};
