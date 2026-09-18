import { Text } from '@mantine/core';
import {
  IconArrowBigDownLines,
  IconArrowBigUpLines,
  IconBolt,
  IconClock,
  IconRecycle,
  IconSettings,
} from '@tabler/icons-react';
import { useMemo } from 'react';

import {
  lineMetrics,
  machineAmps,
  useProductionStore,
  type MachineEntry,
  type ProductionNode,
  type ProductionNodeType,
} from '@/contexts/productionStore';

import { formatAmount, formatDuration, formatRate } from '../common/format';
import { Panel } from '../common/panel';
import { Stat } from '../common/stat';

export const StatsPanel = () => {
  const nodes = useProductionStore(state => state.nodes);
  const edges = useProductionStore(state => state.edges);

  const maxAmperage = nodes.reduce(
    (acc, node) =>
      node.type === 'recipeNode'
        ? Math.max(acc, machineAmps(node.data))
        : // a collapsed sub-line brings its own machines' draw with it
          node.type === 'lineNode'
          ? node.data.capture.tiers.reduce(
              (best, tier) => Math.max(best, tier.amps),
              acc,
            )
          : acc,
    0,
  );

  // the machine tally comes from here rather than off the nodes directly,
  // because a collapsed sub-line's machines are real builds too and only
  // `lineMetrics` knows to unpack them
  const { time, machines } = useMemo(
    () => lineMetrics(nodes, edges),
    [nodes, edges],
  );

  return (
    <Panel title="Statistics">
      <Items
        label="Inputs"
        nodes={nodes}
        passSeconds={time}
        type="inputNode"
        icon={
          <IconArrowBigUpLines
            size={16}
            color="var(--mantine-color-teal-filled)"
          />
        }
      />

      <Items
        label="Outputs"
        nodes={nodes}
        passSeconds={time}
        type="outputNode"
        icon={
          <IconArrowBigDownLines
            size={16}
            color="var(--mantine-color-grape-filled)"
          />
        }
      />

      <Items
        label="Byproducts"
        nodes={nodes}
        passSeconds={time}
        type="byproductNode"
        icon={
          <IconRecycle size={16} color="var(--mantine-color-orange-filled)" />
        }
      />

      <Tally
        label="Machines"
        machines={machines}
        groupBy={entry => `${entry.machine} (${entry.voltage})`}
        icon={
          <IconSettings size={16} color="var(--mantine-color-indigo-filled)" />
        }
      />

      <Tally
        label="Voltages"
        machines={machines}
        groupBy={entry => entry.voltage}
        icon={<IconBolt size={16} color="var(--mantine-color-yellow-filled)" />}
      />

      <Stat
        label="Process time (critical path)"
        icon={<IconClock size={16} color="var(--mantine-color-blue-filled)" />}
      >
        <Text>{formatDuration(time)}</Text>
      </Stat>

      <Stat
        label="Max Amperage"
        icon={<IconBolt size={16} color="var(--mantine-color-red-filled)" />}
      >
        <Text>{maxAmperage ? `${maxAmperage} A` : '-'}</Text>
      </Stat>
    </Panel>
  );
};

// a Stat whose value is a grouped machine count — "3 Electric Blast Furnace
// (HV)". Reads `lineMetrics`' tally rather than the nodes, so the machines
// inside a collapsed sub-line are counted alongside the ones on the canvas
const Tally = ({
  label,
  icon,
  machines,
  groupBy,
}: {
  label: string;
  icon: React.ReactNode;
  machines: MachineEntry[];
  groupBy: (entry: MachineEntry) => string;
}) => {
  const grouped = new Map<string, number>();

  for (const entry of machines) {
    const key = groupBy(entry);
    grouped.set(key, (grouped.get(key) ?? 0) + entry.quantity);
  }

  return (
    <Stat icon={icon} label={label}>
      {grouped.size > 0
        ? [...grouped].map(([name, quantity]) => (
            <Text key={name}>
              {formatAmount(quantity)} {name}
            </Text>
          ))
        : '-'}
    </Stat>
  );
};

interface ItemsProps {
  nodes: ProductionNode[];
  type: ProductionNodeType;
  label: string;
  icon: React.ReactNode;
  groupBy?: (node: ProductionNode) => string;
  // how long one pass of the whole line takes. Given, each tally also reads as
  // a rate: the amounts here are per pass, so per pass over the pass's own
  // duration is the only per-second reading that cannot contradict them
  passSeconds?: number;
}

// a Stat whose value is a grouped tally of nodes — "3 Electric Blast Furnace
// (HV)"
const Items = ({
  nodes,
  type,
  label,
  icon,
  groupBy = node => node.data.name,
  passSeconds,
}: ItemsProps) => {
  const items = Object.groupBy(
    nodes.filter(x => x.type === type),
    groupBy,
  );

  return (
    <Stat icon={icon} label={label}>
      {Object.keys(items).length
        ? Object.entries(items).map(([name, nodes]) => {
            const total =
              nodes?.reduce(
                (acc, curr) =>
                  acc +
                  ('quantity' in curr.data
                    ? (curr.data.quantity as number)
                    : 1),
                0,
              ) ?? 0;

            // a line with an unfilled duration has no pass to divide by, and
            // quoting 0/s for it would read as a measurement
            const rate =
              passSeconds !== undefined && passSeconds > 0
                ? total / passSeconds
                : undefined;

            return (
              <Text key={name}>
                {formatAmount(total)} {name}
                {rate !== undefined && (
                  <Text span size="xs" c="dimmed">
                    {' '}
                    · {formatRate(rate)}/s
                  </Text>
                )}
              </Text>
            );
          })
        : '-'}
    </Stat>
  );
};
