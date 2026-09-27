import {
  Badge,
  Group,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  useLines,
  useProductionLibrary,
  type GraphMeta,
} from '@/contexts/productionLibrary';
import { useProductionStore } from '@/contexts/productionStore';
import { useLineSource, wouldRecurse } from '@/contexts/subLine';

import { formatAmount } from '../common/format';

interface Position {
  x: number;
  y: number;
}

// one pickable alternative. Why it CANNOT be picked is worth as much as the
// pick itself — a line missing from the list with no reason given reads as a
// bug in the library rather than a fact about the graph
const LineOption = ({
  meta,
  activeId,
  position,
  onPicked,
}: {
  meta: GraphMeta;
  activeId: string | null;
  position: Position;
  onPicked: () => void;
}) => {
  const addLineNode = useProductionStore(state => state.addLineNode);
  const source = useLineSource(meta.id);

  if (source === undefined) return null;

  const machines = source.capture.machines.reduce(
    (total, entry) => total + entry.quantity,
    0,
  );

  const blocked =
    meta.id === activeId
      ? 'this line'
      : activeId !== null && wouldRecurse(meta.id, activeId)
        ? 'would contain this line'
        : machines === 0
          ? 'no machines yet'
          : undefined;

  return (
    <UnstyledButton
      disabled={blocked !== undefined}
      onClick={() => {
        addLineNode(meta.id, source.name, source.capture, position);
        onPicked();
      }}
      px="xs"
      py={6}
      style={{
        borderRadius: 'var(--mantine-radius-default)',
        opacity: blocked === undefined ? 1 : 0.45,
        cursor: blocked === undefined ? 'pointer' : 'not-allowed',
      }}
    >
      <Group gap="xs" wrap="nowrap" justify="space-between">
        <Stack gap={0}>
          <Text size="sm">{source.name}</Text>

          <Text size="xs" c="dimmed">
            {source.capture.inputs.length} in · {source.capture.outputs.length}{' '}
            out · {machines} machine{machines === 1 ? '' : 's'} ·{' '}
            {formatAmount(source.capture.demand)} EU/t
          </Text>
        </Stack>

        {blocked !== undefined ? (
          <Badge size="xs" variant="light" color="gray">
            {blocked}
          </Badge>
        ) : (
          source.capture.incomplete > 0 && (
            <Badge size="xs" variant="light" color="yellow">
              {source.capture.incomplete} unfilled
            </Badge>
          )
        )}
      </Group>
    </UnstyledButton>
  );
};

// pick a saved line to drop in as one node. Every alternative is offered, not
// just the favourite: which build of a sub-line a bigger line is planned around
// is exactly the kind of thing alternatives exist to answer
export const SubLineModalContent = ({
  position,
  onPicked,
}: {
  position: Position;
  onPicked: () => void;
}) => {
  const lines = useLines();
  const { activeId } = useProductionLibrary(
    useShallow(state => ({ activeId: state.activeId })),
  );

  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();

  const matching = lines.filter(
    line =>
      needle === '' ||
      line.name.toLowerCase().includes(needle) ||
      line.alternatives.some(alt => alt.name.toLowerCase().includes(needle)),
  );

  return (
    <Stack gap="xs" miw={380}>
      <TextInput
        data-autofocus
        placeholder="Search lines"
        leftSection={<IconSearch size={16} />}
        value={query}
        onChange={e => setQuery(e.currentTarget.value)}
      />

      {matching.length === 0 && (
        <Text size="sm" c="dimmed">
          No lines match
        </Text>
      )}

      <Stack gap={2} mah={420} style={{ overflowY: 'auto' }}>
        {matching.flatMap(line =>
          line.alternatives.map(alt => (
            <LineOption
              key={alt.id}
              meta={alt}
              activeId={activeId}
              position={position}
              onPicked={onPicked}
            />
          )),
        )}
      </Stack>
    </Stack>
  );
};
