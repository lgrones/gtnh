import { Button, Group, Paper, Stack, Text } from '@mantine/core';
import {
  IconChecklist,
  IconCircleCheck,
  IconExclamationCircle,
} from '@tabler/icons-react';
import { useState } from 'react';

import {
  useProductionStore,
  validateGraph,
  type GraphIssue,
} from '@/contexts/productionStore';

export const IssuePanel = () => {
  const nodes = useProductionStore(state => state.nodes);
  const edges = useProductionStore(state => state.edges);

  const [issues, setIssues] = useState<GraphIssue[] | null>(null);

  return (
    <Paper h="100%" p="md" component={Stack} style={{ overflow: 'auto' }}>
      <Text fw={600}>Issues</Text>

      <Button
        variant="filled"
        color="gray.9"
        leftSection={<IconChecklist size={16} />}
        onClick={() => setIssues(validateGraph(nodes, edges))}
        style={{ flexShrink: 0 }}
      >
        Validate
      </Button>

      {issues !== null && <Validation issues={issues} />}
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
