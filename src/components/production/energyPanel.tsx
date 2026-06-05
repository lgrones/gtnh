import { Divider, Group, Paper, Select, Stack, Text } from '@mantine/core';
import {
  IconAlertTriangle,
  IconBolt,
  IconClock,
  IconFlame,
  IconSettingsBolt,
} from '@tabler/icons-react';
import { useMemo, useState } from 'react';

import {
  demandByTier,
  lineEnergy,
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

  const { demand, time } = useMemo(
    () => lineEnergy(nodes, edges),
    [nodes, edges],
  );
  const byTier = useMemo(() => demandByTier(nodes), [nodes]);

  // picker selection: generator category and fuel (tier is solved per machine)
  const [categoryId, setCategoryId] = useState(GENERATORS[0]?.id ?? '');
  const [fuelName, setFuelName] = useState<string | null>(null);

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

      <Stat
        icon={<IconClock size={16} color="var(--mantine-color-blue-filled)" />}
        label="Process time (critical path)"
        value={formatDuration(time)}
      />

      <Divider label="Generator" />

      <Select
        label="Type"
        data={GENERATORS.map(c => ({ value: c.id, label: c.name }))}
        value={categoryId}
        onChange={value => {
          if (!value) return;
          setCategoryId(value);
          setFuelName(null); // re-default the fuel to the new category
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
        onChange={setFuelName}
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
          Set EU, time and voltage on recipe nodes to size generators.
        </Text>
      )}
    </Paper>
  );
};
