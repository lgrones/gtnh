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

import {
  useProductionLibrary,
  type GraphMeta,
} from '@/contexts/productionLibrary';

// one library row. the name input is uncontrolled (defaultValue) on purpose:
// rename writes to Firestore and the new name only comes back a render later via
// the snapshot, so a *controlled* value lags and resets the caret to the end on
// every keystroke. letting the DOM own the value keeps the caret put; the row is
// keyed by graph.id upstream, so it re-seeds defaultValue when the graph changes.
const GraphRow = ({
  graph,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  graph: GraphMeta;
  active: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) => (
  <Group
    gap="xs"
    mx="-xs"
    px="xs"
    bg={active ? 'gray.9' : undefined}
    style={{ borderRadius: 'var(--mantine-radius-default)' }}
  >
    <TextInput
      flex={1}
      variant="unstyled"
      defaultValue={graph.name}
      onFocus={() => onSelect(graph.id)}
      onChange={e => onRename(graph.id, e.currentTarget.value)}
      styles={{ input: { backgroundColor: 'transparent', border: 'none' } }}
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
          onConfirm: () => onDelete(graph.id),
        })
      }
    >
      <IconX size={16} />
    </ActionIcon>
  </Group>
);

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
        <GraphRow
          key={graph.id}
          graph={graph}
          active={graph.id === activeId}
          onSelect={selectGraph}
          onRename={(id, name) => void renameGraph(id, name)}
          onDelete={id => void removeGraph(id)}
        />
      ))}
    </Paper>
  );
};
