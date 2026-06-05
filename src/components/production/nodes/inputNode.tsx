import { Text } from '@mantine/core';
import { type NodeProps } from '@xyflow/react';

import { type ProductionNode as IProductionNode } from '@/contexts/productionStore';

import { ProductionNode } from './productionNode';

type InputNodeType = Extract<IProductionNode, { type: 'inputNode' }>;

export const InputNode = (props: NodeProps<InputNodeType>) => (
  <ProductionNode
    {...props}
    type="source"
    color="teal"
    editable={false}
    leftSection={<Text pr={6}>{props.data.quantity}</Text>}
  />
);
