import {
  ActionIcon,
  Badge,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  IconPlus,
  IconShare,
  IconTournament,
  IconX,
} from '@tabler/icons-react';
import { useShallow } from 'zustand/react/shallow';

import { useAuth } from '@/contexts/auth';
import { useProductionLibrary } from '@/contexts/productionLibrary';

import { ShareModalContent } from './shareModal';

const openShareModal = (graphId: string) =>
  modals.open({
    title: 'Share production line',
    children: <ShareModalContent graphId={graphId} />,
  });

export const LibPanel = () => {
  const uid = useAuth(state => state.user?.uid);
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

      {graphs.map(graph => {
        const isOwner = graph.ownerId === uid;
        return (
          <Group key={graph.id} gap="xs">
            {graph.id === activeId && (
              <IconTournament
                size={16}
                color="var(--mantine-color-indigo-filled)"
              />
            )}

            <TextInput
              flex={1}
              variant="unstyled"
              value={graph.name}
              readOnly={graph.role === 'viewer'}
              onFocus={() => selectGraph(graph.id)}
              onChange={e => void renameGraph(graph.id, e.currentTarget.value)}
              styles={{
                input: { backgroundColor: 'transparent', border: 'none' },
              }}
            />

            {!isOwner && (
              <Badge size="xs" variant="light" color="gray">
                {graph.role}
              </Badge>
            )}

            {isOwner && (
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label="Share line"
                onClick={() => openShareModal(graph.id)}
              >
                <IconShare size={16} />
              </ActionIcon>
            )}

            {isOwner && (
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
            )}
          </Group>
        );
      })}
    </Paper>
  );
};
