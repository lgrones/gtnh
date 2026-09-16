import {
  ActionIcon,
  Box,
  Button,
  Collapse,
  Divider,
  Group,
  NumberInput,
  Popover,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconChevronRight,
  IconDots,
  IconPlus,
  IconSettings,
  IconX,
} from '@tabler/icons-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/shallow';

import {
  DEFAULT_HATCH_AMPS,
  useProductionStore,
  VOLTAGE_TIERS,
  type EnergyHatch,
  type ProductionNode as IProductionNode,
} from '@/contexts/productionStore';
import { MACHINE_OPTIONS, matchesMachine } from '@/domain/machines/catalog';
import {
  basePower,
  overclock,
  recipeTier,
  suppliedPower,
  tierAbove,
} from '@/domain/overclock';
import { RECIPE_TIER_EU } from '@/domain/tiers';

import { ProductionNode } from './productionNode';

import classes from './productionNode.module.css';

type RecipeNodeType = Extract<IProductionNode, { type: 'recipeNode' }>;

const fmt = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });

// right-section adornments are abbreviated to keep the fields narrow; the full
// name lives in a tooltip. rightSectionPointerEvents must be `auto` for hover
// `w` wraps the tooltip for the fields whose unit needs a sentence rather than
// a name — the parallel ceiling being the one that does
const Unit = ({
  abbr,
  label,
  w,
}: {
  abbr: string;
  label: string;
  w?: number;
}) => (
  <Tooltip label={label} withArrow multiline={w !== undefined} w={w}>
    <Text size="sm" c="dimmed" pr={6} style={{ cursor: 'help' }}>
      {abbr}
    </Text>
  </Tooltip>
);

const KIND_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'multi', label: 'Multi' },
];

export const RecipeNode = ({
  id,
  data,
  ...props
}: NodeProps<RecipeNodeType>) => {
  const {
    addRecipeInput,
    addRecipeOutput,
    updateRecipeInput,
    updateRecipeOutput,
    removeRecipeInput,
    removeRecipeOutput,
    updateRecipe,
  } = useProductionStore(
    useShallow(state => ({
      addRecipeInput: state.addRecipeInput,
      addRecipeOutput: state.addRecipeOutput,
      updateRecipeInput: state.updateRecipeInput,
      updateRecipeOutput: state.updateRecipeOutput,
      removeRecipeInput: state.removeRecipeInput,
      removeRecipeOutput: state.removeRecipeOutput,
      updateRecipe: state.updateRecipe,
    })),
  );

  // the machine's declared parallel cap, for the ceiling field's placeholder.
  // overclock() is memoised per node data, so this costs nothing beyond the
  // lookup Calculations below already pays for
  const machineCap = overclock(data).parallel.machineCap;

  // focus the newest item's name field when a row is added — driven by the add
  // event, not a length-diff effect. the flag is set on add, then consumed by
  // the (stable) callback ref of the last row as it mounts
  const focusInput = useRef(false);
  const focusOutput = useRef(false);

  const addInput = () => {
    focusInput.current = true;
    addRecipeInput(id);
  };

  const addOutput = () => {
    focusOutput.current = true;
    addRecipeOutput(id);
  };

  const inputRef = useCallback((el: HTMLInputElement | null) => {
    if (el && focusInput.current) {
      el.focus();
      focusInput.current = false;
    }
  }, []);

  const outputRef = useCallback((el: HTMLInputElement | null) => {
    if (el && focusOutput.current) {
      el.focus();
      focusOutput.current = false;
    }
  }, []);

  return (
    <ProductionNode
      id={id}
      data={data}
      {...props}
      type="none"
      color="indigo"
      rightSection={
        <SegmentedControl
          ml="auto"
          size="xs"
          // no separators between segments — the node's inputs have no internal
          // rules either, and a pill plus a hairline reads as two borders
          withItemsBorders={false}
          classNames={{
            root: classes['kind-root'],
            indicator: classes['kind-indicator'],
            label: classes['kind-label'],
          }}
          data={KIND_OPTIONS}
          value={data.kind}
          // switching shape clears the machine: a hand-typed singleblock name
          // is never a valid catalog entry, and vice versa
          onChange={value =>
            updateRecipe(id, {
              kind: value === 'multi' ? 'multi' : 'single',
              machine: '',
            })
          }
        />
      }
    >
      <Stack pt="xs" w={400}>
        {/* what the machine IS */}
        <Group gap="sm" wrap="nowrap">
          {data.kind === 'multi' ? (
            <Select
              flex={1}
              searchable
              placeholder="Multiblock"
              data={MACHINE_OPTIONS}
              value={data.machine === '' ? null : data.machine}
              onChange={value => updateRecipe(id, { machine: value ?? '' })}
              // the options are flat strings, so anything with a `value` is an
              // option rather than a group header
              filter={({ options, search }) =>
                options.filter(
                  option =>
                    'value' in option && matchesMachine(option.value, search),
                )
              }
              comboboxProps={{ width: 280 }}
            />
          ) : (
            <TextInput
              flex={1}
              placeholder="Machine"
              value={data.machine}
              onChange={event =>
                updateRecipe(id, { machine: event.currentTarget.value })
              }
            />
          )}

          {/* a singleblock is powered by its voltage alone, so the tier sits
              with the machine rather than in a Power section of its own */}
          {data.kind === 'single' && (
            <Select
              w={92}
              data={VOLTAGE_TIERS}
              value={data.voltage}
              onChange={value => value && updateRecipe(id, { voltage: value })}
              comboboxProps={{ width: 'auto' }}
            />
          )}

          <NumberInput
            w={70}
            min={1}
            hideControls
            allowNegative={false}
            allowDecimal={false}
            value={data.multiplier}
            onChange={value =>
              updateRecipe(id, {
                multiplier: typeof value === 'number' ? value : data.multiplier,
              })
            }
            rightSection={<Unit abbr="C" label="Cycles" />}
            rightSectionPointerEvents="auto"
            rightSectionWidth={28}
          />
        </Group>

        {data.kind === 'multi' && (
          <>
            <Divider />

            {/* what FEEDS it */}
            <Box>
              <Text c="dimmed" size="xs" tt="uppercase" fw="600" pb={4}>
                Power
              </Text>

              <Group gap="sm">
                <HatchField id={id} hatches={data.hatches} />

                {/* the machine's own cap is real data now, so this is a
                    ceiling the user opts into rather than a number they have
                    to know. empty means "whatever the machine can do" */}
                <NumberInput
                  w={78}
                  min={1}
                  hideControls
                  allowNegative={false}
                  allowDecimal={false}
                  placeholder={String(machineCap)}
                  value={data.parallelLimit ?? ''}
                  onChange={value =>
                    updateRecipe(id, {
                      parallelLimit:
                        typeof value === 'number' && value > 0
                          ? value
                          : undefined,
                    })
                  }
                  rightSection={
                    <Unit
                      abbr="P"
                      w={260}
                      label={`Parallel ceiling. Left empty the machine runs its own cap, which is ${machineCap} here — set this only to hold it below what its buses can actually feed.`}
                    />
                  }
                  rightSectionPointerEvents="auto"
                  rightSectionWidth={26}
                />
              </Group>
            </Box>
          </>
        )}

        <Divider />

        {/* what the RECIPE costs, exactly as NEI states it */}
        <Box>
          <Text c="dimmed" size="xs" tt="uppercase" fw="600" pb={4}>
            Recipe
          </Text>

          <Group gap="sm">
            <NumberInput
              w={216}
              min={0}
              hideControls
              allowNegative={false}
              thousandSeparator=","
              value={data.eu}
              onChange={value =>
                updateRecipe(id, {
                  eu: typeof value === 'number' ? value : data.eu,
                })
              }
              rightSection={
                <Text
                  size="sm"
                  c="dimmed"
                  pr={6}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  Total EU
                </Text>
              }
              rightSectionPointerEvents="none"
              rightSectionWidth={70}
            />

            <NumberInput
              w={70}
              min={0}
              hideControls
              allowNegative={false}
              value={data.time}
              onChange={value =>
                updateRecipe(id, {
                  time: typeof value === 'number' ? value : data.time,
                })
              }
              rightSection={<Unit abbr="s" label="Seconds" />}
              rightSectionPointerEvents="auto"
              rightSectionWidth={24}
            />

            {/* amps are a property of the RECIPE, not of how it is powered —
                multiblock recipes have them too (the Arc Furnace needs 3A) */}
            <NumberInput
              w={70}
              min={1}
              hideControls
              allowNegative={false}
              allowDecimal={false}
              value={data.amperage}
              onChange={value =>
                updateRecipe(id, {
                  amperage: typeof value === 'number' ? value : data.amperage,
                })
              }
              rightSection={<Unit abbr="A" label="Amperage" />}
              rightSectionPointerEvents="auto"
              rightSectionWidth={26}
            />
          </Group>
        </Box>

        <Divider />

        {/* what it all COMES TO — computed, never typed into */}
        <Calculations data={data} />

        <Divider />

        <Box>
          <Group justify="space-between">
            <Text c="dimmed" size="xs" tt="uppercase" fw="600">
              Inputs
            </Text>

            <ActionIcon variant="subtle" color="gray" onClick={addInput}>
              <IconPlus size={16} />
            </ActionIcon>
          </Group>

          <Stack gap="xs">
            {data.inputs.map((input, i, arr) => (
              <Group key={input.id} gap="xs" className={classes.row}>
                <Handle
                  type="target"
                  id={input.id}
                  position={Position.Left}
                  className={classes['recipe-input']}
                />

                <NumberInput
                  size="sm"
                  w={60}
                  min={1}
                  allowNegative={false}
                  allowDecimal={false}
                  hideControls
                  value={input.quantity}
                  onChange={value =>
                    updateRecipeInput(id, input.id, {
                      quantity:
                        typeof value === 'number' ? value : input.quantity,
                    })
                  }
                />

                <TextInput
                  size="sm"
                  flex={1}
                  placeholder="Item"
                  value={input.name}
                  onChange={event =>
                    updateRecipeInput(id, input.id, {
                      name: event.currentTarget.value,
                    })
                  }
                  ref={i === arr.length - 1 ? inputRef : null}
                  onKeyDown={e => e.key === 'Enter' && addInput()}
                />

                <ActionIcon
                  variant="subtle"
                  color="gray"
                  onClick={() => removeRecipeInput(id, input.id)}
                >
                  <IconX size={16} />
                </ActionIcon>
              </Group>
            ))}
          </Stack>
        </Box>

        <Divider
          label={
            <IconSettings
              size={20}
              strokeWidth={1.5}
              className={classes.gear}
            />
          }
        />

        <Box mt={-6}>
          <Group justify="space-between">
            <Text c="dimmed" size="xs" tt="uppercase" fw="600">
              Outputs
            </Text>

            <ActionIcon variant="subtle" color="gray" onClick={addOutput}>
              <IconPlus size={16} />
            </ActionIcon>
          </Group>

          <Stack gap="xs" pb="xs">
            {data.outputs.map((output, i, arr) => (
              <Group key={output.id} gap="xs" className={classes.row}>
                <NumberInput
                  size="sm"
                  w={60}
                  min={1}
                  allowNegative={false}
                  allowDecimal={false}
                  hideControls
                  value={output.quantity}
                  onChange={value =>
                    updateRecipeOutput(id, output.id, {
                      quantity:
                        typeof value === 'number' ? value : output.quantity,
                    })
                  }
                />

                <TextInput
                  size="sm"
                  flex={1}
                  placeholder="Item"
                  value={output.name}
                  onChange={event =>
                    updateRecipeOutput(id, output.id, {
                      name: event.currentTarget.value,
                    })
                  }
                  ref={i === arr.length - 1 ? outputRef : null}
                  onKeyDown={e => e.key === 'Enter' && addOutput()}
                />

                <ActionIcon
                  variant="subtle"
                  color="gray"
                  onClick={() => removeRecipeOutput(id, output.id)}
                >
                  <IconX size={16} />
                </ActionIcon>

                <Handle
                  type="source"
                  id={output.id}
                  position={Position.Right}
                  className={classes.output}
                />
              </Group>
            ))}
          </Stack>
        </Box>
      </Stack>
    </ProductionNode>
  );
};

// energy hatches feeding a multiblock. the normal build is one group of
// identical hatches, which is what the inline controls edit; the popover is
// there for the rare mixed-tier setup
const HatchField = ({
  id,
  hatches,
}: {
  id: string;
  hatches: EnergyHatch[];
}) => {
  const updateRecipe = useProductionStore(state => state.updateRecipe);
  const [opened, setOpened] = useState(false);

  const set = (next: EnergyHatch[]) =>
    updateRecipe(id, {
      hatches:
        next.length > 0
          ? next
          : [{ tier: 'LV', count: 1, amps: DEFAULT_HATCH_AMPS }],
    });

  const only = hatches.length === 1 ? hatches[0] : undefined;

  // the mixed-tier editor. its trigger is merged onto the field beside it, the
  // way Button.Group joins buttons — shared edge, no double border
  const editor = (target: ReactNode) => (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      arrowPosition="center"
      withArrow
      shadow="md"
    >
      <Popover.Target>{target}</Popover.Target>

      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            Mixed hatch tiers
          </Text>

          {hatches.map((hatch, index) => (
            <Group gap={4} key={index} wrap="nowrap">
              <Select
                w={80}
                data={VOLTAGE_TIERS}
                value={hatch.tier}
                onChange={value =>
                  value &&
                  set(
                    hatches.map((x, i) =>
                      i === index ? { ...x, tier: value } : x,
                    ),
                  )
                }
                comboboxProps={{ width: 'auto' }}
              />

              <NumberInput
                w={72}
                min={1}
                hideControls
                allowNegative={false}
                allowDecimal={false}
                value={hatch.count}
                onChange={value =>
                  set(
                    hatches.map((x, i) =>
                      i === index
                        ? { ...x, count: typeof value === 'number' ? value : 1 }
                        : x,
                    ),
                  )
                }
              />

              <ActionIcon
                variant="subtle"
                color="gray"
                disabled={hatches.length === 1}
                onClick={() => set(hatches.filter((_, i) => i !== index))}
                aria-label="Remove hatch group"
              >
                <IconX size={16} />
              </ActionIcon>
            </Group>
          ))}

          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconPlus size={14} />}
            onClick={() =>
              set([
                ...hatches,
                { tier: 'LV', count: 1, amps: DEFAULT_HATCH_AMPS },
              ])
            }
          >
            Add tier
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );

  const trigger = (
    <ActionIcon
      variant="outline"
      bg="black"
      c="dark.0"
      bd="1px solid dark.7"
      h={36}
      w={30}
      onClick={() => setOpened(o => !o)}
      aria-label="Mixed hatch tiers"
      // square off the joined edge and pull it onto the field's border
      style={{
        borderTopLeftRadius: 0,
        borderBottomLeftRadius: 0,
        marginLeft: -1,
      }}
    >
      <IconDots size={14} />
    </ActionIcon>
  );

  if (only === undefined)
    return (
      <Group gap={4} wrap="nowrap">
        <Text size="sm">
          {hatches.map(x => `${x.count}× ${x.tier}`).join(' + ')}
        </Text>
        {editor(trigger)}
      </Group>
    );

  return (
    <Group gap="sm" wrap="nowrap">
      <Select
        w={80}
        data={VOLTAGE_TIERS}
        value={only.tier}
        onChange={value => value && set([{ ...only, tier: value }])}
        comboboxProps={{ width: 'auto' }}
      />

      <Group gap={0} wrap="nowrap">
        <NumberInput
          w={70}
          min={1}
          hideControls
          allowNegative={false}
          allowDecimal={false}
          value={only.count}
          onChange={value =>
            set([{ ...only, count: typeof value === 'number' ? value : 1 }])
          }
          rightSection={<Unit abbr="EH" label="Energy Hatches" />}
          rightSectionPointerEvents="auto"
          rightSectionWidth={34}
          styles={{
            input: { borderTopRightRadius: 0, borderBottomRightRadius: 0 },
          }}
        />

        {editor(trigger)}
      </Group>
    </Group>
  );
};

// `formula` is the working-out and stays dimmed; `value` is the answer and is
// the only thing at full contrast, so a column of rows reads as answers first
const Row = ({
  label,
  formula,
  value,
}: {
  label: string;
  formula?: ReactNode;
  value: ReactNode;
}) => (
  <Group gap="xs" wrap="nowrap" justify="space-between">
    <Text size="xs" c="dimmed">
      {label}
    </Text>

    <Group gap={6} wrap="nowrap" style={{ textAlign: 'right' }}>
      {formula !== undefined && (
        <Text size="sm" c="dimmed" component="div">
          {formula}
        </Text>
      )}

      <Text size="sm" component="div">
        {value}
      </Text>
    </Group>
  </Group>
);

// everything the machine and recipe together come to. read-only on purpose, and
// each row shows the arithmetic rather than just the answer. collapsible, since
// it is reference material once a node is dialled in
const Calculations = ({ data }: { data: RecipeNodeType['data'] }) => {
  const [open, setOpen] = useState(true);
  const result = overclock(data);
  const base = basePower(data.eu, data.time);
  const baseTier = recipeTier(base);
  const supply = suppliedPower(data);
  const { oc, parallel } = result;

  const powerFactors =
    `${fmt(base)} EU/t` +
    (result.parallels > 1 ? ` × ${result.parallels}P` : '') +
    (oc.total > 0 ? ` × ${result.machine.eutIncreasePerOC}^${oc.total}` : '');

  // the short answer goes in the row; the reasoning hangs off it
  const overclockLabel =
    oc.total > 0
      ? `${oc.total}×` +
        (oc.heat > 0 ? ` (${oc.heat} heat)` : '') +
        (oc.laser > 0 ? ` (${oc.laser} laser)` : '')
      : 'none';

  const overclockDetail = () => {
    if (result.underheated)
      return `${result.machine.name} runs at ${fmt(result.heat.machine)} K and this recipe needs ${fmt(result.heat.recipe)} K, so it would not accept it at all. The figures are as entered.`;
    if (result.underpowered)
      return `The supply of ${fmt(supply)} EU/t cannot even run the recipe's ${fmt(base)} EU/t.`;
    if (!result.machine.known)
      return 'This machine is not in the catalog, so it runs GregTech’s plain rules at one parallel.';

    if (oc.total > 0)
      return (
        `Each overclock costs ${result.machine.eutIncreasePerOC}× the power. ` +
        `${oc.regular} divide the duration by ${result.machine.durationDecreasePerOC}` +
        (oc.heat > 0
          ? ` and ${oc.heat} heat overclock${oc.heat > 1 ? 's' : ''} divide it by ${result.machine.durationDecreasePerHeatOC}`
          : '') +
        '.' +
        (parallel.subTick > 1
          ? ` Past the one tick floor they buy parallels instead: ×${parallel.subTick}.`
          : '') +
        (oc.wasted > 0
          ? ` ${oc.wasted} more the supply could pay for went unused — ${
              oc.clampedBy === 'voltageTier'
                ? 'this machine does not overclock across amperage'
                : 'the machine caps how many it will take'
            }.`
          : '')
      );

    if (result.machine.noOverclock)
      return 'This machine cannot overclock at all.';

    const next = tierAbove(result.demand);
    if (next === undefined) return 'Already at the top tier.';
    return `An overclock needs four times the recipe's draw behind it. This draws ${fmt(result.power)} EU/t and is fed ${fmt(supply)} EU/t — ${next} (${fmt(RECIPE_TIER_EU[next])} EU/t) would buy one.`;
  };

  return (
    <Box>
      <UnstyledButton
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%' }}
      >
        <Group gap={4} pb={4} wrap="nowrap">
          <IconChevronRight
            size={12}
            style={{
              transform: open ? 'rotate(90deg)' : undefined,
              transition: 'transform 150ms ease',
            }}
            color="var(--mantine-color-dimmed)"
          />
          <Text c="dimmed" size="xs" tt="uppercase" fw="600">
            Calculations
          </Text>
        </Group>
      </UnstyledButton>

      <Collapse expanded={open}>
        <Stack gap={2}>
          <Row
            label="Power"
            formula={base === result.power ? undefined : `${powerFactors} →`}
            value={`${fmt(result.power)} EU/t`}
          />

          <Row
            label="Time"
            formula={
              oc.total > 0
                ? `${fmt(data.time)}s ÷ ${result.machine.durationDecreasePerOC}^${oc.regular}` +
                  (oc.heat > 0
                    ? ` ÷ ${result.machine.durationDecreasePerHeatOC}^${oc.heat}`
                    : '') +
                  ' →'
                : undefined
            }
            value={`${fmt(result.time)}s`}
          />

          {data.multiplier > 1 && (
            <Row
              label="Total"
              formula={`${fmt(result.time)}s × ${data.multiplier} =`}
              value={`${fmt(result.time * data.multiplier)}s`}
            />
          )}

          <Row
            label="Tier"
            formula={baseTier === result.demand ? undefined : `${baseTier} →`}
            value={result.demand}
          />

          {result.parallels > 1 && (
            <Row
              label="Parallels"
              formula={
                parallel.limitedBy === 'machine'
                  ? undefined
                  : `${parallel.limitedBy}-limited →`
              }
              value={String(result.parallels)}
            />
          )}

          <Row
            label="Overclock"
            value={
              <Tooltip label={overclockDetail()} multiline w={300} withArrow>
                <Text
                  size="sm"
                  style={{
                    cursor: 'help',
                    textDecoration: 'underline dotted',
                    textUnderlineOffset: 3,
                  }}
                >
                  {overclockLabel}
                </Text>
              </Tooltip>
            }
          />
        </Stack>
      </Collapse>
    </Box>
  );
};
