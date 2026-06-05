import { Text } from '@mantine/core';
import { type NodeProps } from '@xyflow/react';

import { type ProductionNode as IProductionNode } from '@/contexts/productionStore';

import { ProductionNode } from './productionNode';

type DisposalNodeType = Extract<IProductionNode, { type: 'disposalNode' }>;

export const DisposalNode = (props: NodeProps<DisposalNodeType>) => (
  <ProductionNode
    {...props}
    type="target"
    color="orange"
    editable={false}
    leftSection={<Text pr={6}>{props.data.quantity}</Text>}
  />
);
