import {
  type MantineSpacing,
  ActionIcon,
  Box,
  Group,
  Paper,
  Stack,
  Text,
} from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';

interface PanelProps {
  // stays put while the body scrolls, so a panel with a hundred rows still
  // says what it is
  title: React.ReactNode;
  // an optional control or count on the title row
  action?: React.ReactNode;
  // anything else that must stay reachable regardless of scroll — a tab strip
  // that scrolls away is a tab strip you cannot get back to
  pinned?: React.ReactNode;
  // spacing between the body's own children; a list of rows wants less than a
  // column of labelled stats does
  gap?: MantineSpacing;
  // pass a handler to get a chevron that folds the panel down to its head. The
  // state is the caller's because the surrounding grid has to know too —
  // a collapsed panel should give its row's height to its neighbour, not keep
  // it empty
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  children: React.ReactNode;
}

// Every side panel is one of these: a pinned head and a body that scrolls
// inside it. The panel itself never grows — it fills the grid row it is given
// and no more, which is what stops a long issue list from pushing the whole
// column off the bottom of the screen.
//
// `minHeight: 0` is the load-bearing part in both places. A flex or grid child
// defaults to a minimum size of its content, so without it the body would
// refuse to shrink below its natural height and overflow the panel instead of
// scrolling within it.
export const Panel = ({
  title,
  action,
  pinned,
  gap = 'md',
  collapsed = false,
  onToggleCollapse,
  children,
}: PanelProps) => (
  <Paper
    h={collapsed ? undefined : '100%'}
    p="md"
    component={Stack}
    gap="xs"
    style={{ overflow: 'hidden', minHeight: 0 }}
  >
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Group gap={6} wrap="nowrap" miw={0}>
        {onToggleCollapse !== undefined && (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
            aria-expanded={!collapsed}
          >
            <IconChevronRight
              size={16}
              style={{
                transform: collapsed ? undefined : 'rotate(90deg)',
                transition: 'transform 150ms ease',
              }}
            />
          </ActionIcon>
        )}

        {typeof title === 'string' ? <Text fw={600}>{title}</Text> : title}
      </Group>

      {action}
    </Group>

    {!collapsed && (
      <>
        {pinned}

        {/* the scroller reaches the panel's padding edge rather than stopping
            at its content box, so a row that bleeds into the padding — the
            selected-line highlight does — keeps its rounded corners instead of
            being clipped square. The scrollbar sits at the edge as a bonus */}
        <Box
          flex={1}
          mx="calc(var(--mantine-spacing-md) * -1)"
          px="md"
          style={{ overflowY: 'auto', minHeight: 0 }}
        >
          <Stack gap={gap}>{children}</Stack>
        </Box>
      </>
    )}
  </Paper>
);
