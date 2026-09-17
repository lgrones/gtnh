import {
  Accordion,
  Box,
  Group,
  Paper,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import {
  IconArrowBigDownLines,
  IconArrowBigUpLines,
  IconBolt,
  IconCircleCheck,
  IconCircleDashedCheck,
  IconSettings,
  IconTrendingDown,
} from '@tabler/icons-react';
import { useReactFlow } from '@xyflow/react';
import { useMemo } from 'react';

import {
  machineAmps,
  machineTier,
  meLedger,
  useProductionStore,
  type LedgerEntry,
} from '@/contexts/productionStore';

import { formatAmount, formatRate } from '../common/format';
import { Stat } from '../common/stat';
import { Items } from './statsPanel';

// the ME network's own statistics: what the line must be fed, what it yields,
// and the machines it takes. Replaces the Inputs / Outputs / Disposals tallies
// of the wired panel, which count leaf nodes ME mode does not use.
export const MeLedgerPanel = () => {
  const nodes = useProductionStore(state => state.nodes);

  const setNodes = useProductionStore(state => state.setNodes);
  const { fitView } = useReactFlow();

  const ledger = useMemo(() => meLedger(nodes), [nodes]);

  // a ledger row names machines, so clicking it should take you to them: select
  // every producer and consumer of that item and frame them. This is what the
  // node ids on a LedgerEntry are carried around for
  const locate = (entry: LedgerEntry) => {
    const ids = new Set([...entry.producers, ...entry.consumers]);

    setNodes(
      useProductionStore
        .getState()
        .nodes.map(node =>
          node.selected === ids.has(node.id)
            ? node
            : { ...node, selected: ids.has(node.id) },
        ),
    );

    void fitView({
      nodes: [...ids].map(id => ({ id })),
      duration: 400,
      padding: 0.3,
    });
  };

  const maxAmperage = nodes
    .filter(node => node.type === 'recipeNode')
    .reduce((acc, node) => Math.max(acc, machineAmps(node.data)), 0);

  return (
    <Paper h="100%" p="md" component={Stack} style={{ overflow: 'auto' }}>
      <Text fw={600}>ME Network</Text>

      <Stat
        label="Required inputs"
        icon={
          <IconArrowBigUpLines
            size={16}
            color="var(--mantine-color-orange-filled)"
          />
        }
      >
        <Entries
          onLocate={locate}
          entries={ledger.required}
          // a required item is short by `net`; show what you must supply, not
          // the negative the arithmetic produced
          amount={entry => -entry.net}
          perPass={entry => entry.consumedPerPass - entry.producedPerPass}
          empty="Nothing — the line feeds itself"
          note={entry =>
            entry.covered === undefined
              ? undefined
              : `${formatRate(entry.covered)}/s on hand`
          }
        />
      </Stat>

      <Stat
        label="Products"
        icon={
          <IconArrowBigDownLines
            size={16}
            color="var(--mantine-color-teal-filled)"
          />
        }
      >
        <Entries
          onLocate={locate}
          entries={ledger.products}
          amount={entry => entry.net}
          perPass={entry => entry.producedPerPass - entry.consumedPerPass}
          empty="Nothing leaves the network"
          // an item the line also eats is only a product by the margin, so say
          // so — otherwise an intermediate piling up looks like a deliverable
          note={entry =>
            entry.consumers.length === 0
              ? undefined
              : `${formatRate(entry.produced)}/s made, ${formatRate(entry.consumed)}/s used here`
          }
        />
      </Stat>

      {ledger.short.length > 0 && (
        <Stat
          label="Not keeping up"
          icon={
            <IconTrendingDown
              size={16}
              color="var(--mantine-color-yellow-filled)"
            />
          }
        >
          <Entries
            onLocate={locate}
            entries={ledger.short}
            amount={entry => -entry.net}
            perPass={entry => entry.consumedPerPass - entry.producedPerPass}
            empty=""
            // both halves, because the fix is more machines on the producing
            // side — not going out and finding the item somewhere
            note={entry =>
              `${formatRate(entry.produced)}/s made, ${formatRate(entry.consumed)}/s drawn`
            }
          />
        </Stat>
      )}

      {ledger.covered.length > 0 && (
        <Stat
          label="Covered"
          icon={
            <IconCircleDashedCheck
              size={16}
              color="var(--mantine-color-dimmed)"
            />
          }
        >
          <Entries
            onLocate={locate}
            entries={ledger.covered}
            // what the line draws, all of it already answered
            amount={entry => -entry.net}
            perPass={entry => entry.consumedPerPass - entry.producedPerPass}
            empty=""
            note={entry =>
              entry.coveredBy === 'free' ? 'freely available' : 'on hand'
            }
            dimmed
          />
        </Stat>
      )}

      {ledger.balanced.length > 0 && (
        <Accordion variant="filled" chevronPosition="left" px={0}>
          <Accordion.Item value="balanced" style={{ border: 'none' }}>
            <Accordion.Control px={0}>
              <Group gap="xs">
                <IconCircleCheck
                  size={16}
                  color="var(--mantine-color-dimmed)"
                />
                <Text c="dimmed" size="xs" tt="uppercase" fw={600}>
                  Balanced · {ledger.balanced.length}
                </Text>
              </Group>
            </Accordion.Control>

            <Accordion.Panel>
              <Entries
                onLocate={locate}
                entries={ledger.balanced}
                amount={entry => entry.produced}
                perPass={entry => entry.producedPerPass}
                empty=""
                dimmed
              />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}

      <Items
        label="Machines"
        nodes={nodes}
        type="recipeNode"
        groupBy={node =>
          node.type === 'recipeNode'
            ? `${node.data.machine} (${machineTier(node.data)})`
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
        groupBy={node =>
          node.type === 'recipeNode' ? machineTier(node.data) : ''
        }
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

interface EntriesProps {
  entries: LedgerEntry[];
  amount: (entry: LedgerEntry) => number;
  perPass: (entry: LedgerEntry) => number;
  empty: string;
  onLocate: (entry: LedgerEntry) => void;
  // an optional second line saying why a row is not the work it looks like
  note?: (entry: LedgerEntry) => string | undefined;
  dimmed?: boolean;
}

const Entries = ({
  entries,
  amount,
  perPass,
  empty,
  onLocate,
  note,
  dimmed,
}: EntriesProps) => {
  if (entries.length === 0)
    return (
      <Text size="sm" c="dimmed">
        {empty}
      </Text>
    );

  return (
    <Stack gap={2}>
      {entries.map(entry => (
        <UnstyledButton key={entry.name} onClick={() => onLocate(entry)}>
          <Group gap="xs" justify="space-between" wrap="nowrap">
            <Box miw={0}>
              <Text size="sm" truncate c={dimmed ? 'dimmed' : undefined}>
                {entry.name}
              </Text>

              {note?.(entry) !== undefined && (
                <Text size="xs" c="dimmed">
                  {note(entry)}
                </Text>
              )}
            </Box>

            <Text
              size="sm"
              c={dimmed ? 'dimmed' : undefined}
              style={{ whiteSpace: 'nowrap' }}
            >
              {formatRate(amount(entry))}/s
              <Text span size="xs" c="dimmed">
                {' '}
                · {formatAmount(perPass(entry))}
              </Text>
            </Text>
          </Group>
        </UnstyledButton>
      ))}
    </Stack>
  );
};
