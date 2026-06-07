import {
  Badge,
  Group,
  OverflowList,
  Stack,
  Switch,
  Table,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowBigDownLines,
  IconArrowBigUpLines,
  IconBolt,
  IconCancel,
  IconClock,
  IconSettings,
  IconStarFilled,
  IconTrendingDown,
  IconTrendingUp,
} from '@tabler/icons-react';
import { useMemo, useState } from 'react';

import { decodeGraph } from '@/contexts/collab/decode';
import {
  graphSnapshot,
  useActiveLine,
  useProductionLibrary,
} from '@/contexts/productionLibrary';
import {
  lineMetrics,
  useProductionStore,
  type ItemAmount,
  type LineMetrics,
} from '@/contexts/productionStore';

import { Stat } from '../common/stat';
import { rankBy, type Rank } from './compareModal.extensions';

// compact integer / small-decimal formatting (matches energyPanel)
const fmt = (n: number, digits = 0) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits });

// seconds -> "1h 2m 3s"
const formatDuration = (totalSeconds: number): string => {
  if (totalSeconds <= 0) return '0s';
  const rounded = Math.round(totalSeconds);
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  return [h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join(' ');
};

const amountLabel = (item: ItemAmount, factor: number) =>
  `${fmt(item.quantity * factor, 2)}× ${item.name}`;

// a wrapping, overflow-collapsing list of badges for one comparison cell
const ListCell = <T,>({
  items,
  label,
  empty,
}: {
  items: T[];
  label: (item: T) => string;
  empty: string;
}) => {
  if (items.length === 0)
    return (
      <Text size="xs" c="dimmed">
        {empty}
      </Text>
    );

  return (
    <OverflowList
      data={items}
      gap="xs"
      maxRows={4}
      getItemKey={(_, index) => index}
      renderItem={item => (
        <Badge variant="light" color="dark" tt="none" fw={400}>
          {label(item)}
        </Badge>
      )}
      renderOverflow={rest => (
        <Tooltip
          label={rest.map((x, i) => (
            <span key={i}>
              {label(x)}
              <br />
            </span>
          ))}
        >
          <Badge variant="light" color="dark">
            +{rest.length}
          </Badge>
        </Tooltip>
      )}
    />
  );
};

export const CompareModalContent = () => {
  const line = useActiveLine();
  const activeGraphId = useProductionLibrary(state => state.activeId);
  const liveNodes = useProductionStore(state => state.nodes);
  const liveEdges = useProductionStore(state => state.edges);
  const [normalize, setNormalize] = useState(false);

  // metrics per alternative: the active one from the live store, the rest decoded
  // from their cached snapshots (read-only, no extra Firestore reads)
  const { metrics: rows, rankings } = useMemo(() => {
    if (!line) return { metrics: [], rankings: {} };

    const metrics = line.alternatives.map(alt => {
      const graph =
        alt.id === activeGraphId
          ? { nodes: liveNodes, edges: liveEdges }
          : decodeGraph(graphSnapshot(alt.id));

      return { alt, metrics: lineMetrics(graph.nodes, graph.edges) };
    });

    const rankPower = rankBy(metrics, x => x.metrics.demand);
    const rankTime = rankBy(metrics, x => x.metrics.time);

    const rankings: Record<
      string,
      Record<'power' | 'time', Rank>
    > = Object.fromEntries(
      metrics.map(x => [x.alt.id, { power: rankPower(x), time: rankTime(x) }]),
    );

    return { metrics, rankings };
  }, [line, activeGraphId, liveNodes, liveEdges]);

  if (!line || rows.length === 0)
    return <Text c="dimmed">No alternatives to compare.</Text>;

  // "match the largest": scale every alternative up to the one producing the
  // most of the line's primary (first locked, else first) output. preview only.
  const primary = line.lockedOutputs[0];
  const primaryQty = (m: LineMetrics) =>
    (primary ? m.outputs.find(o => o.name === primary) : m.outputs[0])
      ?.quantity ?? 0;
  const target = Math.max(0, ...rows.map(r => primaryQty(r.metrics)));
  const factorFor = (m: LineMetrics) => {
    const q = primaryQty(m);
    return normalize && q > 0 ? target / q : 1;
  };

  // pair each row with its display scaling factor so cells never index back in
  const view = rows.map(r => ({ ...r, factor: factorFor(r.metrics) }));

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        {line.lockedOutputs.length > 0 ? (
          <Text size="sm" c="dimmed">
            Locked outputs: {line.lockedOutputs.join(', ')}
          </Text>
        ) : (
          <span />
        )}

        <Switch
          checked={normalize}
          onChange={e => setNormalize(e.currentTarget.checked)}
          label="Normalize to equal output"
          disabled={target <= 0}
        />
      </Group>

      <Table
        withTableBorder
        withColumnBorders
        verticalSpacing="sm"
        layout="fixed"
      >
        <colgroup>
          <col style={{ width: 160 }} />
        </colgroup>

        <Table.Thead>
          <Table.Tr>
            <Table.Th w={140} />
            {rows.map(({ alt }) => (
              <Table.Th key={alt.id}>
                <Group gap={6}>
                  {alt.favorite && (
                    <IconStarFilled
                      size={12}
                      color="var(--mantine-color-yellow-text)"
                    />
                  )}
                  <Text fw={600} truncate>
                    {alt.name}
                  </Text>
                </Group>
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>

        <Table.Tbody>
          <Table.Tr>
            <Table.Th>
              <Stat
                icon={
                  <IconBolt
                    size={16}
                    color="var(--mantine-color-yellow-filled)"
                  />
                }
                label="Power demand"
                value={null}
              />
            </Table.Th>

            {view.map(({ alt, metrics, factor }) => (
              <Table.Td key={alt.id}>
                <Group gap={4}>
                  <Text size="sm">{fmt(metrics.demand * factor, 1)} EU/t</Text>
                  {rankings[alt.id]?.power === 'best' ? (
                    <IconTrendingUp
                      size={20}
                      color="var(--mantine-color-teal-text)"
                    />
                  ) : rankings[alt.id]?.power === 'worst' ? (
                    <IconTrendingDown
                      size={20}
                      color="var(--mantine-color-red-text)"
                    />
                  ) : null}
                </Group>
              </Table.Td>
            ))}
          </Table.Tr>

          <Table.Tr>
            <Table.Th>
              <Stat
                icon={
                  <IconClock
                    size={16}
                    color="var(--mantine-color-blue-filled)"
                  />
                }
                label="Process time"
                value={null}
              />
            </Table.Th>

            {view.map(({ alt, metrics, factor }) => (
              <Table.Td key={alt.id}>
                <Group gap={4}>
                  <Text size="sm">{formatDuration(metrics.time * factor)}</Text>
                  {rankings[alt.id]?.time === 'best' ? (
                    <IconTrendingUp
                      size={20}
                      color="var(--mantine-color-teal-text)"
                    />
                  ) : rankings[alt.id]?.time === 'worst' ? (
                    <IconTrendingDown
                      size={20}
                      color="var(--mantine-color-red-text)"
                    />
                  ) : null}
                </Group>
              </Table.Td>
            ))}
          </Table.Tr>

          <Table.Tr>
            <Table.Th>
              <Stat
                label="Outputs"
                icon={
                  <IconArrowBigDownLines
                    size={16}
                    color="var(--mantine-color-grape-filled)"
                  />
                }
                value={null}
              />
            </Table.Th>

            {view.map(({ alt, metrics, factor }) => (
              <Table.Td key={alt.id}>
                <ListCell
                  items={metrics.outputs}
                  label={it => amountLabel(it, factor)}
                  empty="none"
                />
              </Table.Td>
            ))}
          </Table.Tr>

          <Table.Tr>
            <Table.Th>
              <Stat
                label="Inputs"
                icon={
                  <IconArrowBigUpLines
                    size={16}
                    color="var(--mantine-color-teal-filled)"
                  />
                }
                value={null}
              />
            </Table.Th>

            {view.map(({ alt, metrics, factor }) => (
              <Table.Td key={alt.id}>
                <ListCell
                  items={metrics.inputs}
                  label={it => amountLabel(it, factor)}
                  empty="none"
                />
              </Table.Td>
            ))}
          </Table.Tr>

          <Table.Tr>
            <Table.Th>
              <Stat
                label="Disposals"
                icon={
                  <IconCancel
                    size={16}
                    color="var(--mantine-color-orange-filled)"
                  />
                }
                value={null}
              />
            </Table.Th>

            {view.map(({ alt, metrics, factor }) => (
              <Table.Td key={alt.id}>
                <ListCell
                  items={metrics.disposals}
                  label={d => amountLabel(d, factor)}
                  empty="none"
                />
              </Table.Td>
            ))}
          </Table.Tr>

          <Table.Tr>
            <Table.Th>
              <Stat
                label="Machines"
                icon={
                  <IconSettings
                    size={16}
                    color="var(--mantine-color-indigo-filled)"
                  />
                }
                value={null}
              />
            </Table.Th>

            {view.map(({ alt, metrics, factor }) => (
              <Table.Td key={alt.id}>
                <ListCell
                  items={metrics.machines}
                  label={m =>
                    amountLabel(
                      {
                        name: `${m.machine || 'Unnamed machine'} (${m.voltage})`,
                        quantity: m.quantity,
                      },
                      factor,
                    )
                  }
                  empty="none"
                />
              </Table.Td>
            ))}
          </Table.Tr>
        </Table.Tbody>
      </Table>
    </Stack>
  );
};
