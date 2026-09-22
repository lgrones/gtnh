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
  steadyRates,
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
  const { bottleneck, machines } = useMemo(
    () => lineMetrics(nodes, edges),
    [nodes, edges],
  );

  // the per-second figures are a flow, settled between the machines, rather
  // than a pass's amounts over a pass's duration — see `steadyRates`
  const { leaves } = useMemo(() => steadyRates(nodes, edges), [nodes, edges]);

  return (
    <Panel title="Statistics">
      <Items
        label="Inputs"
        nodes={nodes}
        rates={leaves}
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
        rates={leaves}
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
        rates={leaves}
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
        label="Cycle time (slowest step)"
        icon={<IconClock size={16} color="var(--mantine-color-blue-filled)" />}
      >
        <Text>{formatDuration(bottleneck)}</Text>
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
  // per leaf node, what it carries per second once the line is running. Read
  // off `steadyRates` rather than divided out of the tally: the amounts here
  // are one pass's worth, and a pass is a ratio the line is written in, not
  // something every machine waits for
  rates?: Map<string, number>;
}

// a Stat whose value is a grouped tally of nodes — "3 Electric Blast Furnace
// (HV)"
const Items = ({
  nodes,
  type,
  label,
  icon,
  groupBy = node => node.data.name,
  rates,
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

            // a leaf nothing is wired into has no flow to report, and quoting
            // 0/s for it would read as a measurement
            const measured = nodes?.filter(node => rates?.has(node.id)) ?? [];
            const rate = measured.length
              ? measured.reduce(
                  (acc, node) => acc + (rates?.get(node.id) ?? 0),
                  0,
                )
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
