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
  IconClock,
  IconRecycle,
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
  lineFlow,
  lineMetrics,
  useProductionStore,
  type ItemAmount,
  type LineMetrics,
} from '@/contexts/productionStore';

import { formatDuration } from '../common/format';
import { Stat } from '../common/stat';
import { rankBy, type Rank } from './compareModal.extensions';

// compact integer / small-decimal formatting (matches energyPanel)
const fmt = (n: number, digits = 0) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits });

type Flow = ReturnType<typeof lineFlow>;

// items per second, which is what every material row here is in: a pass is the
// ratio a line is written in, not a schedule anything waits for.
//
// Three significant digits rather than `formatRate`'s fixed decimals: this table
// exists to tell two alternatives apart, and 0.0347/s against 0.0313/s both read
// as "0.03" when the precision follows the size instead of the difference
const rateLabel = (item: ItemAmount, factor: number) =>
  `${(item.quantity * factor).toLocaleString(undefined, {
    maximumSignificantDigits: 3,
  })}/s ${item.name}`;

// a physical count — machines, not a flow
const countLabel = (item: ItemAmount, factor: number) =>
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
  const [normalize, setNormalize] = useState(true);

  // metrics per alternative: the active one from the live store, the rest decoded
  // from their cached snapshots (read-only, no extra Firestore reads)
  const rows = useMemo(() => {
    if (!line) return [];

    return line.alternatives.map(alt => {
      const graph =
        alt.id === activeGraphId
          ? { nodes: liveNodes, edges: liveEdges }
          : decodeGraph(graphSnapshot(alt.id));

      return {
        alt,
        metrics: lineMetrics(graph.nodes, graph.edges),
        flow: lineFlow(graph.nodes, graph.edges),
      };
    });
  }, [line, activeGraphId, liveNodes, liveEdges]);

  if (!line || rows.length === 0)
    return <Text c="dimmed">No alternatives to compare.</Text>;

  // "match the largest": scale every alternative up to the one handing over the
  // most of the line's primary output PER SECOND — the first locked one, else
  // whatever it makes first. preview only.
  const primary = line.lockedOutputs[0];
  const primaryRate = (flow: Flow) =>
    (primary ? flow.outputs.find(o => o.name === primary) : flow.outputs[0])
      ?.quantity ?? 0;
  const target = Math.max(0, ...rows.map(r => primaryRate(r.flow)));
  const scaling = normalize;
  const factorFor = (flow: Flow) => {
    const rate = primaryRate(flow);
    return scaling && rate > 0 ? target / rate : 1;
  };

  // pair each row with its display scaling factor so cells never index back in
  const view = rows.map(r => ({ ...r, factor: factorFor(r.flow) }));

  // a figure built on a recipe with no EU or no duration is a hole, not a
  // measurement. Showing the 0 would be bad enough; ranking it would hand the
  // green arrow to whichever alternative is least finished
  const powerKnown = (m: LineMetrics) => m.demand > 0 || m.incomplete === 0;
  const timeKnown = (m: LineMetrics) => m.bottleneck > 0 || m.incomplete === 0;

  const gaps = (m: LineMetrics) =>
    `${m.incomplete} recipe${m.incomplete === 1 ? '' : 's'} with no EU or duration set`;

  // Everything physical scales with the factor: matching a higher output RATE
  // means building more of the line, not running the same machines longer. So
  // the draw of the normalized build scales with its machines
  const rankPower = rankBy(
    view,
    x => x.metrics.demand * x.factor,
    x => powerKnown(x.metrics),
  );
  const rankings: Record<string, Record<'power', Rank>> = Object.fromEntries(
    view.map(x => [x.alt.id, { power: rankPower(x) }]),
  );

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
          checked={scaling}
          onChange={e => setNormalize(e.currentTarget.checked)}
          label="Normalize to equal output rate"
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
                  {powerKnown(metrics) ? (
                    <Text size="sm">
                      {fmt(metrics.demand * factor, 1)} EU/t
                    </Text>
                  ) : (
                    <Tooltip label={gaps(metrics)}>
                      <Text size="sm" c="dimmed">
                        —
                      </Text>
                    </Tooltip>
                  )}
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

          {/* Reference, not a contest: the slowest step decides how often a
              line hands a pass over, but a pass is as big as the ratio each
              alternative is written in. Two ways of making the same thing at the
              same rate can differ five-fold here and be equals. Unscaled and
              unranked for that reason — the material rows carry the comparison */}
          <Table.Tr>
            <Table.Th>
              <Stat
                icon={
                  <IconClock
                    size={16}
                    color="var(--mantine-color-blue-filled)"
                  />
                }
                label="Slowest step"
                value={null}
              />
            </Table.Th>

            {view.map(({ alt, metrics }) => (
              <Table.Td key={alt.id}>
                {timeKnown(metrics) ? (
                  <Text size="sm" c="dimmed">
                    {formatDuration(metrics.bottleneck)}
                  </Text>
                ) : (
                  <Tooltip label={gaps(metrics)}>
                    <Text size="sm" c="dimmed">
                      —
                    </Text>
                  </Tooltip>
                )}
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

            {view.map(({ alt, flow, factor }) => (
              <Table.Td key={alt.id}>
                <ListCell
                  items={flow.outputs}
                  label={it => rateLabel(it, factor)}
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

            {view.map(({ alt, flow, factor }) => (
              <Table.Td key={alt.id}>
                <ListCell
                  items={flow.inputs}
                  label={it => rateLabel(it, factor)}
                  empty="none"
                />
              </Table.Td>
            ))}
          </Table.Tr>

          <Table.Tr>
            <Table.Th>
              <Stat
                label="Byproducts"
                icon={
                  <IconRecycle
                    size={16}
                    color="var(--mantine-color-orange-filled)"
                  />
                }
                value={null}
              />
            </Table.Th>

            {view.map(({ alt, flow, factor }) => (
              <Table.Td key={alt.id}>
                <ListCell
                  items={flow.byproducts}
                  label={d => rateLabel(d, factor)}
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
                    // matching another alternative's output RATE means building
                    // more of this line, so the count scales with it. A
                    // fractional one is honest: 2.1 Sifters is "two is short"
                    countLabel(
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
