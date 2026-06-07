import { Paper, Stack, Text } from '@mantine/core';
import {
  IconArrowBigDownLines,
  IconArrowBigUpLines,
  IconBolt,
  IconCancel,
  IconSettings,
} from '@tabler/icons-react';

import {
  useProductionStore,
  type ProductionNode,
  type ProductionNodeType,
} from '@/contexts/productionStore';

import { Stat } from '../common/stat';

export const StatsPanel = () => {
  const nodes = useProductionStore(state => state.nodes);
  const maxAmperage = nodes
    .filter(x => x.type === 'recipeNode')
    .reduce((acc, curr) => Math.max(acc, curr.data.amperage), 0);

  return (
    <Paper h="100%" p="md" component={Stack} style={{ overflow: 'auto' }}>
      <Text fw={600}>Statistics</Text>

      <Items
        label="Inputs"
        nodes={nodes}
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
        type="outputNode"
        icon={
          <IconArrowBigDownLines
            size={16}
            color="var(--mantine-color-grape-filled)"
          />
        }
      />

      <Items
        label="Disposals"
        nodes={nodes}
        type="disposalNode"
        icon={
          <IconCancel size={16} color="var(--mantine-color-orange-filled)" />
        }
      />

      <Items
        label="Machines"
        nodes={nodes}
        type="recipeNode"
        groupBy={node =>
          node.type === 'recipeNode'
            ? `${node.data.machine} (${node.data.voltage})`
            : ''
        }
        icon={
          <IconSettings size={16} color="var(--mantine-color-indigo-filled)" />
        }
      />

      <Items
        label="Voltages"
        nodes={nodes}
        type="recipeNode"
        groupBy={node => (node.type === 'recipeNode' ? node.data.voltage : '')}
        icon={<IconBolt size={16} color="var(--mantine-color-yellow-filled)" />}
      />

      <Stat
        label="Max Amperage"
        icon={<IconBolt size={16} color="var(--mantine-color-red-filled)" />}
      >
        <Text>{maxAmperage ? `${maxAmperage} A` : '-'}</Text>
      </Stat>
    </Paper>
  );
};

interface ItemsProps {
  nodes: ProductionNode[];
  type: ProductionNodeType;
  label: string;
  icon: React.ReactNode;
  groupBy?: (node: ProductionNode) => string;
}

const Items = ({
  nodes,
  type,
  label,
  icon,
  groupBy = node => node.data.name,
}: ItemsProps) => {
  const items = Object.groupBy(
    nodes.filter(x => x.type === type),
    groupBy,
  );

  return (
    <Stat icon={icon} label={label}>
      {Object.keys(items).length
        ? Object.entries(items).map(([name, nodes]) => (
            <Text key={name}>
              {nodes?.reduce(
                (acc, curr) =>
                  acc +
                  ('quantity' in curr.data
                    ? (curr.data.quantity as number)
                    : 1),
                0,
              )}{' '}
              {name}
            </Text>
          ))
        : '-'}
    </Stat>
  );
};
