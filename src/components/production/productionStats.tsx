import {
  Box,
  Group,
  Paper,
  Stack,
  Text,
  type MantineColor,
} from '@mantine/core';

import {
  useProductionStore,
  type ProductionNode,
  type ProductionNodeType,
} from '@/contexts/productionStore';

export const ProductionStats = () => {
  const nodes = useProductionStore(state => state.nodes);

  return (
    <Paper h="100%" p="md" component={Stack} style={{ overflow: 'auto' }}>
      <Items label="Inputs" nodes={nodes} type="inputNode" color="teal" />
      <Items
        label="Machines"
        nodes={nodes}
        type="recipeNode"
        color="indigo"
        groupBy={node => (node.type === 'recipeNode' ? node.data.machine : '')}
      />
      <Items
        label="Disposals"
        nodes={nodes}
        type="disposalNode"
        color="orange"
      />
      <Items label="Outputs" nodes={nodes} type="outputNode" color="grape" />
    </Paper>
  );
};

interface ItemsProps {
  nodes: ProductionNode[];
  type: ProductionNodeType;
  label: string;
  color: MantineColor;
  groupBy?: (node: ProductionNode) => string;
}

const Items = ({
  nodes,
  type,
  label,
  color,
  groupBy = node => node.data.name,
}: ItemsProps) => {
  const items = Object.groupBy(
    nodes.filter(x => x.type === type),
    groupBy,
  );

  return (
    <Box>
      <Text c="dimmed" size="xs" tt="uppercase" fw={600}>
        {label}
      </Text>

      {Object.entries(items).map(([name, nodes]) => (
        <Group key={name} gap="xs">
          <Box w={12} h={12} bg={color} style={{ borderRadius: '50%' }} />

          <Text>
            {nodes?.reduce(
              (acc, curr) =>
                acc +
                ('quantity' in curr.data ? (curr.data.quantity as number) : 1),
              0,
            )}{' '}
            {name}
          </Text>
        </Group>
      ))}
    </Box>
  );
};
