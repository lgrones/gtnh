import {
  ActionIcon,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconPlus, IconX } from '@tabler/icons-react';
import { useShallow } from 'zustand/react/shallow';

import { useProductionLibrary } from '@/contexts/productionLibrary';

export const LibPanel = () => {
  const {
    graphs,
    activeId,
    createGraph,
    selectGraph,
    renameGraph,
    removeGraph,
  } = useProductionLibrary(
    useShallow(state => ({
      graphs: state.graphs,
      activeId: state.activeId,
      createGraph: state.createGraph,
      selectGraph: state.selectGraph,
      renameGraph: state.renameGraph,
      removeGraph: state.removeGraph,
    })),
  );

  return (
    <Paper
      h="100%"
      p="md"
      component={Stack}
      gap="xs"
      style={{ overflow: 'auto' }}
    >
      <Group justify="space-between">
        <Text fw={600}>Production Lines</Text>

        <ActionIcon
          variant="subtle"
          color="gray"
          onClick={() => void createGraph()}
          aria-label="New line"
        >
          <IconPlus size={16} />
        </ActionIcon>
      </Group>

      {graphs.map(graph => (
        <Group
          key={graph.id}
          gap="xs"
          mx="-xs"
          px="xs"
          bg={graph.id === activeId ? 'gray.9' : undefined}
          style={{ borderRadius: 'var(--mantine-radius-default)' }}
        >
          <TextInput
            flex={1}
            variant="unstyled"
            value={graph.name}
            onFocus={() => selectGraph(graph.id)}
            onChange={e => void renameGraph(graph.id, e.currentTarget.value)}
            styles={{
              input: { backgroundColor: 'transparent', border: 'none' },
            }}
          />

          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label="Delete line"
            onClick={() =>
              modals.openConfirmModal({
                title: 'Delete production line',
                children: (
                  <Text size="sm">
                    You sure you wanna delete this production line?
                  </Text>
                ),
                labels: { confirm: 'Delete', cancel: 'Cancel' },
                confirmProps: { color: 'red' },
                onConfirm: () => void removeGraph(graph.id),
              })
            }
          >
            <IconX size={16} />
          </ActionIcon>
        </Group>
      ))}
    </Paper>
  );
};
