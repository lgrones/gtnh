import type { NodeTypes } from '@xyflow/react';

import { DisposalNode } from './disposalNode';
import { InputNode } from './inputNode';
import { MachineNode } from './machineNode';
import { OutputNode } from './outputNode';

export const nodeTypes = {
  inputNode: InputNode,
  outputNode: OutputNode,
  machineNode: MachineNode,
  disposalNode: DisposalNode,
} satisfies NodeTypes;
