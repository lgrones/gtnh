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
  const meMode = useProductionStore(state => state.meMode);

  // recompute live on every graph edit — validateGraph is cheap, no button
  const issues = useMemo(
    () => validateGraph(nodes, edges, meMode),
    [nodes, edges, meMode],
  );

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

// the explicit `string` is what makes the switch exhaustive: without it a new
// GraphIssue kind widens the inferred return to `string | undefined`, which JSX
// accepts silently. With it, adding a kind fails `types:check` here until it is
// given a label — which is the point
const issueLabel = (issue: GraphIssue): string => {
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
    case 'underpowered':
      return 'not enough power to run even one recipe';
    case 'underheated':
      // GT matches a recipe on heat before anything else, so this is a hard
      // "will not run", not a slower run
      return `${issue.supply} K of machine heat, recipe needs ${issue.demand} K`;
    case 'overparallel':
      return `held at ${issue.supply}, the machine would run ${issue.demand}`;
    case 'throttled':
      // GT charges 4^n for every overclock whether or not the duration moved,
      // so these are paid for and wasted, not merely unavailable
      return 'charged for but bought no time';
    case 'unmodeled':
      return 'not in the machine catalog, values used as entered';
    case 'similar':
      // the ledger groups on the item name, so a second spelling reads as a
      // shortage of one item and a surplus of another, neither of them real
      return 'one spelling is likely a typo of the other, splitting the ledger';
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
