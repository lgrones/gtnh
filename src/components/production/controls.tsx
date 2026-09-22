import { Menu, Text } from '@mantine/core';
import { useHotkeys, useMousePosition, useUncontrolled } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { useReactFlow } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';

import { useCollab } from '@/contexts/collab/session';
import {
  layoutNodes,
  useProductionControls,
  useProductionStore,
  type HandleOffsets,
  type PlaceableNodeType,
} from '@/contexts/productionStore';

import { SubLineModalContent } from './subLineModal';

// picking which saved line to collapse in. Opened as a modal rather than a
// submenu: the list is as long as the library and wants a search field
const openSubLineModal = (position: { x: number; y: number }) => {
  const id = modals.open({
    title: 'Add a saved line as a node',
    children: (
      <SubLineModalContent
        position={position}
        onPicked={() => modals.close(id)}
      />
    ),
  });
};

interface ControlsProps {
  opened?: boolean;
  defaultOpened?: boolean;
  onChange?: (opened: boolean) => void;
  children?: React.ReactNode;
}

export const Controls = ({
  children,
  opened,
  defaultOpened,
  onChange,
}: ControlsProps) => {
  const [_opened, setOpened] = useUncontrolled({
    value: opened,
    defaultValue: defaultOpened,
    finalValue: false,
    onChange,
  });

  const {
    screenToFlowPosition,
    getNodes,
    getEdges,
    getInternalNode,
    deleteElements,
    fitView,
  } = useReactFlow();
  const position = screenToFlowPosition(useMousePosition());

  const actions = useProductionControls();

  const { canUndo, canRedo, undo, redo } = useCollab(
    useShallow(state => ({
      canUndo: state.canUndo,
      canRedo: state.canRedo,
      undo: state.undo,
      redo: state.redo,
    })),
  );

  // reactive: enable "Delete selected" / "Copy" only while something is selected
  const hasSelection = useProductionStore(
    state =>
      state.nodes.some(node => node.selected) ||
      state.edges.some(edge => edge.selected),
  );

  const hasClipboard = useProductionStore(
    state => (state.clipboard?.nodes.length ?? 0) > 0,
  );

  const add = (type: PlaceableNodeType) => actions.addNode(type, position);

  // a sub-line cannot be created blank — it stands for a line that already
  // exists, so placing one starts with picking which
  const addSubLine = () => openSubLineModal(position);

  // measure every per-item handle React Flow knows about — a recipe's rows and
  // a collapsed sub-line's ports alike. React Flow keeps their bounds relative
  // to the node, and an edge attaches at a handle's centre
  const handleOffsets = (): HandleOffsets => {
    const offsets: HandleOffsets = new Map();
    for (const node of useProductionStore.getState().nodes) {
      if (node.type !== 'recipeNode' && node.type !== 'lineNode') continue;
      const bounds = getInternalNode(node.id)?.internals.handleBounds;
      const handles = [...(bounds?.source ?? []), ...(bounds?.target ?? [])];
      const measured = new Map(
        handles.flatMap(handle =>
          !handle.id
            ? []
            : [
                [
                  handle.id,
                  {
                    x: handle.x + handle.width / 2,
                    y: handle.y + handle.height / 2,
                  },
                ] as const,
              ],
        ),
      );
      if (measured.size > 0) offsets.set(node.id, measured);
    }
    return offsets;
  };

  // re-layout (ELK is async, so it lives here not in the store) then frame the
  // result once React Flow has the new positions. the handle offsets come from
  // React Flow's measurements, so ELK routes edges from where the handles
  // really are; its bend points replace whatever routing the edges carried
  const autoLayout = async () => {
    const { nodes, edges } = useProductionStore.getState();
    const laid = await layoutNodes(nodes, edges, handleOffsets());
    actions.setNodes(laid.nodes);
    actions.setEdges(laid.edges);
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
    ['CTRL+D', () => add('byproductNode')],
    ['CTRL+M', () => addSubLine()],
    ['CTRL+R', () => add('recipeNode')],
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
          onClick={() => add('byproductNode')}
          rightSection={
            <Text size="xs" c="dimmed">
              Ctrl+D
            </Text>
          }
        >
          Byproduct
        </Menu.Item>

        <Menu.Item
          onClick={addSubLine}
          rightSection={
            <Text size="xs" c="dimmed">
              Ctrl+M
            </Text>
          }
        >
          Sub-line
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
