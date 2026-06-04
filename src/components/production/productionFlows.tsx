import {
  ActionIcon,
  Box,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconPlus, IconX } from '@tabler/icons-react';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useProductionLibrary } from '@/contexts/productionLibrary';
import { useProductionStore } from '@/contexts/productionStore';

export const ProductionFlows = () => {
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
  const reset = useProductionStore(state => state.reset);

  // load the active saved graph into the working store whenever it changes
  // (depends on activeId only — saveActive must not retrigger this)
  useEffect(() => {
    const graph = useProductionLibrary
      .getState()
      .graphs.find(g => g.id === activeId);

    reset(graph?.nodes ?? [], graph?.edges ?? []);
  }, [activeId, reset]);

  // sync every working-store edit back into the active saved graph
  useEffect(
    () =>
      useProductionStore.subscribe(state =>
        useProductionLibrary.getState().saveActive(state.nodes, state.edges),
      ),
    [],
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
          onClick={createGraph}
          aria-label="New line"
        >
          <IconPlus size={16} />
        </ActionIcon>
      </Group>

      {graphs.map(graph => (
        <Group key={graph.id} gap="xs">
          {graph.id === activeId && (
            <Box w={12} h={12} bg="gray" style={{ borderRadius: '50%' }} />
          )}

          <TextInput
            flex={1}
            variant="unstyled"
            value={graph.name}
            onFocus={() => selectGraph(graph.id)}
            onChange={e => renameGraph(graph.id, e.currentTarget.value)}
          />

          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={() => removeGraph(graph.id)}
          >
            <IconX size={16} />
          </ActionIcon>
        </Group>
      ))}
    </Paper>
  );
};
