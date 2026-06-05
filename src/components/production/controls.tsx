import { Menu, Text } from '@mantine/core';
import { useHotkeys, useMousePosition, useUncontrolled } from '@mantine/hooks';
import { useReactFlow } from '@xyflow/react';
import type { PropsWithChildren } from 'react';

import {
  layoutNodes,
  useProductionControls,
  useProductionStore,
  type ProductionNodeType,
} from '@/contexts/productionStore';

interface ProductionFlowControlsProps extends PropsWithChildren {
  opened?: boolean;
  defaultOpened?: boolean;
  onChange?: (opened: boolean) => void;
}

export const Controls = ({
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

  const { screenToFlowPosition, getNodes, getEdges, deleteElements, fitView } =
    useReactFlow();
  const position = screenToFlowPosition(useMousePosition());
  const { canUndo, canRedo, undo, redo, ...actions } = useProductionControls();

  // reactive: enable "Delete selected" / "Copy" only while something is selected
  const hasSelection = useProductionStore(
    state =>
      state.nodes.some(node => node.selected) ||
      state.edges.some(edge => edge.selected),
  );
  const hasClipboard = useProductionStore(
    state => (state.clipboard?.nodes.length ?? 0) > 0,
  );

  const add = (type: ProductionNodeType) => actions.addNode(type, position);

  // re-layout (ELK is async, so it lives here not in the store) then frame the
  // result once React Flow has the new positions
  const autoLayout = async () => {
    const { nodes, edges } = useProductionStore.getState();
    actions.setNodes(await layoutNodes(nodes, edges));
    requestAnimationFrame(() => void fitView({ duration: 300 }));
  };

  // remove every selected node + edge (scales to multi-select / box-select)
  const deleteSelected = () =>
    void deleteElements({
      nodes: getNodes().filter(node => node.selected),
      edges: getEdges().filter(edge => edge.selected),
    });

  useHotkeys([
    ['CTRL+I', () => add('inputNode')],
    ['CTRL+O', () => add('outputNode')],
    ['CTRL+R', () => add('recipeNode')],
    ['CTRL+D', () => add('disposalNode')],
    ['CTRL+Z', () => undo()],
    ['CTRL+Y', () => redo()],
    ['CTRL+C', () => actions.copySelection()],
    ['CTRL+V', () => actions.paste(position)],
    ['CTRL+L', () => void autoLayout()],
  ]);

  // Escape: blur the active field + clear selection. empty ignore list + true
  // so it fires while editing an input or a contentEditable node name
  useHotkeys(
    [
      [
        'Escape',
        () => {
          (document.activeElement as HTMLElement | null)?.blur();
          actions.deselectAll();
        },
      ],
    ],
    [],
    true,
  );

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
          onClick={() => add('recipeNode')}
          rightSection={
            <Text size="xs" c="dimmed">
              Ctrl+R
            </Text>
          }
        >
          Recipe
        </Menu.Item>

        <Menu.Item
          onClick={() => add('disposalNode')}
          rightSection={
            <Text size="xs" c="dimmed">
              Ctrl+D
            </Text>
          }
        >
          Disposal
        </Menu.Item>

        <Menu.Divider />

        <Menu.Label>Actions</Menu.Label>

        <Menu.Item
          onClick={() => actions.copySelection()}
          disabled={!hasSelection}
          rightSection={
            <Text size="xs" c="dimmed">
              Ctrl+C
            </Text>
          }
        >
          Copy
        </Menu.Item>

        <Menu.Item
          onClick={() => actions.paste(position)}
          disabled={!hasClipboard}
          rightSection={
            <Text size="xs" c="dimmed">
              Ctrl+V
            </Text>
          }
        >
          Paste
        </Menu.Item>

        <Menu.Item
          onClick={() => void autoLayout()}
          rightSection={
            <Text size="xs" c="dimmed">
              Ctrl+L
            </Text>
          }
        >
          Auto layout
        </Menu.Item>

        <Menu.Item
          onClick={deleteSelected}
          disabled={!hasSelection}
          color="red"
          rightSection={
            <Text size="xs" c="dimmed">
              Del
            </Text>
          }
        >
          Delete
        </Menu.Item>

        <Menu.Divider />

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
