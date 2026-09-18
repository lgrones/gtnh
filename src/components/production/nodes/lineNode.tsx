import {
  ActionIcon,
  Badge,
  Box,
  Divider,
  Group,
  NumberInput,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowsMaximize,
  IconRefresh,
} from '@tabler/icons-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useShallow } from 'zustand/shallow';

import { useProductionLibrary } from '@/contexts/productionLibrary';
import {
  useProductionStore,
  type LinePort,
  type ProductionNode as IProductionNode,
} from '@/contexts/productionStore';
import { useLineStatus } from '@/contexts/subLine';

import { formatAmount, formatDuration } from '../../common/format';
import { ProductionNode } from './productionNode';

import classes from './productionNode.module.css';

type LineNodeType = Extract<IProductionNode, { type: 'lineNode' }>;

// one port of the collapsed line, with the handle the parent graph wires to.
// The amount shown is what the node actually moves — the source line's own
// figure times the copies of it built here
const Port = ({
  port,
  scale,
  side,
  dimmed,
}: {
  port: LinePort;
  scale: number;
  side: 'input' | 'output';
  dimmed?: boolean;
}) => (
  <Group
    gap="xs"
    className={classes.row}
    justify={side === 'input' ? 'flex-start' : 'flex-end'}
  >
    {side === 'input' && (
      <Handle
        type="target"
        id={port.id}
        position={Position.Left}
        className={classes['recipe-input']}
      />
    )}

    <Text size="sm" c={dimmed === true ? 'dimmed' : undefined}>
      {formatAmount(port.quantity * scale)} {port.name}
    </Text>

    {side === 'output' && (
      <Handle
        type="source"
        id={port.id}
        position={Position.Right}
        className={classes.output}
      />
    )}
  </Group>
);

// A whole saved line, collapsed to one node. It is READ-ONLY here on purpose:
// the recipes behind it belong to the line it stands for, and editing them in
// two places is how the two readings drift apart. Opening it switches the
// canvas to that line; what this node keeps is the contract — what the line
// must be fed, what it hands back, and what it costs to run — so a graph built
// out of these tallies the real cost of the whole tree.
export const LineNode = ({ id, data, ...props }: NodeProps<LineNodeType>) => {
  const { setLineMultiplier, refreshLineNode } = useProductionStore(
    useShallow(state => ({
      setLineMultiplier: state.setLineMultiplier,
      refreshLineNode: state.refreshLineNode,
    })),
  );

  const drillInto = useProductionLibrary(state => state.drillInto);
  const { source, stale } = useLineStatus(data);

  const { capture, multiplier } = data;
  const machines = capture.machines.reduce(
    (total, entry) => total + entry.quantity,
    0,
  );

  return (
    <ProductionNode
      {...props}
      id={id}
      data={data}
      type="none"
      color="violet"
      editable={false}
      leftSection={
        <Tooltip
          label="Cycles — how many passes of this line to run. For a second line built alongside it, place another of these nodes"
          withArrow
          multiline
          w={240}
        >
          <NumberInput
            className="nodrag"
            size="xs"
            w={72}
            min={1}
            step={1}
            hideControls
            allowNegative={false}
            allowDecimal={false}
            rightSection={
              <Text size="xs" c="dimmed" pr={6}>
                C
              </Text>
            }
            rightSectionWidth={20}
            value={multiplier}
            onChange={value =>
              setLineMultiplier(id, typeof value === 'number' ? value : 1)
            }
          />
        </Tooltip>
      }
      rightSection={
        <Group gap={4} wrap="nowrap">
          {stale && source !== undefined && (
            <Tooltip label="The source line changed — adopt it" withArrow>
              <ActionIcon
                className="nodrag"
                variant="subtle"
                color="yellow"
                aria-label="Refresh sub-line"
                onClick={() => refreshLineNode(id, source.name, source.capture)}
              >
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>
          )}

          <Tooltip label="Open this line" withArrow>
            <ActionIcon
              className="nodrag"
              variant="subtle"
              color="gray"
              aria-label="Open sub-line"
              disabled={source === undefined}
              onClick={() => drillInto(data.graphId)}
            >
              <IconArrowsMaximize size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      }
    >
      <Stack pt="xs" miw={320} w="fit-content" maw={560} gap="xs">
        {source === undefined && (
          <Badge
            size="sm"
            variant="light"
            color="red"
            leftSection={<IconAlertTriangle size={12} />}
          >
            Source line deleted — figures frozen
          </Badge>
        )}

        {/* what the whole sub-tree under this node costs to build and run.
            Cycles are passes of the same machines, so only the clock moves */}
        <Group gap="xs" justify="space-between">
          <Text size="xs" c="dimmed">
            {machines} machine{machines === 1 ? '' : 's'}
          </Text>

          <Text size="xs" c="dimmed">
            {formatAmount(capture.demand)} EU/t
          </Text>

          <Text size="xs" c="dimmed">
            {formatDuration(capture.time * multiplier)}
          </Text>
        </Group>

        <Divider />

        {/* the two sides share the width so every handle on a side lines up,
            however wide one of its rows happens to be */}
        <Group align="flex-start" gap="xl" wrap="nowrap" grow>
          <Box>
            <Text c="dimmed" size="xs" tt="uppercase" fw="600">
              Takes
            </Text>

            <Stack gap={4} pt={4}>
              {capture.inputs.length === 0 && (
                <Text size="xs" c="dimmed">
                  nothing
                </Text>
              )}

              {capture.inputs.map(port => (
                <Port
                  key={port.id}
                  port={port}
                  scale={multiplier}
                  side="input"
                />
              ))}
            </Stack>
          </Box>

          <Box>
            <Text c="dimmed" size="xs" tt="uppercase" fw="600" ta="right">
              Gives
            </Text>

            <Stack gap={4} pt={4}>
              {capture.outputs.length + capture.byproducts.length === 0 && (
                <Text size="xs" c="dimmed">
                  nothing
                </Text>
              )}

              {capture.outputs.map(port => (
                <Port
                  key={port.id}
                  port={port}
                  scale={multiplier}
                  side="output"
                />
              ))}

              {/* byproducts leave by the same side as the products; dimmed,
                  because they are what the line sheds rather than what it is for */}
              {capture.byproducts.map(port => (
                <Port
                  key={port.id}
                  port={port}
                  scale={multiplier}
                  side="output"
                  dimmed
                />
              ))}
            </Stack>
          </Box>
        </Group>
      </Stack>
    </ProductionNode>
  );
};
