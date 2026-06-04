import { Menu, Text } from '@mantine/core';
import { useHotkeys, useMousePosition, useUncontrolled } from '@mantine/hooks';
import { useReactFlow } from '@xyflow/react';
import type { PropsWithChildren } from 'react';

import {
  useProductionControls,
  type ProductionNodeType,
} from '@/contexts/productionStore';

interface ProductionFlowControlsProps extends PropsWithChildren {
  opened?: boolean;
  defaultOpened?: boolean;
  onChange?: (opened: boolean) => void;
}

export const ProductionFlowControls = ({
  children,
  opened,
  defaultOpened,
  onChange,
}: ProductionFlowControlsProps) => {
  const [_opened, setOpened] = useUncontrolled({
    value: opened,
    defaultValue: defaultOpened,
    finalValue: false,
    onChange,
  });

  const position = useReactFlow().screenToFlowPosition(useMousePosition());
  const { canUndo, canRedo, undo, redo, ...actions } = useProductionControls();

  const add = (type: ProductionNodeType) => actions.addNode(type, position);

  useHotkeys([
    ['CTRL+I', () => add('inputNode')],
    ['CTRL+O', () => add('outputNode')],
    ['CTRL+M', () => add('machineNode')],
    ['CTRL+Z', () => undo()],
    ['CTRL+Y', () => redo()],
  ]);

  return (
    <Menu shadow="md" width={200} opened={_opened} onChange={setOpened}>
      <Menu.ContextMenu>{children}</Menu.ContextMenu>

      <Menu.Dropdown>
        <Menu.Label>Add Node</Menu.Label>

        <Menu.Item
          onClick={() => add('inputNode')}
          rightSection={
            <Text size="xs" c="dimmed">
              Ctrl+I
            </Text>
          }
        >
          Input
        </Menu.Item>

        <Menu.Item
          onClick={() => add('outputNode')}
          rightSection={
            <Text size="xs" c="dimmed">
              Ctrl+O
            </Text>
          }
        >
          Output
        </Menu.Item>

        <Menu.Item
          onClick={() => add('machineNode')}
          rightSection={
            <Text size="xs" c="dimmed">
              Ctrl+M
            </Text>
          }
        >
          Machine
        </Menu.Item>

        <Menu.Divider />

        <Menu.Label>Actions</Menu.Label>

        <Menu.Item
          onClick={() => undo()}
          disabled={!canUndo}
          rightSection={
            <Text size="xs" c="dimmed">
              Ctrl+Z
            </Text>
          }
        >
          Undo
        </Menu.Item>

        <Menu.Item
          onClick={() => redo()}
          disabled={!canRedo}
          rightSection={
            <Text size="xs" c="dimmed">
              Ctrl+Y
            </Text>
          }
        >
          Redo
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
};
