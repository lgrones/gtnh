import {
  ActionIcon,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Collapse,
  Divider,
  Group,
  Indicator,
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
  IconAdjustmentsHorizontal,
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
  useItemNames,
  useProductionStore,
  VOLTAGE_TIERS,
  type EnergyHatch,
  type ProductionNode as IProductionNode,
} from '@/contexts/productionStore';
import {
  AVAILABLE_COILS,
  findMachine,
  MACHINE_OPTIONS,
  matchesMachine,
} from '@/domain/machines/catalog';
import type {
  MachineConfig,
  MachineParam,
  ResolvedMachine,
} from '@/domain/machines/types';
import { basePower, overclock, recipeTier } from '@/domain/overclock';
import { RECIPE_TIERS, TICKS_PER_SECOND } from '@/domain/tiers';

import { formatAmount } from '../../common/format';
import { ProductionNode } from './productionNode';

import classes from './productionNode.module.css';

type RecipeNodeType = Extract<IProductionNode, { type: 'recipeNode' }>;

const fmt = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });

// a value whose reasoning hangs off it in a tooltip, marked so it reads as
// hoverable rather than as plain text
const HINT = {
  cursor: 'help',
  textDecoration: 'underline dotted',
  textUnderlineOffset: 3,
} as const;

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

// One machine parameter, rendered from what the catalog declares about it. The
// node stores a bag of values, so a control's whole job is to write one key —
// resolveMachine validates and defaults it on the way back out, which is why
// nothing here has to know what a sensible coil is.
const ParamField = ({
  param,
  config,
  onChange,
  w,
}: {
  param: MachineParam;
  config: MachineConfig | undefined;
  onChange: (value: string | number | boolean | undefined) => void;
  w: number;
}) => {
  const saved = config?.[param.id];

  switch (param.kind) {
    case 'coilTier': {
      const allowed = param.allowed;
      const coils =
        allowed === undefined
          ? AVAILABLE_COILS
          : AVAILABLE_COILS.filter(coil => allowed.includes(coil.id));

      return (
        <Select
          w={w}
          data={coils.map(coil => ({ value: coil.id, label: coil.name }))}
          value={typeof saved === 'string' ? saved : param.default}
          onChange={value => value !== null && onChange(value)}
          comboboxProps={{ width: 'auto' }}
        />
      );
    }

    case 'voltageTier': {
      const min = RECIPE_TIERS.indexOf(
        (param.min ?? RECIPE_TIERS[0]) as (typeof RECIPE_TIERS)[number],
      );
      const max =
        param.max === undefined
          ? RECIPE_TIERS.length - 1
          : RECIPE_TIERS.indexOf(param.max as (typeof RECIPE_TIERS)[number]);

      return (
        <Select
          w={w}
          data={RECIPE_TIERS.slice(Math.max(min, 0), max + 1)}
          value={typeof saved === 'string' ? saved : param.default}
          onChange={value => value !== null && onChange(value)}
          comboboxProps={{ width: 'auto' }}
        />
      );
    }

    case 'count':
      return (
        <NumberInput
          w={w}
          min={param.min}
          max={param.max}
          step={param.step}
          hideControls
          allowNegative={false}
          allowDecimal={false}
          value={typeof saved === 'number' ? saved : param.default}
          onChange={value =>
            onChange(typeof value === 'number' ? value : param.default)
          }
        />
      );

    case 'enum':
      return (
        <Select
          w={w}
          data={param.options.map(option => ({
            value: option.value,
            label: option.label,
          }))}
          value={typeof saved === 'string' ? saved : param.default}
          onChange={value => value !== null && onChange(value)}
          comboboxProps={{ width: 'auto' }}
        />
      );

    case 'boolean':
      return (
        <Checkbox
          checked={typeof saved === 'boolean' ? saved : param.default}
          onChange={event => onChange(event.currentTarget.checked)}
        />
      );

    // the GT++ casing ladders are read out of structure-check code the
    // extractor does not parse, so resolveMachine throws on them and a guard
    // test asserts no machine declares one. unreachable, and typed as such
    case 'pipeCasingTier':
    case 'itemPipeCasingTier':
      return null;
  }
};

// the machine's own settings: every parameter that is not the inline one, plus
// the parallel ceiling. always present on a multiblock, because the ceiling
// always belongs somewhere, and dotted when anything has been changed from
// what the machine would do on its own
const MachineSettings = ({
  id,
  data,
  machine,
  cap,
}: {
  id: string;
  data: Extract<RecipeNodeType['data'], { kind: 'multi' }>;
  machine: ResolvedMachine;
  cap: number;
}) => {
  const updateRecipe = useProductionStore(state => state.updateRecipe);
  const [opened, setOpened] = useState(false);

  const extra = machine.parameters.filter(param => param.primary !== true);
  const touched =
    data.parallelLimit !== undefined ||
    Object.keys(data.config ?? {}).length > 0;

  const setParam = (
    key: string,
    value: string | number | boolean | undefined,
  ) =>
    updateRecipe(id, {
      config: { ...data.config, [key]: value } as MachineConfig,
    });

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      arrowPosition="center"
      withArrow
      shadow="md"
    >
      <Popover.Target>
        <Indicator disabled={!touched} size={6} offset={4} color="indigo">
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={() => setOpened(o => !o)}
            aria-label="Machine settings"
          >
            <IconAdjustmentsHorizontal size={18} />
          </ActionIcon>
        </Indicator>
      </Popover.Target>

      <Popover.Dropdown>
        <Stack gap="xs" w={240}>
          {extra.map(param => (
            <Box key={param.id}>
              <Text size="xs" c="dimmed" pb={2}>
                {param.label}
              </Text>
              <ParamField
                param={param}
                config={data.config}
                onChange={value => setParam(param.id, value)}
                w={220}
              />
            </Box>
          ))}

          <Divider
            label="Limits"
            labelPosition="left"
            mt={extra.length > 0 ? 'xs' : 0}
          />

          <Box>
            <Text size="xs" c="dimmed" pb={2}>
              Parallel ceiling
            </Text>
            <NumberInput
              min={1}
              hideControls
              allowNegative={false}
              allowDecimal={false}
              // an empty field visibly means "whatever the machine does", and
              // the placeholder is what that comes to for this build
              placeholder={String(cap)}
              value={data.parallelLimit ?? ''}
              onChange={value =>
                updateRecipe(id, {
                  parallelLimit:
                    typeof value === 'number' && value > 0 ? value : undefined,
                })
              }
            />
            <Text size="xs" c="dimmed" pt={4}>
              Empty runs the machine’s own cap of {cap}. Set this only to hold
              it below what its buses can feed.
            </Text>
          </Box>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
};

const KIND_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'multi', label: 'Multi' },
];

// A quantity field sizes to its digits, so a seven-figure amount stays readable
// instead of being clipped at a fixed width. The room comes out of the item name
// beside it first — that field carries the slack and has its own floor — and only
// once the name hits that floor does the node itself widen, which is what the
// body's `fit-content` between `miw` and `maw` expresses.
const quantityWidth = (quantity: number): number =>
  Math.min(140, Math.max(60, formatAmount(quantity).length * 9 + 22));

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

  const itemNames = useItemNames();

  // the resolved machine drives which controls exist at all: nothing renders
  // unless this node's machine asks for it. overclock() is memoised per node
  // data, so this is the same object Calculations below reads
  const result = overclock(data);
  const machine = result.machine;
  const primaryParam = machine.parameters.find(param => param.primary === true);

  // a persisted name the catalog cannot resolve must stay selectable, or the
  // Select renders blank and the next edit to any other field persists it away
  const unresolved =
    data.kind === 'multi' &&
    data.machine !== '' &&
    findMachine(data.machine) === undefined
      ? data.machine
      : undefined;

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
      <Stack pt="xs" miw={400} w="fit-content" maw={640}>
        {/* what the machine IS */}
        <Group gap="sm" wrap="nowrap">
          {data.kind === 'multi' ? (
            <Select
              flex={1}
              searchable
              placeholder="Multiblock"
              data={
                unresolved === undefined
                  ? MACHINE_OPTIONS
                  : [
                      {
                        value: unresolved,
                        label: `${unresolved} (not in catalog)`,
                      },
                      ...MACHINE_OPTIONS,
                    ]
              }
              value={data.machine === '' ? null : data.machine}
              onChange={value => updateRecipe(id, { machine: value ?? '' })}
              // the options are flat strings, so anything with a `value` is an
              // option rather than a group header. the synthetic entry for an
              // unresolvable name is displayable but never offered as a choice
              filter={({ options, search }) =>
                options.filter(
                  option =>
                    'value' in option &&
                    option.value !== unresolved &&
                    matchesMachine(option.value, search),
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

                {/* at most one parameter is ever inline: an EBF shows its coil
                    with no clicks, and everything else lives behind the gear */}
                {primaryParam !== undefined && (
                  <Tooltip
                    label={primaryParam.help ?? primaryParam.label}
                    withArrow
                  >
                    <Box>
                      <ParamField
                        param={primaryParam}
                        config={data.config}
                        onChange={value =>
                          updateRecipe(id, {
                            config: {
                              ...data.config,
                              [primaryParam.id]: value,
                            } as MachineConfig,
                          })
                        }
                        w={primaryParam.kind === 'count' ? 70 : 140}
                      />
                    </Box>
                  </Tooltip>
                )}

                <MachineSettings
                  id={id}
                  data={data}
                  machine={machine}
                  cap={result.parallel.machineCap}
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

            {/* mSpecialValue, which NEI prints on the recipe itself. it belongs
                here rather than with the machine because it is what the RECIPE
                demands, and only machines that read heat at all are offered it */}
            {data.kind === 'multi' &&
              (machine.heatOC || machine.heatDiscount) && (
                <NumberInput
                  w={96}
                  min={0}
                  hideControls
                  allowNegative={false}
                  allowDecimal={false}
                  thousandSeparator=","
                  value={data.recipeHeat ?? ''}
                  onChange={value =>
                    updateRecipe(id, {
                      recipeHeat: typeof value === 'number' ? value : undefined,
                    })
                  }
                  rightSection={
                    <Unit
                      abbr="K"
                      w={240}
                      label="Recipe heat (mSpecialValue), as NEI prints it. Every 900 K the machine has above it takes 5% off the power, and every 1,800 K buys an overclock that quarters the duration."
                    />
                  }
                  rightSectionPointerEvents="auto"
                  rightSectionWidth={24}
                />
              )}
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
                  w={quantityWidth(input.quantity)}
                  min={0}
                  allowNegative={false}
                  hideControls
                  thousandSeparator=","
                  value={input.quantity}
                  onChange={value =>
                    updateRecipeInput(id, input.id, {
                      quantity:
                        typeof value === 'number' ? value : input.quantity,
                    })
                  }
                />

                <Autocomplete
                  size="sm"
                  flex="1 1 160px"
                  miw={120}
                  placeholder="Item"
                  data={itemNames}
                  limit={8}
                  value={input.name}
                  onChange={value =>
                    updateRecipeInput(id, input.id, { name: value })
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
                  w={quantityWidth(output.quantity)}
                  min={0}
                  allowNegative={false}
                  hideControls
                  thousandSeparator=","
                  value={output.quantity}
                  onChange={value =>
                    updateRecipeOutput(id, output.id, {
                      quantity:
                        typeof value === 'number' ? value : output.quantity,
                    })
                  }
                />

                <Autocomplete
                  size="sm"
                  flex="1 1 160px"
                  miw={120}
                  placeholder="Item"
                  data={itemNames}
                  limit={8}
                  value={output.name}
                  onChange={value =>
                    updateRecipeOutput(id, output.id, { name: value })
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
// it is reference material once a node is dialled in.
//
// Time is shown in TICKS first, with seconds after. GT truncates the duration
// to whole ticks and floors it at one, and neither is visible in seconds.
const Calculations = ({ data }: { data: RecipeNodeType['data'] }) => {
  const [open, setOpen] = useState(true);
  const result = overclock(data);
  const base = basePower(data.eu, data.time);
  const baseTier = recipeTier(base);
  const baseTicks = data.time * TICKS_PER_SECOND;
  const { oc, parallel, machine } = result;

  // the formulas have to carry every factor GT applied, including the machine's
  // own modifiers and the heat discount — a row that shows `120 × 4^3` next to
  // 6,256 is an invitation to go looking for the arithmetic error
  const powerFactors =
    `${fmt(base)} EU/t` +
    (result.parallels > 1 ? ` × ${result.parallels}P` : '') +
    (result.modifiers.eut === 1 ? '' : ` × ${fmt(result.modifiers.eut)}`) +
    (result.heat.discounts === 0
      ? ''
      : ` × ${machine.heatDiscountExponent}^${result.heat.discounts}`) +
    (oc.total > 0 ? ` × ${machine.eutIncreasePerOC}^${oc.total}` : '');

  // a speed bonus is written `1F / 2.2F` in the Java and reads far better as a
  // division here than as × 0.45
  const durationFactor =
    result.modifiers.duration === 1
      ? ''
      : result.modifiers.duration < 1
        ? ` ÷ ${fmt(1 / result.modifiers.duration)}`
        : ` × ${fmt(result.modifiers.duration)}`;

  const timeFactors =
    durationFactor +
    (oc.heat > 0 ? ` ÷ ${machine.durationDecreasePerHeatOC}^${oc.heat}` : '') +
    (oc.regular > 0 ? ` ÷ ${machine.durationDecreasePerOC}^${oc.regular}` : '');

  const overclockLabel =
    oc.total > 0
      ? `${oc.total}×` +
        (oc.heat > 0 ? ` (${oc.heat} heat)` : '') +
        (oc.laser > 0 ? ` (${oc.laser} laser)` : '')
      : 'none';

  // the questions a user actually has, in the order they stop mattering
  const overclockDetail = () => {
    if (result.underheated)
      return `${machine.name} reaches ${fmt(result.heat.machine)} K and this recipe needs ${fmt(result.heat.recipe)} K. GregTech matches on heat before anything else, so it would not run at all — the figures are exactly as entered.`;

    if (result.underpowered)
      return `${fmt(result.availableEUt)} EU/t of supply cannot pay for one ${fmt(base)} EU/t recipe, so nothing runs. The figures are exactly as entered.`;

    if (result.ranAsEntered) return 'Nothing to calculate yet.';

    if (!machine.known)
      return `${data.machine} is not in the machine catalog, so it runs GregTech’s plain rules at one parallel. Its real parallel count and any power or speed modifiers it has are not applied.`;

    const spentForNothing = oc.wasted + (parallel.subTick > 1 ? 0 : oc.floored);

    const waste =
      spentForNothing > 0
        ? ` ${spentForNothing} of them bought no time and were charged for anyway — ${
            oc.clampedBy === 'voltageTier'
              ? 'this machine does not overclock across amperage'
              : oc.wasted > 0
                ? 'the machine caps how many it will take'
                : 'the duration was already at the one tick floor'
          }.`
        : '';

    if (oc.total > 0)
      return (
        `${oc.total} overclock${oc.total > 1 ? 's' : ''}, each costing ${machine.eutIncreasePerOC}× the power. ` +
        `${oc.regular} divide${oc.regular === 1 ? 's' : ''} the duration by ${machine.durationDecreasePerOC}` +
        (oc.heat > 0
          ? ` and ${oc.heat} heat overclock${oc.heat > 1 ? 's' : ''} divide${oc.heat === 1 ? 's' : ''} it by ${machine.durationDecreasePerHeatOC}`
          : '') +
        '.' +
        (parallel.subTick > 1
          ? ` Past the one tick floor they buy parallels instead, ×${parallel.subTick}.`
          : '') +
        waste
      );

    // why not even one. GregTech compares the whole machine's draw against the
    // whole supply and takes log4 of the ratio, so the threshold is a multiple
    // of the draw — not the tier of headroom the old model claimed
    return `An overclock needs the supply to be ${machine.eutIncreasePerOC}× the draw. This draws ${fmt(result.power)} EU/t, so it would take ${fmt(result.power * machine.eutIncreasePerOC)} EU/t; the hatches deliver ${fmt(result.availableEUt)}.`;
  };

  const parallelDetail = () => {
    const why =
      parallel.limitedBy === 'node'
        ? 'held there by the ceiling set on this node'
        : parallel.limitedBy === 'machine'
          ? 'the machine’s own cap'
          : parallel.limitedBy === 'input'
            ? 'what the buses can feed per cycle'
            : `all the ${fmt(result.availableEUt)} EU/t supply can pay for`;

    return (
      `${parallel.running} of ${parallel.effectiveCap} — ${why}.` +
      (parallel.subTick > 1
        ? ` ${parallel.subTick}× of that cap came from overclocks past the one tick floor, which buy parallels rather than time.`
        : '')
    );
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
              timeFactors === ''
                ? undefined
                : `${fmt(baseTicks)}t${timeFactors} →`
            }
            value={`${fmt(result.durationTicks)}t (${fmt(result.time)}s)`}
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

          {/* discounts and heat overclocks come out of the same subtraction and
              differ only in their threshold, so they share a row */}
          {machine.requiresHeat && (
            <Row
              label="Heat"
              formula={`${fmt(result.heat.machine)} − ${fmt(result.heat.recipe)} =`}
              value={
                result.heat.sufficient
                  ? `${fmt(result.heat.machine - result.heat.recipe)} K · ${result.heat.discounts} discount${result.heat.discounts === 1 ? '' : 's'}, ${oc.heat} OC`
                  : 'too cold to run'
              }
            />
          )}

          {parallel.effectiveCap > 1 && (
            <Row
              label="Parallels"
              value={
                <Tooltip label={parallelDetail()} multiline w={300} withArrow>
                  <Text size="sm" style={HINT}>
                    {parallel.running} of {parallel.effectiveCap}
                  </Text>
                </Tooltip>
              }
            />
          )}

          <Row
            label="Overclock"
            value={
              <Tooltip label={overclockDetail()} multiline w={300} withArrow>
                <Text size="sm" style={HINT}>
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
