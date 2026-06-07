import {
  Button,
  Center,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
} from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import {
  Background,
  Controls as FlowControls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useCollab } from '@/contexts/collab/session';
import {
  useActiveGraph,
  useProductionLibrary,
} from '@/contexts/productionLibrary';
import {
  useProductionFlow,
  useProductionStore,
} from '@/contexts/productionStore';

import { AltTabs } from './altTabs';
import { Controls } from './controls';
import { Cursors } from './cursors';
import { FlowOptions } from './flowOptions';
import { nodeTypes } from './nodes/nodeTypes';

export const Flow = () => {
  const activeGraph = useActiveGraph();
  const createGraph = useProductionLibrary(state => state.createGraph);

  if (!activeGraph)
    return (
      <Center h="100%">
        <Stack align="center" gap="sm">
          <Text c="dimmed">No production line</Text>

          <Button
            variant="filled"
            color="gray"
            leftSection={<IconPlus size={16} />}
            onClick={() => void createGraph()}
          >
            New line
          </Button>
        </Stack>
      </Center>
    );

  return (
    <ReactFlowProvider>
      <FlowCanvas />
    </ReactFlowProvider>
  );
};

// the canvas body — lives inside ReactFlowProvider so it can project cursor
// coordinates and read collab state for the active graph
const FlowCanvas = () => {
  const flowProps = useProductionFlow();
  const hasNodes = useProductionStore(state => state.nodes.length > 0);

  const { status, setCursor } = useCollab(
    useShallow(state => ({ status: state.status, setCursor: state.setCursor })),
  );

  const { screenToFlowPosition } = useReactFlow();
  const [menuOpened, setMenuOpened] = useState(false);
  const closeMenu = useCallback(() => setMenuOpened(false), []);

  // throttle cursor broadcasts (~20/s) — presence is cheap but not free
  const lastMove = useRef(0);
  const onMouseMove = (event: MouseEvent) => {
    const now = Date.now();

    if (now - lastMove.current < 50) return;

    lastMove.current = now;
    setCursor(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };

  const canvas = (
    <Paper h="100%">
      <ReactFlow
        {...flowProps}
        nodeTypes={nodeTypes}
        connectionRadius={60}
        deleteKeyCode={['Delete', 'Backspace']}
        nodesDraggable
        nodesConnectable
        edgesReconnectable
        onPaneClick={closeMenu}
        onMoveStart={closeMenu}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setCursor(null)}
        colorMode="system"
        snapToGrid
        fitView
        style={
          {
            borderRadius: 'var(--mantine-radius-default)',
            '--xy-background-color-default': 'transparent',
          } as CSSProperties
        }
        proOptions={{ hideAttribution: true }}
      >
        <MiniMap />
        <Background />
        <FlowControls />
        <Cursors />

        <Panel position="top-left">
          <Group gap="xs" align="center">
            <AltTabs />
            {status === 'loading' && <Loader size="xs" />}
          </Group>
        </Panel>

        <Panel position="top-right">
          <FlowOptions />
        </Panel>

        {!hasNodes && (
          <Panel position="center-left" style={{ width: '100%' }}>
            <Text ta="center">
              Start placing nodes by right-clicking or using shortcuts
            </Text>
          </Panel>
        )}
      </ReactFlow>
    </Paper>
  );

  return (
    <Controls opened={menuOpened} onChange={setMenuOpened}>
      {canvas}
    </Controls>
  );
};
