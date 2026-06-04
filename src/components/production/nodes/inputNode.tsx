import { NumberInput } from '@mantine/core';
import { type NodeProps } from '@xyflow/react';

import {
  useProductionStore,
  type ProductionNode as IProductionNode,
} from '@/contexts/productionStore';

import { ProductionNode } from './productionNode';

type InputNodeType = Extract<IProductionNode, { type: 'inputNode' }>;

export const InputNode = ({ id, data, ...props }: NodeProps<InputNodeType>) => {
  const setInputQuantity = useProductionStore(state => state.setInputQuantity);

  return (
    <ProductionNode
      id={id}
      data={data}
      {...props}
      type="source"
      color="teal"
      leftSection={
        <NumberInput
          variant="unstyled"
          w={6 + data.quantity.toString().length * 8}
          radius={0}
          min={1}
          hideControls
          value={data.quantity}
          onChange={value =>
            setInputQuantity(id, typeof value === 'number' ? value : 0)
          }
          styles={{ input: { minHeight: 24, height: 24, fontSize: 16 } }}
        />
      }
    />
  );
};
