import { Text } from '@mantine/core';
import { type NodeProps } from '@xyflow/react';

import { type ProductionNode as IProductionNode } from '@/contexts/productionStore';

import { formatAmount } from '../../common/format';
import { ProductionNode } from './productionNode';

type ByproductNodeType = Extract<IProductionNode, { type: 'byproductNode' }>;

export const ByproductNode = (props: NodeProps<ByproductNodeType>) => (
  <ProductionNode
    {...props}
    type="target"
    color="orange"
    editable={false}
    leftSection={<Text pr={6}>{formatAmount(props.data.quantity)}</Text>}
  />
);
