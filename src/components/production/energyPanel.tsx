import { Divider, Group, Paper, Select, Stack, Text } from '@mantine/core';
import {
  IconAlertTriangle,
  IconBolt,
  IconClock,
  IconFlame,
  IconRotate,
  IconSettingsBolt,
} from '@tabler/icons-react';
import { useMemo } from 'react';

import {
  demandByTier,
  lineEnergy,
  meLedger,
  starvation,
  useProductionStore,
} from '@/contexts/productionStore';
import { GENERATORS, planBank } from '@/domain/generators';

import { Stat } from '../common/stat';

// compact integer / small-decimal formatting
const fmt = (n: number, digits = 0) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits });

// seconds -> "1h 2m 3s" (drops zero leading units; "0s" when empty)
const formatDuration = (totalSeconds: number): string => {
  if (totalSeconds <= 0) return '0s';
  const rounded = Math.round(totalSeconds);
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  return [h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join(' ');
};

export const EnergyPanel = () => {
  const nodes = useProductionStore(state => state.nodes);
  const edges = useProductionStore(state => state.edges);
  const meMode = useProductionStore(state => state.meMode);

  const { demand, time, looped } = useMemo(
    () => lineEnergy(nodes, edges, meMode),
    [nodes, edges, meMode],
  );

  // how far undersupply holds the line below its nominal speed. Only asked in
  // ME mode: a wired line is balanced on per-pass amounts, which say nothing
  // about the rates this is solved from
  const starved = useMemo(
    () => (meMode ? starvation(nodes) : undefined),
    [nodes, meMode],
  );

  // a loop has no critical path, so its products' rates are the useful number
  const products = useMemo(
    () => (meMode && looped ? meLedger(nodes).products : []),
    [nodes, meMode, looped],
  );
  const byTier = useMemo(() => demandByTier(nodes), [nodes]);

  // picker selection lives in the store so it's saved + synced per graph (tier
  // is solved per machine). null fields fall back to the first category/fuel.
  const generator = useProductionStore(state => state.generator);
  const setGenerator = useProductionStore(state => state.setGenerator);
  const categoryId = generator?.categoryId ?? GENERATORS[0]?.id ?? '';
  const fuelName = generator?.fuelName ?? null;

  const category = GENERATORS.find(c => c.id === categoryId) ?? GENERATORS[0];
  const fuel =
    category?.fuels.find(f => f.name === fuelName) ?? category?.fuels[0];

  // GENERATORS is a non-empty static table, so these are always defined; the
  // guard satisfies noUncheckedIndexedAccess without a non-null assertion
  if (!category || !fuel) return null;

  const plan = planBank(category, fuel, byTier);

  return (
    <Paper h="100%" p="md" component={Stack} style={{ overflow: 'auto' }}>
      <Text fw={600}>Energy</Text>

      <Stat
        icon={<IconBolt size={16} color="var(--mantine-color-yellow-filled)" />}
        label="Power demand"
        value={`${fmt(demand, 1)} EU/t`}
      />

      {looped ? (
        <Stat
          icon={
            <IconRotate size={16} color="var(--mantine-color-blue-filled)" />
          }
          label="Throughput (the line loops)"
        >
          {products.length === 0 ? (
            <Text c="dimmed">Nothing leaves the network</Text>
          ) : (
            products.map(product => (
              <Text key={product.name}>
                {fmt(product.net * (starved?.worst ?? 1), 2)}/s {product.name}
              </Text>
            ))
          )}
        </Stat>
      ) : (
        <Stat
          icon={
            <IconClock size={16} color="var(--mantine-color-blue-filled)" />
          }
          label="Process time (critical path)"
          value={formatDuration(time)}
        />
      )}

      {starved !== undefined && starved.worst < 1 && (
        <Stat
          icon={
            <IconAlertTriangle
              size={16}
              color="var(--mantine-color-yellow-filled)"
            />
          }
          label={looped ? 'Held back by' : 'Worst case'}
        >
          {!looped && (
            <Text>
              {formatDuration(time / starved.worst)}{' '}
              <Text span c="dimmed">
                ({fmt(1 / starved.worst, 2)}×)
              </Text>
            </Text>
          )}

          <Text size="sm" c="dimmed">
            {starved.limiting === undefined
              ? 'undersupplied inputs'
              : `${starved.limiting} — the line runs at ${fmt(starved.worst * 100, 0)}% of nominal`}
          </Text>
        </Stat>
      )}

      <Divider label="Generator" />

      <Select
        label="Type"
        data={GENERATORS.map(c => ({ value: c.id, label: c.name }))}
        value={categoryId}
        onChange={value => {
          if (!value) return;
          // re-default the fuel to the new category
          setGenerator({ categoryId: value, fuelName: null });
        }}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
      />

      <Select
        label="Fuel"
        searchable
        data={category.fuels.map(f => ({
          value: f.name,
          label: `${f.name} · ${fmt(f.value, 1)} EU/${category.unit}`,
        }))}
        value={fuel.name}
        onChange={value => setGenerator({ categoryId, fuelName: value })}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
      />

      <Divider label="Plan" />

      {plan.rows.length > 0 ? (
        <>
          <Stack gap="sm">
            {plan.rows.map(row => (
              <Stat
                key={row.tier}
                icon={
                  <Text size="sm" fw={600}>
                    {row.tier}
                  </Text>
                }
                label={
                  <Text size="sm" c="dimmed">
                    {fmt(row.demand, 1)} EU/t · {fmt(row.amps, 1)}A
                  </Text>
                }
              >
                {row.generator ? (
                  <Text size="sm" c="dimmed">
                    {row.count}× {row.generator.name} · {fmt(row.fuelRate, 2)}{' '}
                    {category.unit}/s
                    {row.ampBound && ' · amp-limited'}
                  </Text>
                ) : (
                  <Group gap={4} c="red">
                    <IconAlertTriangle size={14} />
                    <Text size="sm">
                      No {category.name} at {row.tier}
                    </Text>
                  </Group>
                )}
              </Stat>
            ))}
          </Stack>

          <Divider variant="dashed" />

          <Stat
            icon={
              <IconSettingsBolt
                size={16}
                color="var(--mantine-color-yellow-filled)"
              />
            }
            label="Total generators"
            value={`${plan.totalCount}`}
          />

          <Stat
            icon={
              <IconFlame size={16} color="var(--mantine-color-orange-filled)" />
            }
            label="Total fuel"
            value={`${fmt(plan.totalFuelRate, 2)} ${category.unit}/s`}
          />

          {plan.unpowered.length > 0 && (
            <Group gap={4} c="red">
              <IconAlertTriangle size={14} />
              <Text size="sm">
                {category.name} cannot power {plan.unpowered.join(', ')}{' '}
                machines
              </Text>
            </Group>
          )}
        </>
      ) : (
        <Text size="sm" c="dimmed">
          Set EU, time and voltage on recipe nodes to calculate generators
        </Text>
      )}
    </Paper>
  );
};
