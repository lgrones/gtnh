import type { NodeTypes } from '@xyflow/react';

import { DisposalNode } from './disposalNode';
import { InputNode } from './inputNode';
import { OutputNode } from './outputNode';
import { RecipeNode } from './recipeNode';
import { StorageNode } from './storageNode';

export const nodeTypes = {
  inputNode: InputNode,
  outputNode: OutputNode,
  recipeNode: RecipeNode,
  disposalNode: DisposalNode,
  storageNode: StorageNode,
} satisfies NodeTypes;
