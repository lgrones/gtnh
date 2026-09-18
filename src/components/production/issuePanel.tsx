import { Group, Text } from '@mantine/core';
import { IconCircleCheck, IconExclamationCircle } from '@tabler/icons-react';
import { useMemo } from 'react';

import {
  useProductionStore,
  validateGraph,
  type GraphIssue,
} from '@/contexts/productionStore';

import { Panel } from '../common/panel';

export const IssuePanel = () => {
  const nodes = useProductionStore(state => state.nodes);
  const edges = useProductionStore(state => state.edges);

  // recompute live on every graph edit — validateGraph is cheap, no button
  const issues = useMemo(() => validateGraph(nodes, edges), [nodes, edges]);

  return (
    <Panel
      title="Issues"
      action={
        issues.length > 0 && (
          <Text size="sm" c="dimmed">
            {issues.length}
          </Text>
        )
      }
    >
      <Validation issues={issues} />
    </Panel>
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
