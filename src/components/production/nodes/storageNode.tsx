import {
  ActionIcon,
  Autocomplete,
  Group,
  NumberInput,
  Stack,
  Text,
} from '@mantine/core';
import { IconPlus, IconX } from '@tabler/icons-react';
import { type NodeProps } from '@xyflow/react';
import { useShallow } from 'zustand/shallow';

import {
  useItemNames,
  useProductionStore,
  type ProductionNode as IProductionNode,
} from '@/contexts/productionStore';

import { ProductionNode } from './productionNode';

type StorageNodeType = Extract<IProductionNode, { type: 'storageNode' }>;

// Stock the base already has — items and fluids other lines feed into the same
// ME network. It produces nothing, so it never appears among the line's
// products; all it does is stop its items being listed as work to go and do.
export const StorageNode = ({
  id,
  data,
  ...props
}: NodeProps<StorageNodeType>) => {
  const { addStorageItem, updateStorageItem, removeStorageItem } =
    useProductionStore(
      useShallow(state => ({
        addStorageItem: state.addStorageItem,
        updateStorageItem: state.updateStorageItem,
        removeStorageItem: state.removeStorageItem,
      })),
    );

  const itemNames = useItemNames();

  return (
    <ProductionNode
      {...props}
      id={id}
      data={data}
      type="none"
      color="cyan"
      ignoredIn="wired"
    >
      <Stack pt="xs" miw={340} w="fit-content" maw={560} gap="xs">
        <Group justify="space-between">
          <Text c="dimmed" size="xs" tt="uppercase" fw="600">
            On hand
          </Text>

          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={() => addStorageItem(id)}
          >
            <IconPlus size={16} />
          </ActionIcon>
        </Group>

        {data.items.length === 0 && (
          <Text size="xs" c="dimmed">
            Nothing yet — add what other lines already supply
          </Text>
        )}

        <Stack gap="xs">
          {data.items.map(item => (
            <Group key={item.id} gap="xs" wrap="nowrap">
              {/* blank means unlimited, which is what "on hand" usually means;
                  a number caps how much per second this can cover */}
              <NumberInput
                size="sm"
                w={86}
                min={0}
                hideControls
                allowNegative={false}
                thousandSeparator=","
                placeholder="∞"
                value={item.rate ?? ''}
                onChange={value =>
                  updateStorageItem(id, item.id, {
                    rate: typeof value === 'number' ? value : undefined,
                  })
                }
                rightSection={
                  <Text size="xs" c="dimmed" pr={6}>
                    /s
                  </Text>
                }
                rightSectionWidth={24}
              />

              <Autocomplete
                size="sm"
                flex="1 1 160px"
                miw={120}
                placeholder="Item"
                data={itemNames}
                limit={8}
                value={item.name}
                onChange={value =>
                  updateStorageItem(id, item.id, { name: value })
                }
                onKeyDown={e => e.key === 'Enter' && addStorageItem(id)}
              />

              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={() => removeStorageItem(id, item.id)}
              >
                <IconX size={16} />
              </ActionIcon>
            </Group>
          ))}
        </Stack>
      </Stack>
    </ProductionNode>
  );
};
