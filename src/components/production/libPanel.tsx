import {
  ActionIcon,
  Badge,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconPlus, IconX } from '@tabler/icons-react';
import { useShallow } from 'zustand/react/shallow';

import {
  useLines,
  useProductionLibrary,
  type Line,
} from '@/contexts/productionLibrary';

// one library row = one production line (a group of alternatives). the name
// input is uncontrolled (defaultValue) on purpose: rename writes to Firestore
// and the new name only comes back a render later via the snapshot, so a
// *controlled* value lags and resets the caret on every keystroke. letting the
// DOM own the value keeps the caret put; the row is keyed by groupId upstream,
// so it re-seeds defaultValue when the line changes.
const LineRow = ({
  line,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  line: Line;
  active: boolean;
  onSelect: (line: Line) => void;
  onRename: (groupId: string, name: string) => void;
  onDelete: (groupId: string) => void;
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
      defaultValue={line.name}
      onFocus={() => onSelect(line)}
      onChange={e => onRename(line.groupId, e.currentTarget.value)}
      styles={{ input: { backgroundColor: 'transparent', border: 'none' } }}
    />

    {line.alternatives.length > 1 && (
      <Tooltip label="Alternatives">
        <Badge size="sm" variant="light" color="gray">
          {line.alternatives.length}
        </Badge>
      </Tooltip>
    )}

    <ActionIcon
      variant="subtle"
      color="gray"
      aria-label="Delete line"
      onClick={() =>
        modals.openConfirmModal({
          title: 'Delete production line',
          children: (
            <Text size="sm">
              You sure you wanna delete this production line
              {line.alternatives.length > 1
                ? ` and all ${line.alternatives.length} alternatives`
                : ''}
              ?
            </Text>
          ),
          labels: { confirm: 'Delete', cancel: 'Cancel' },
          confirmProps: { color: 'red' },
          onConfirm: () => onDelete(line.groupId),
        })
      }
    >
      <IconX size={16} />
    </ActionIcon>
  </Group>
);

export const LibPanel = () => {
  const lines = useLines();
  const { activeId, createGraph, selectGraph, renameLine, removeLine } =
    useProductionLibrary(
      useShallow(state => ({
        activeId: state.activeId,
        createGraph: state.createGraph,
        selectGraph: state.selectGraph,
        renameLine: state.renameLine,
        removeLine: state.removeLine,
      })),
    );

  // selecting a line opens its favorite-or-first alternative (alternatives are
  // already sorted favorites-first)
  const selectLine = (line: Line) =>
    selectGraph(line.alternatives[0]?.id ?? '');

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

      {lines.map(line => (
        <LineRow
          key={line.groupId}
          line={line}
          active={line.alternatives.some(alt => alt.id === activeId)}
          onSelect={selectLine}
          onRename={(groupId, name) => void renameLine(groupId, name)}
          onDelete={groupId => void removeLine(groupId)}
        />
      ))}
    </Paper>
  );
};
