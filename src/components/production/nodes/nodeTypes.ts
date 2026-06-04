import type { NodeTypes } from '@xyflow/react';

import { InputNode } from './inputNode';
import { MachineNode } from './machineNode';
import { OutputNode } from './outputNode';

export const nodeTypes = {
  inputNode: InputNode,
  outputNode: OutputNode,
  machineNode: MachineNode,
} satisfies NodeTypes;
