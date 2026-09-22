import { type Edge } from '@xyflow/react';

import { overclock } from '@/domain/overclock';

import { SINK_TYPES } from './helpers';
import type { ProductionNode, RecipeItem } from './types';

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
  /** Items per second each leaf node carries in, or hands out */
  leaves: Map<string, number>;
}

// rates settle by division, so two that should agree can land a few ULPs apart
const EPSILON = 1e-9;

// the iteration is monotone in the common case — every rate starts at its
// machine's capacity and is pushed down by what feeds it — but a consumer that
// drops frees supply for the one beside it, which can push that one back up. A
// cap keeps a graph that ping-pongs between two allocations from spinning; in
// practice a line settles in a handful of rounds
const MAX_ROUNDS = 64;

/**
 * What every node and leaf of a line does per second once it is running.
 *
 * Each recipe starts at what its machine could hold and is then held down by
 * whatever feeds it: an input handle can only pass on what arrives, and an
 * output that several recipes draw on is shared between them in proportion to
 * what each one asks for. An input leaf is not a limit — it stands for the
 * outside world topping the handle up, exactly as it does per pass.
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

  const rate = new Map<string, number>();
  for (const [id, shape] of flow) rate.set(id, shape.capacity);

  // what one edge's source actually hands this consumer, at the rates the
  // current round is holding. The same proportional rule the per-pass balance
  // uses: an output never delivers more than it makes, and one that is
  // over-subscribed is shared out by what each consumer asked for
  const delivered = (edge: Edge): number => {
    const output = item(edge.source, edge.sourceHandle, 'outputs');
    const input = item(edge.target, edge.targetHandle, 'inputs');
    if (output === undefined || input === undefined) return 0;

    const made = (rate.get(edge.source) ?? 0) * output.quantity;
    const asked = (rate.get(edge.target) ?? 0) * input.quantity;
    if (asked <= 0) return 0;

    const siblings = outgoing.get(`${edge.source}:${edge.sourceHandle ?? ''}`);
    const claimed = (siblings ?? []).reduce((sum, sibling) => {
      const want = item(sibling.target, sibling.targetHandle, 'inputs');
      return (
        sum +
        (want === undefined
          ? 0
          : (rate.get(sibling.target) ?? 0) * want.quantity)
      );
    }, 0);
    if (claimed <= 0) return 0;

    return (Math.min(made, claimed) * asked) / claimed;
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let moved = false;

    for (const [id, shape] of flow) {
      let limit = shape.capacity;

      for (const input of shape.inputs) {
        const key = `${id}:${input.id}`;
        // an unfed handle is reported as an issue, not modelled as a stop: a
        // half-wired line would otherwise read as producing nothing anywhere
        const feeds = incoming.get(key);
        if (input.quantity <= 0 || feeds === undefined) continue;
        if (toppedUp.has(key)) continue;

        const available = feeds.reduce((sum, edge) => sum + delivered(edge), 0);
        limit = Math.min(limit, available / input.quantity);
      }

      if (Math.abs(limit - (rate.get(id) ?? 0)) > EPSILON) {
        rate.set(id, limit);
        moved = true;
      }
    }

    if (!moved) break;
  }

  // leaves, in the same terms: a sink takes what its output handle has left
  // after the recipes on it, and an input leaf carries in what the recipes
  // wired into its handle leave short
  const leaves = new Map<string, number>();

  for (const edge of edges) {
    const output = item(edge.source, edge.sourceHandle, 'outputs');
    if (output !== undefined && sinkIds.has(edge.target)) {
      const made = (rate.get(edge.source) ?? 0) * output.quantity;
      const taken = (
        outgoing.get(`${edge.source}:${edge.sourceHandle ?? ''}`) ?? []
      ).reduce((sum, sibling) => sum + delivered(sibling), 0);
      leaves.set(edge.target, Math.max(0, made - taken));
    }

    const input = item(edge.target, edge.targetHandle, 'inputs');
    if (input !== undefined && leafIds.has(edge.source)) {
      const needed = (rate.get(edge.target) ?? 0) * input.quantity;
      const supplied = (
        incoming.get(`${edge.target}:${edge.targetHandle ?? ''}`) ?? []
      ).reduce((sum, sibling) => sum + delivered(sibling), 0);
      leaves.set(edge.source, Math.max(0, needed - supplied));
    }
  }

  return { nodes: rate, leaves };
};
