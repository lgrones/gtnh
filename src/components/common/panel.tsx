import {
  type MantineSpacing,
  Box,
  Group,
  Paper,
  Stack,
  Text,
} from '@mantine/core';

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
  children: React.ReactNode;
}

// Every side panel is one of these: a pinned head and a body that scrolls
// inside it. The panel itself never grows — it fills the pane it is given and
// no more, which is what stops a long issue list from pushing the whole column
// off the bottom of the screen. How tall that pane is, is the splitter's
// business (see common/splitColumn).
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
  children,
}: PanelProps) => (
  <Paper
    h="100%"
    p="md"
    component={Stack}
    gap="xs"
    style={{ overflow: 'hidden', minHeight: 0 }}
  >
    <Group justify="space-between" wrap="nowrap" gap="xs">
      {typeof title === 'string' ? <Text fw={600}>{title}</Text> : title}

      {action}
    </Group>

    {pinned}

    {/* the scroller reaches the panel's padding edge rather than stopping at
        its content box, so a row that bleeds into the padding — the
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
  </Paper>
);
