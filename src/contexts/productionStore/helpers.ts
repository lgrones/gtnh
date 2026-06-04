import { type Edge } from '@xyflow/react';

import {
  DRAG_HANDLE_CLASS,
  type MachineNodeData,
  type MachineOutput,
  type ProductionNode,
  type ProductionNodeType,
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
    case 'machineNode':
      return { ...base, type, data: { name: 'Machine', outputs: [] } };
    case 'inputNode':
      return { ...base, type, data: { name: 'Input', quantity: 1 } };
    case 'outputNode':
      return { ...base, type, data: { name: 'Output', quantity: 0 } };
    case 'disposalNode':
      return { ...base, type, data: { name: 'Disposal', quantity: 0 } };
  }
};

// update data of a single machine node, leaving other nodes untouched
export const mapMachine = (
  nodes: ProductionNode[],
  nodeId: string,
  update: (data: MachineNodeData) => MachineNodeData,
): ProductionNode[] =>
  nodes.map(node =>
    node.id === nodeId && node.type === 'machineNode'
      ? { ...node, data: update(node.data) }
      : node,
  );

// sink nodes whose name + quantity mirror the connected machine output
export const SINK_TYPES = new Set<ProductionNodeType>([
  'outputNode',
  'disposalNode',
]);

// sync every sink's name + quantity to its connected machine output; sinks
// with no incoming machine-output edge keep their current values
export const syncSinks = (
  nodes: ProductionNode[],
  edges: Edge[],
): ProductionNode[] => {
  // `${machineId}:${outputId}` -> the produced output
  const outputs = new Map<string, MachineOutput>();

  for (const node of nodes) {
    if (node.type === 'machineNode')
      for (const output of node.data.outputs)
        outputs.set(`${node.id}:${output.id}`, output);
  }

  // target sink id -> output (from edges leaving a machine output handle)
  const sinkOutputs = new Map<string, MachineOutput>();

  for (const edge of edges) {
    if (!edge.sourceHandle) continue;

    const output = outputs.get(`${edge.source}:${edge.sourceHandle}`);

    if (output === undefined) continue;

    sinkOutputs.set(edge.target, output);
  }

  return nodes.map(node => {
    const output = sinkOutputs.get(node.id);

    return output !== undefined && SINK_TYPES.has(node.type)
      ? ({
          ...node,
          data: { ...node.data, name: output.name, quantity: output.quantity },
        } as ProductionNode)
      : node;
  });
};
