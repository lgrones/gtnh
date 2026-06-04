import {
  ActionIcon,
  Group,
  NumberInput,
  Stack,
  TextInput,
} from '@mantine/core';
import { usePrevious } from '@mantine/hooks';
import { IconPlus, IconX } from '@tabler/icons-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/shallow';

import {
  useProductionStore,
  type ProductionNode as IProductionNode,
} from '@/contexts/productionStore';

import { ProductionNode } from './productionNode';

import classes from './productionNode.module.css';

type MachineNodeType = Extract<IProductionNode, { type: 'machineNode' }>;

export const MachineNode = ({
  id,
  data,
  ...props
}: NodeProps<MachineNodeType>) => {
  const { addMachineOutput, updateMachineOutput, removeMachineOutput } =
    useProductionStore(
      useShallow(state => ({
        addMachineOutput: state.addMachineOutput,
        updateMachineOutput: state.updateMachineOutput,
        removeMachineOutput: state.removeMachineOutput,
      })),
    );

  const prevLength = usePrevious(data.outputs.length);
  const itemRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (
      !itemRef.current ||
      (prevLength !== undefined && prevLength >= data.outputs.length)
    )
      return;

    itemRef.current.focus();
  }, [data.outputs.length, prevLength]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;

    addMachineOutput(id);
  };

  return (
    <ProductionNode
      id={id}
      data={data}
      {...props}
      type="target"
      color="indigo"
      rightSection={
        <ActionIcon
          ml="auto"
          variant="subtle"
          color="gray"
          onClick={() => addMachineOutput(id)}
        >
          <IconPlus size={16} />
        </ActionIcon>
      }
    >
      <Stack gap="xs" mt="xs">
        {data.outputs.map((output, i, arr) => (
          <Group key={output.id} gap="xs" className={classes.row}>
            <NumberInput
              size="xs"
              variant="unstyled"
              w={6 + output.quantity.toString().length * 8}
              pl={6}
              radius={0}
              min={1}
              hideControls
              value={output.quantity}
              onChange={value =>
                updateMachineOutput(id, output.id, {
                  quantity: typeof value === 'number' ? value : 0,
                })
              }
            />

            <TextInput
              size="xs"
              radius={0}
              variant="unstyled"
              placeholder="Item"
              value={output.name}
              onChange={event =>
                updateMachineOutput(id, output.id, {
                  name: event.currentTarget.value,
                })
              }
              ref={i === arr.length - 1 ? itemRef : null}
              onKeyDown={handleKeyDown}
            />

            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={() => removeMachineOutput(id, output.id)}
            >
              <IconX size={16} />
            </ActionIcon>

            <Handle
              type="source"
              id={output.id}
              position={Position.Right}
              className={classes.output}
            />
          </Group>
        ))}
      </Stack>
    </ProductionNode>
  );
};
