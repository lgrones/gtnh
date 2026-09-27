import { type Edge } from '@xyflow/react';

import { overclock } from '@/domain/overclock';

import { SINK_TYPES, type ProductionNode, type RecipeItem } from './types';

// What a line does when it has been running for a while, as opposed to what one
// pass of it moves.
//
// The per-pass figures everywhere else are a RATIO: multipliers are how a line
// is written down so its recipes divide evenly. They are not a schedule. A
// machine does not wait for the pass to come round — it starts its next cycle
// the moment it has the items for one, and stops only when something upstream
// cannot keep up. So the rate a line hands an item over at is not "a pass's
// worth over a pass's duration": it is a flow, settled by whichever stage is
// narrowest, and a stage that nothing feeds into the chain simply runs at part
// duty without slowing anything beside it.
//
// The Biomass line is what this exists for: an Electrolyzer on a side branch
// has the longest cycle in the graph, and dividing by it throttled the Benzene
// three distillation towers make out of a different item entirely.

// one node's steady-state shape: what a single unit of its work consumes and
// produces, and how many of those units its machines turn over per second.
// A "unit" is one recipe for a recipe node and one pass for a collapsed
// sub-line, which is the basis each one's item quantities are already in
interface FlowNode {
  inputs: readonly RecipeItem[];
  outputs: readonly RecipeItem[];
  capacity: number;
}

// `multiplier` is deliberately absent from both figures. Running a recipe three
// times in sequence moves three times as much over three times the wall clock,
// so it cancels — it changes the ratio the line is written in, never the rate a
// machine can hold
const flowNode = (node: ProductionNode): FlowNode | undefined => {
  if (node.type === 'recipeNode') {
    const { time, parallels } = overclock(node.data);

    return {
      inputs: node.data.inputs,
      outputs: node.data.outputs,
      // parallels are concurrent recipes in one cycle, so they raise the
      // turnover; this is the same quantity `itemRate` divides by
      capacity: time > 0 ? parallels / time : 0,
    };
  }

  if (node.type === 'lineNode') {
    const { capture } = node.data;
    // a sub-line's machines keep running concurrently inside it, so what it
    // turns a pass around in is its own slowest step. Captures taken before
    // that was recorded have only the critical path
    const cycle = capture.bottleneck ?? capture.time;

    return {
      inputs: capture.inputs,
      outputs: [...capture.outputs, ...capture.byproducts],
      capacity: cycle > 0 ? 1 / cycle : 0,
    };
  }

  return undefined;
};

export interface LineRates {
  /** Units of work per second each recipe / sub-line actually turns over */
  nodes: Map<string, number>;
  /**
   * Nodes a lossy loop leaves stopped altogether. Their rate is exactly zero —
   * a loop that returns less than it consumes has no level it can run at, and
   * rounding it off at whatever round the iteration ran out on would report a
   * dead line as running a billionth of a recipe a second
   */
  dead: Set<string>;
  /**
   * `${node}:${handle}` of the input handle holding each node below its
   * machine's capacity, for the node it holds down. Absent for a node running
   * flat out. This is what says WHERE a dead loop comes up short
   */
  bound: Map<string, string>;
  /** Units of work per second each one COULD turn over, if nothing starved it */
  capacity: Map<string, number>;
  /** Items per second each leaf node carries in, or hands out */
  leaves: Map<string, number>;
  /** `${node}:${handle}` -> items per second arriving at that input handle */
  supply: Map<string, number>;
  /**
   * `${node}:${handle}` -> items per second leaving that output handle that no
   * recipe takes
   */
  spare: Map<string, number>;
}

// rates settle by division, so two that should agree can land a few ULPs apart.
// Compared RELATIVE to the rate itself, deliberately: a loop that returns 95% of
// what it consumes multiplies its own rate by 0.95 every round, and against an
// absolute tolerance those steps shrink under it long before the rate reaches
// anything — a decaying loop would report itself settled at a billionth of a
// recipe a second, which is how a line that dies out read as a line that runs
const EPSILON = 1e-9;

// has a rate moved, or is it the same number reached by a different division?
const settled = (before: number, after: number): boolean =>
  Math.abs(after - before) <=
  EPSILON * Math.max(Math.abs(before), Math.abs(after), Number.MIN_VALUE);

// the iteration is monotone in the common case — every rate starts at its
// machine's capacity and is pushed down by what feeds it — but a consumer that
// drops frees supply for the one beside it, which can push that one back up. A
// cap keeps a graph that ping-pongs between two allocations from spinning; in
// practice a line settles in a handful of rounds
const MAX_ROUNDS = 64;

// a loop that returns less of an item than it consumes has no fixed point above
// zero: every round multiplies the rates in it by the same fraction, so the
// iteration never stops, it only gets smaller. Whatever is still coming down
// when the rounds run out is settled at zero and the rest re-solved around it —
// each pass stops at least one node, and a line has only so many loops in it
const MAX_PASSES = 8;

/**
 * What every node and leaf of a line does per second once it is running.
 *
 * Each recipe starts at what its machine could hold and is then held down by
 * whatever feeds it: an input handle can only pass on what arrives, and an
 * output that several recipes draw on is shared between them in proportion to
 * what each one asks for. An input leaf is not a limit — it stands for the
 * outside world topping the handle up, exactly as it does per pass.
 *
 * A node whose every input is topped up that way is held down from the other
 * side instead: the outside world hands it what it asks for, so it asks for
 * what the line can take (see `sourced`). Nothing else is demand-driven — a
 * stage that cannot keep up with the one above it does not slow it down, the
 * items back up, which is what `spare` reports.
 */
export const steadyRates = (
  nodes: ProductionNode[],
  edges: Edge[],
): LineRates => {
  const flow = new Map<string, FlowNode>();
  for (const node of nodes) {
    const shape = flowNode(node);
    if (shape !== undefined) flow.set(node.id, shape);
  }

  const item = (
    nodeId: string,
    handleId: string | null | undefined,
    kind: 'inputs' | 'outputs',
  ): RecipeItem | undefined =>
    handleId
      ? flow.get(nodeId)?.[kind].find(entry => entry.id === handleId)
      : undefined;

  // edges between two flow nodes, indexed from both ends
  const incoming = new Map<string, Edge[]>();
  const outgoing = new Map<string, Edge[]>();

  for (const edge of edges) {
    if (
      item(edge.source, edge.sourceHandle, 'outputs') === undefined ||
      item(edge.target, edge.targetHandle, 'inputs') === undefined
    )
      continue;

    const into = `${edge.target}:${edge.targetHandle ?? ''}`;
    const from = `${edge.source}:${edge.sourceHandle ?? ''}`;
    incoming.set(into, [...(incoming.get(into) ?? []), edge]);
    outgoing.set(from, [...(outgoing.get(from) ?? []), edge]);
  }

  const sinkIds = new Set(
    nodes.filter(node => SINK_TYPES.has(node.type)).map(node => node.id),
  );

  // output handles a sink is wired to. A sink takes whatever arrives, so an
  // output with one is never held back by what the recipes below it ask for
  const drained = new Set(
    edges
      .filter(edge => edge.sourceHandle && sinkIds.has(edge.target))
      .map(edge => `${edge.source}:${edge.sourceHandle ?? ''}`),
  );

  // input handles an input leaf feeds: the leaf carries in whatever the recipes
  // leave short, so a handle in here never holds its node back
  const leafIds = new Set(
    nodes.filter(node => node.type === 'inputNode').map(node => node.id),
  );
  const toppedUp = new Set(
    edges
      .filter(edge => edge.targetHandle && leafIds.has(edge.source))
      .map(edge => `${edge.target}:${edge.targetHandle ?? ''}`),
  );

  // nodes fed only from outside: every input handle they have is one an input
  // leaf tops up. These are a line's make-up steps — the Chlorine-to-HCl recipe
  // that covers what a platinum line's recycle cannot — and the outside world
  // hands them exactly what they ask for. So what they run at is what the line
  // asks OF them, not what their machines could hold: left at capacity, such a
  // step charges its leaf for a full machine's worth of an item the line never
  // took, and reports the difference back as a surplus of its own output
  const sourced = new Set<string>();
  for (const [id, shape] of flow) {
    const handles = shape.inputs.filter(input => input.quantity > 0);
    if (
      handles.length > 0 &&
      handles.every(input => toppedUp.has(`${id}:${input.id}`))
    )
      sourced.add(id);
  }

  const rate = new Map<string, number>();
  for (const [id, shape] of flow) rate.set(id, shape.capacity);

  // items per second one edge's source makes available through it
  const made = (edge: Edge): number => {
    const output = item(edge.source, edge.sourceHandle, 'outputs');
    return output === undefined
      ? 0
      : (rate.get(edge.source) ?? 0) * output.quantity;
  };

  // what one edge is asked to carry: its target handle's whole need, split
  // across the outputs wired into it in proportion to what each one makes.
  // Two half-feeding producers each owe half of it — the same rule the
  // per-pass balance uses, in rates
  const claim = (edge: Edge): number => {
    const input = item(edge.target, edge.targetHandle, 'inputs');
    if (input === undefined) return 0;
    const need = (rate.get(edge.target) ?? 0) * input.quantity;

    const group = incoming.get(`${edge.target}:${edge.targetHandle ?? ''}`);
    if (group === undefined || group.length === 0) return 0;

    const total = group.reduce((sum, sibling) => sum + made(sibling), 0);
    const share = total > 0 ? made(edge) / total : 1 / group.length;

    return need * share;
  };

  // what the source actually hands over: an output never delivers more than it
  // makes, and one that is over-subscribed is shared out by what each consumer
  // claimed of it
  const delivered = (edge: Edge): number => {
    const asked = claim(edge);
    if (asked <= 0) return 0;

    const siblings = outgoing.get(`${edge.source}:${edge.sourceHandle ?? ''}`);
    const claimed = (siblings ?? []).reduce(
      (sum, sibling) => sum + claim(sibling),
      0,
    );
    if (claimed <= 0) return 0;

    return (Math.min(made(edge), claimed) * asked) / claimed;
  };

  // what the line asks of a node, in units of its work per second: the most
  // demanding of its outputs. `undefined` means nothing downstream asks at all —
  // an output with a sink on it, or one wired nowhere — and such a node keeps
  // running at its capacity, so a dangling step still reads as a surplus rather
  // than as something nobody wants
  const pulled = (id: string, shape: FlowNode): number | undefined => {
    let most: number | undefined;

    for (const output of shape.outputs) {
      const key = `${id}:${output.id}`;
      if (output.quantity <= 0) continue;
      if (drained.has(key)) return undefined;

      const consumers = outgoing.get(key);
      if (consumers === undefined) continue;

      let need = 0;
      for (const edge of consumers) {
        const input = item(edge.target, edge.targetHandle, 'inputs');
        if (input === undefined) continue;
        // the WHOLE need of the handle, not this node's share of it. Two
        // producers into one handle each covering the share their own rate
        // earns them would pull each other down round after round
        need += (rate.get(edge.target) ?? 0) * input.quantity;
      }

      const asked = need / output.quantity;
      most = most === undefined ? asked : Math.max(most, asked);
    }

    return most;
  };

  // the input handle each node is held down by, and the nodes a lossy loop has
  // stopped for good
  const bound = new Map<string, string>();
  const dead = new Set<string>();

  // hold every rate down to what feeds it until nothing moves. Returns the nodes
  // that were still on their way down when the rounds ran out — a lossy loop
  // approaches zero without ever arriving, so there is nothing else to report
  // about it than that it is on the way there
  const relax = (): Set<string> => {
    // nodes that went UP at some point in this pass. A rate that rises is
    // taking up supply a neighbour gave back, which is the ping-pong the round
    // cap is there for — not a loop running out
    const rose = new Set<string>();
    let falling = new Set<string>();

    for (let round = 0; round < MAX_ROUNDS; round++) {
      let moved = false;
      const fell = new Set<string>();

      for (const [id, shape] of flow) {
        // a stopped loop stays stopped: re-solving around it is the whole point
        if (dead.has(id)) continue;

        let limit = shape.capacity;
        let limiter: string | undefined;

        for (const input of shape.inputs) {
          const key = `${id}:${input.id}`;
          // an unfed handle is reported as an issue, not modelled as a stop: a
          // half-wired line would otherwise read as producing nothing anywhere
          const feeds = incoming.get(key);
          if (input.quantity <= 0 || feeds === undefined) continue;
          if (toppedUp.has(key)) continue;

          const available = feeds.reduce(
            (sum, edge) => sum + delivered(edge),
            0,
          );
          const supported = available / input.quantity;
          if (supported < limit) {
            limit = supported;
            limiter = key;
          }
        }

        // a make-up step follows the line's demand rather than its own machine
        const pull = sourced.has(id) ? pulled(id, shape) : undefined;
        if (pull !== undefined && pull < limit) {
          limit = pull;
          limiter = undefined;
        }

        if (limiter === undefined) bound.delete(id);
        else bound.set(id, limiter);

        const before = rate.get(id) ?? 0;
        if (!settled(before, limit)) {
          rate.set(id, limit);
          moved = true;
          if (limit > before) rose.add(id);
          else fell.add(id);
        }
      }

      if (!moved) return new Set();
      falling = fell;
    }

    for (const id of rose) falling.delete(id);
    return falling;
  };

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const falling = relax();
    if (falling.size === 0) break;

    for (const id of falling) {
      dead.add(id);
      rate.set(id, 0);
    }
  }

  // what settled, per handle, for the balance checks and the leaves alike
  const supply = new Map<string, number>();
  for (const [key, feeds] of incoming)
    supply.set(
      key,
      feeds.reduce((sum, edge) => sum + delivered(edge), 0),
    );

  const spare = new Map<string, number>();
  for (const [id, shape] of flow)
    for (const output of shape.outputs) {
      const key = `${id}:${output.id}`;
      const made = (rate.get(id) ?? 0) * output.quantity;
      const taken = (outgoing.get(key) ?? []).reduce(
        (sum, edge) => sum + delivered(edge),
        0,
      );
      // an output whose consumers take all of it lands a few ULPs off it, and
      // that dust is a rate the panels would print ("7.1e-15/s") and a sink
      // would carry. Nothing left is nothing left
      spare.set(key, settled(made, taken) ? 0 : made - taken);
    }

  // leaves, in the same terms: a sink takes what its output handle has left
  // after the recipes on it, and an input leaf carries in what the recipes
  // wired into its handle leave short
  const leaves = new Map<string, number>();

  // how many sinks share one output handle. Two labels for the same overflow
  // each reading all of it double-counts the item in every total built on these
  const sinksOn = new Map<string, number>();
  for (const edge of edges) {
    if (!sinkIds.has(edge.target)) continue;
    const key = `${edge.source}:${edge.sourceHandle ?? ''}`;
    sinksOn.set(key, (sinksOn.get(key) ?? 0) + 1);
  }

  for (const edge of edges) {
    const output = item(edge.source, edge.sourceHandle, 'outputs');
    if (output !== undefined && sinkIds.has(edge.target)) {
      const key = `${edge.source}:${edge.sourceHandle ?? ''}`;
      leaves.set(
        edge.target,
        Math.max(0, spare.get(key) ?? 0) / (sinksOn.get(key) ?? 1),
      );
    }

    const input = item(edge.target, edge.targetHandle, 'inputs');
    if (input !== undefined && leafIds.has(edge.source)) {
      const needed = (rate.get(edge.target) ?? 0) * input.quantity;
      const key = `${edge.target}:${edge.targetHandle ?? ''}`;
      leaves.set(edge.source, Math.max(0, needed - (supply.get(key) ?? 0)));
    }
  }

  const capacity = new Map<string, number>();
  for (const [id, shape] of flow) capacity.set(id, shape.capacity);

  return { nodes: rate, dead, bound, capacity, leaves, supply, spare };
};

// Every node on the canvas asks this same question of the same two arrays, and
// the store hands back the same references until something is edited — so the
// solve is done once per graph rather than once per node. A single entry is
// enough: there is one graph on screen
let memo:
  | { nodes: ProductionNode[]; edges: Edge[]; rates: LineRates }
  | undefined;

export const cachedRates = (
  nodes: ProductionNode[],
  edges: Edge[],
): LineRates => {
  if (memo?.nodes === nodes && memo.edges === edges) return memo.rates;

  const rates = steadyRates(nodes, edges);
  memo = { nodes, edges, rates };
  return rates;
};
