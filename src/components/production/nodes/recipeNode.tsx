import {
  ActionIcon,
  Box,
  Divider,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconPlus, IconSettings, IconX } from '@tabler/icons-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useCallback, useRef } from 'react';
import { useShallow } from 'zustand/shallow';

import {
  useProductionStore,
  VOLTAGE_TIERS,
  type ProductionNode as IProductionNode,
} from '@/contexts/productionStore';

import { ProductionNode } from './productionNode';

import classes from './productionNode.module.css';

type RecipeNodeType = Extract<IProductionNode, { type: 'recipeNode' }>;

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
    <ProductionNode id={id} data={data} {...props} type="none" color="indigo">
      <Stack pt="xs">
        <TextInput
          placeholder="Machine"
          value={data.machine}
          onChange={event =>
            updateRecipe(id, { machine: event.currentTarget.value })
          }
        />

        <Group gap="sm">
          <SegmentedControl
            value={data.power}
            onChange={value => updateRecipe(id, { power: value })}
            // the floating indicator measures via getBoundingClientRect, which
            // is scaled by React Flow's viewport zoom and then re-scaled inside
            // it -> wrong size/pos at any zoom != 1. hide it and fall back to
            // Mantine's static per-label background (see productionNode.module.css)
            classNames={{
              indicator: classes['sc-indicator'],
              label: classes['sc-label'],
            }}
            data={[
              { label: 'Electric', value: 'electric' },
              { label: 'Steam', value: 'steam' },
            ]}
          />

          {data.power === 'electric' ? (
            <>
              <Select
                w={80}
                data={VOLTAGE_TIERS}
                value={data.voltage}
                onChange={value =>
                  value && updateRecipe(id, { voltage: value })
                }
              />

              <NumberInput
                w={64}
                flex={1}
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
                rightSection={
                  <Text size="sm" c="dimmed" pr={6}>
                    A
                  </Text>
                }
                rightSectionPointerEvents="none"
              />
            </>
          ) : (
            <>
              <NumberInput
                w={100}
                min={1}
                flex={1}
                hideControls
                allowNegative={false}
                allowDecimal={false}
                value={data.steam}
                onChange={value =>
                  updateRecipe(id, {
                    steam: typeof value === 'number' ? value : data.steam,
                  })
                }
                rightSection={
                  <Text size="sm" c="dimmed" pr={6}>
                    L/t
                  </Text>
                }
                rightSectionPointerEvents="none"
              />
            </>
          )}
        </Group>

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
