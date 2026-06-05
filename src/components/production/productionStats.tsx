import {
  Box,
  Button,
  Divider,
  Group,
  Paper,
  Stack,
  Text,
  type MantineColor,
} from '@mantine/core';
import { IconCircleCheck, IconChecklist } from '@tabler/icons-react';
import { useState } from 'react';

import {
  useProductionStore,
  validateGraph,
  type GraphIssue,
  type ProductionNode,
  type ProductionNodeType,
} from '@/contexts/productionStore';

export const ProductionStats = () => {
  const nodes = useProductionStore(state => state.nodes);
  const edges = useProductionStore(state => state.edges);

  // snapshot from the last Validate click — not recomputed while editing
  const [issues, setIssues] = useState<GraphIssue[] | null>(null);

  return (
    <Paper h="100%" p="md" component={Stack} style={{ overflow: 'auto' }}>
      <Button
        variant="light"
        color="indigo"
        leftSection={<IconChecklist size={16} />}
        onClick={() => setIssues(validateGraph(nodes, edges))}
        style={{ flexShrink: 0 }}
      >
        Validate
      </Button>

      {issues !== null && <Validation issues={issues} />}

      <Divider />

      <Text fw={600}>Statistics</Text>

      <Items label="Inputs" nodes={nodes} type="inputNode" color="teal" />

      <Items
        label="Disposals"
        nodes={nodes}
        type="disposalNode"
        color="orange"
      />

      <Items label="Outputs" nodes={nodes} type="outputNode" color="grape" />

      <Items
        label="Machines"
        nodes={nodes}
        type="recipeNode"
        color="indigo"
        groupBy={node => (node.type === 'recipeNode' ? node.data.machine : '')}
      />

      <Items
        label="Voltage"
        nodes={nodes}
        type="recipeNode"
        color="yellow"
        groupBy={node => (node.type === 'recipeNode' ? node.data.voltage : '')}
      />

      <ItemGroup label="Max Amperage">
        {!!nodes.filter(x => x.type === 'recipeNode').length && (
          <Item color="red">
            <Text>
              {nodes
                .filter(x => x.type === 'recipeNode')
                .reduce(
                  (acc, curr) => Math.max(acc, curr.data.amperage),
                  0,
                )}{' '}
              A
            </Text>
          </Item>
        )}
      </ItemGroup>

      <ItemGroup label="Steam">
        {!!nodes.filter(x => x.type === 'recipeNode').length && (
          <Item color="cyan">
            <Text>
              {nodes
                .filter(x => x.type === 'recipeNode')
                .reduce((acc, curr) => acc + curr.data.steam, 0)}{' '}
              L/t
            </Text>
          </Item>
        )}
      </ItemGroup>
    </Paper>
  );
};

const issueLabel = (issue: GraphIssue) => {
  switch (issue.kind) {
    case 'deficit':
      return `needs ${issue.demand}, supplies ${issue.supply}`;
    case 'surplus':
      return `${(issue.supply ?? 0) - (issue.demand ?? 0)} unused, no sink`;
    case 'unfed':
      return 'no source';
  }
};

const Validation = ({ issues }: { issues: GraphIssue[] }) => {
  if (issues.length === 0)
    return (
      <Group gap="xs" c="teal">
        <IconCircleCheck size={16} />
        <Text size="sm">No issues</Text>
      </Group>
    );

  return (
    <ItemGroup label="Issues">
      {issues.map((issue, i) => (
        <Item color="red" key={i}>
          <Text size="sm">
            {issue.recipe} · {issue.item}: {issueLabel(issue)}
          </Text>
        </Item>
      ))}
    </ItemGroup>
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
    <ItemGroup label={label}>
      {Object.entries(items).map(([name, nodes]) => (
        <Item color={color} key={name}>
          <Text>
            {nodes?.reduce(
              (acc, curr) =>
                acc +
                ('quantity' in curr.data ? (curr.data.quantity as number) : 1),
              0,
            )}{' '}
            {name}
          </Text>
        </Item>
      ))}
    </ItemGroup>
  );
};

interface ItemGroupProps {
  label: string;
  children: React.ReactNode;
}

const ItemGroup = ({ label, children }: ItemGroupProps) => {
  return (
    <Box>
      <Text c="dimmed" size="xs" tt="uppercase" fw={600}>
        {label}
      </Text>

      {children}
    </Box>
  );
};

interface ItemProps {
  color: MantineColor;
  children: React.ReactNode;
}

const Item = ({ color, children }: ItemProps) => {
  return (
    <Group gap="xs">
      <Box w={12} h={12} bg={color} style={{ borderRadius: '50%' }} />
      {children}
    </Group>
  );
};
