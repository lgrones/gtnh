import { Group, Paper, Stack, Text } from '@mantine/core';
import { IconCircleCheck, IconExclamationCircle } from '@tabler/icons-react';
import { useMemo } from 'react';

import {
  useProductionStore,
  validateGraph,
  type GraphIssue,
} from '@/contexts/productionStore';

export const IssuePanel = () => {
  const nodes = useProductionStore(state => state.nodes);
  const edges = useProductionStore(state => state.edges);

  // recompute live on every graph edit — validateGraph is cheap, no button
  const issues = useMemo(() => validateGraph(nodes, edges), [nodes, edges]);

  return (
    <Paper h="100%" p="md" component={Stack} style={{ overflow: 'auto' }}>
      <Group justify="space-between">
        <Text fw={600}>Issues</Text>
        {issues.length > 0 && (
          <Text size="sm" c="dimmed">
            {issues.length}
          </Text>
        )}
      </Group>

      <Validation issues={issues} />
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
    case 'incomplete':
      return 'not set';
    case 'mismatch':
      return 'connected item names differ';
  }
};

const Validation = ({ issues }: { issues: GraphIssue[] }) => {
  if (issues.length === 0)
    return (
      <Group gap="xs" c="teal">
        <IconCircleCheck size={16} />
        <Text>No issues</Text>
      </Group>
    );

  return (
    <>
      {issues.map((issue, i) => (
        <Group gap="xs" align="start" key={i}>
          <IconExclamationCircle
            size={16}
            color="var(--mantine-color-orange-filled)"
            style={{ minWidth: 16, minHeight: 16, marginTop: 4 }}
          />
          <Text>
            {issue.recipe} · {issue.item}: {issueLabel(issue)}
          </Text>
        </Group>
      ))}
    </>
  );
};
