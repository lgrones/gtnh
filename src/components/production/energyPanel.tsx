import {
  ActionIcon,
  Button,
  Divider,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
} from '@mantine/core';
import {
  IconBolt,
  IconFlame,
  IconPlus,
  IconSettingsBolt,
  IconTrash,
  IconWand,
} from '@tabler/icons-react';
import { useMemo } from 'react';

import {
  demandByTier,
  lineEnergy,
  useProductionStore,
  type GeneratorBankEntry,
} from '@/contexts/productionStore';
import {
  bankEntry,
  GENERATORS,
  resolveBank,
  suggestBank,
  TIER_EU,
  type BankRow,
} from '@/domain/generators';

import { Panel } from '../common/panel';
import { Stat } from '../common/stat';

// compact integer / small-decimal formatting
const fmt = (n: number, digits = 0) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits });

export const EnergyPanel = () => {
  const nodes = useProductionStore(state => state.nodes);
  const edges = useProductionStore(state => state.edges);
  // only `demand` is read here, and that is a sum over the machines either way
  // — the timings this panel used to show now live with the rest of the
  // statistics, per mode: the critical path in Statistics, the chain in ME
  const { demand } = useMemo(() => lineEnergy(nodes, edges), [nodes, edges]);

  const byTier = useMemo(() => demandByTier(nodes), [nodes]);

  // the bank lives in the store so it is saved and synced per graph
  const bank = useProductionStore(state => state.generatorBank);
  const setBank = useProductionStore(state => state.setGeneratorBank);

  // what an untouched line is sized in: steam, the one every base has before
  // it has anything else. It is a starting point, not a setting — everything
  // past the first edit is whatever rows the user built
  const category = GENERATORS.find(c => c.id === 'steam') ?? GENERATORS[0];
  const fuel = category?.fuels[0];

  // GENERATORS is a non-empty static table, so these are always defined; the
  // guard satisfies noUncheckedIndexedAccess without a non-null assertion
  if (!category || !fuel) return null;

  const entries = bank ?? suggestBank(category, fuel, byTier);
  const custom = bank !== null;
  const plan = resolveBank(entries, demand);

  const edit = (next: GeneratorBankEntry[]) => setBank(next);
  const replace = (id: string, patch: Partial<GeneratorBankEntry>) =>
    edit(entries.map(row => (row.id === id ? { ...row, ...patch } : row)));

  return (
    <Panel title="Energy">
      <Stat
        icon={<IconBolt size={16} color="var(--mantine-color-yellow-filled)" />}
        label="Power demand"
        value={`${fmt(demand, 1)} EU/t`}
      />

      {byTier.size > 0 && (
        <>
          <Divider label="By tier" labelPosition="center" />

          {/* what draws the power, tier by tier. A reading rather than a rule:
              the bank is pooled, so a transformer chain is assumed to carry
              whatever tier a generator's output lands on */}
          <Stack gap={2}>
            {[...byTier]
              .sort(([a], [b]) => TIER_EU[a] - TIER_EU[b])
              .map(([tier, entry]) => (
                <Group key={tier} justify="space-between" gap="xs">
                  <Text size="sm" fw={600}>
                    {tier}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {fmt(entry.power, 1)} EU/t · {fmt(entry.amps, 1)}A
                  </Text>
                </Group>
              ))}
          </Stack>
        </>
      )}

      <Divider
        label={custom ? 'Generators' : 'Generators (suggested)'}
        labelPosition="center"
      />

      {entries.length > 0 ? (
        <Stack gap="xs">
          {plan.rows.map(row => (
            <BankRowFields
              key={row.entry.id}
              row={row}
              onChange={patch => replace(row.entry.id, patch)}
              onRemove={() =>
                edit(entries.filter(entry => entry.id !== row.entry.id))
              }
            />
          ))}
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">
          No generators. Add one, or take the suggestion.
        </Text>
      )}

      <Group gap="xs">
        <Button
          size="compact-sm"
          variant="light"
          leftSection={<IconPlus size={14} />}
          onClick={() =>
            edit([
              ...entries,
              bankEntry(
                category.id,
                category.tiers[0]?.tier ?? 'LV',
                fuel.name,
                1,
              ),
            ])
          }
        >
          Add
        </Button>

        {custom && (
          <Button
            size="compact-sm"
            variant="subtle"
            color="gray"
            leftSection={<IconWand size={14} />}
            onClick={() => setBank(null)}
          >
            Reset to suggestion
          </Button>
        )}
      </Group>

      <Divider variant="dashed" />

      <Stat
        icon={
          <IconSettingsBolt
            size={16}
            color="var(--mantine-color-yellow-filled)"
          />
        }
        label="Bank output"
      >
        <Text size="sm" c={plan.shortfall > 0 ? 'red' : undefined}>
          {fmt(plan.output, 1)} / {fmt(demand, 1)} EU/t
          {plan.shortfall > 0
            ? ` · ${fmt(plan.shortfall, 1)} short`
            : plan.output > 0 && ` · ${fmt(plan.duty * 100)}% loaded`}
        </Text>
      </Stat>

      <Stat
        icon={
          <IconFlame size={16} color="var(--mantine-color-orange-filled)" />
        }
        label="Fuel"
      >
        {plan.fuels.length > 0
          ? plan.fuels.map(entry => (
              <Text size="sm" key={`${entry.name}:${entry.unit}`}>
                {entry.name} · {fmt(entry.rate, 2)} {entry.unit}/s
              </Text>
            ))
          : '-'}
      </Stat>

      {demand <= 0 && (
        <Text size="sm" c="dimmed">
          Set EU, time and voltage on recipe nodes to calculate generators
        </Text>
      )}
    </Panel>
  );
};

// every generator variant in the table, grouped by its category: one pick
// names both, which is what a row actually is. The value carries the pair
// because a variant's own name does not — some categories spell several of
// theirs the same
const VARIANT_OPTIONS = GENERATORS.map(category => ({
  group: category.name,
  items: category.tiers.map(variant => ({
    value: `${category.id}:${variant.tier}`,
    label: `${variant.name} (${variant.tier})`,
  })),
}));

// one row of the bank: how many, of what, burning what — and what that costs
const BankRowFields = ({
  row,
  onChange,
  onRemove,
}: {
  row: BankRow;
  onChange: (patch: Partial<GeneratorBankEntry>) => void;
  onRemove: () => void;
}) => {
  const { entry, category, variant, fuel } = row;

  return (
    <Stack gap={4}>
      <Group gap="xs" wrap="nowrap" align="center">
        <NumberInput
          size="xs"
          w={64}
          min={0}
          step={1}
          value={entry.count}
          onChange={value =>
            onChange({ count: typeof value === 'number' ? value : 0 })
          }
        />

        <Select
          size="xs"
          flex={1}
          searchable
          data={VARIANT_OPTIONS}
          value={category && variant ? `${category.id}:${variant.tier}` : null}
          placeholder={`${entry.categoryId} (${entry.tier})`}
          onChange={value => {
            const [categoryId, tier] = (value ?? '').split(':');
            const next = GENERATORS.find(c => c.id === categoryId);
            const picked = next?.tiers.find(t => t.tier === tier);
            if (!next || !picked) return;

            onChange({
              categoryId: next.id,
              tier: picked.tier,
              // a category has its own fuels, so the one in hand only survives
              // a move within the same category
              fuelName: next.fuels.some(f => f.name === entry.fuelName)
                ? entry.fuelName
                : (next.fuels[0]?.name ?? ''),
            });
          }}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />

        <ActionIcon variant="subtle" color="gray" onClick={onRemove}>
          <IconTrash size={16} />
        </ActionIcon>
      </Group>

      <Group gap="xs" wrap="nowrap" align="center">
        <Select
          size="xs"
          flex={1}
          searchable
          data={(category?.fuels ?? []).map(f => ({
            value: f.name,
            label: `${f.name} · ${fmt(f.value, 1)} EU/${category?.unit ?? 'L'}`,
          }))}
          value={fuel?.name ?? null}
          placeholder={entry.fuelName || 'Fuel'}
          onChange={value => value && onChange({ fuelName: value })}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />

        <ActionIcon variant="transparent" style={{ visibility: 'hidden' }}>
          <IconTrash size={16} />
        </ActionIcon>
      </Group>

      <Group gap={6} justify="space-between" pr={34}>
        <Text size="xs" c={variant === undefined ? 'red' : 'dimmed'}>
          {variant === undefined
            ? 'not in the generator table'
            : `${fmt(row.output, 1)} EU/t`}
        </Text>

        <Text size="xs" c={fuel === undefined ? 'red' : 'dimmed'}>
          {fuel === undefined
            ? 'unknown fuel'
            : `${fmt(row.fuelRate, 2)} ${category?.unit ?? ''}/s`}
        </Text>
      </Group>
    </Stack>
  );
};
