import type { NodeTypes } from '@xyflow/react';

import { ByproductNode } from './byproductNode';
import { InputNode } from './inputNode';
import { LineNode } from './lineNode';
import { OutputNode } from './outputNode';
import { RecipeNode } from './recipeNode';

export const nodeTypes = {
  inputNode: InputNode,
  outputNode: OutputNode,
  recipeNode: RecipeNode,
  byproductNode: ByproductNode,
  lineNode: LineNode,
} satisfies NodeTypes;
