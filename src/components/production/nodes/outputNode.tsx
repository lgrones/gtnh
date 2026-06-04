import { Text } from '@mantine/core';
import { type NodeProps } from '@xyflow/react';

import { type ProductionNode as IProductionNode } from '@/contexts/productionStore';

import { ProductionNode } from './productionNode';

type OutputNodeType = Extract<IProductionNode, { type: 'outputNode' }>;

export const OutputNode = (props: NodeProps<OutputNodeType>) => (
  <ProductionNode
    {...props}
    type="target"
    color="grape"
    editable={false}
    leftSection={<Text pr={6}>{props.data.quantity}</Text>}
  />
);
