import { Button, Group, Text } from '@mantine/core';
import { IconChevronLeft } from '@tabler/icons-react';
import { useShallow } from 'zustand/react/shallow';

import { useProductionLibrary } from '@/contexts/productionLibrary';

// The way back out of a line that was opened from a collapsed sub-line node.
// Nothing else on the canvas says which line you are looking at once you are
// two levels down, and the library list only ever highlights the active one.
export const DrillCrumb = () => {
  const { drillPath, drillOut, graphs } = useProductionLibrary(
    useShallow(state => ({
      drillPath: state.drillPath,
      drillOut: state.drillOut,
      graphs: state.graphs,
    })),
  );

  const parent = graphs.find(graph => graph.id === drillPath.at(-1));

  if (parent === undefined) return null;

  return (
    <Group gap={4} wrap="nowrap">
      <Button
        size="xs"
        variant="default"
        leftSection={<IconChevronLeft size={14} />}
        onClick={drillOut}
      >
        {parent.groupName}
      </Button>

      {/* how deep this is, when it is deeper than the one step back */}
      {drillPath.length > 1 && (
        <Text size="xs" c="dimmed">
          +{drillPath.length - 1}
        </Text>
      )}
    </Group>
  );
};
