import { Button, Center, Paper, Stack, Text } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import {
  Background,
  Controls as FlowControls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import { useCallback, useState, type CSSProperties } from 'react';

import {
  useActiveGraph,
  useProductionLibrary,
} from '@/contexts/productionLibrary';
import { useProductionFlow } from '@/contexts/productionStore';

import { Controls } from './controls';
import { nodeTypes } from './nodes/nodeTypes';

export const Flow = () => {
  const flowProps = useProductionFlow();
  const activeGraph = useActiveGraph();
  const createGraph = useProductionLibrary(state => state.createGraph);
  const [menuOpened, setMenuOpened] = useState(false);

  const closeMenu = useCallback(() => setMenuOpened(false), []);

  if (!activeGraph)
    return (
      <Center h="100%">
        <Stack align="center" gap="sm">
          <Text c="dimmed">No production line</Text>

          <Button
            variant="filled"
            color="gray"
            leftSection={<IconPlus size={16} />}
            onClick={createGraph}
          >
            New line
          </Button>
        </Stack>
      </Center>
    );

  return (
    <ReactFlowProvider>
      <Controls opened={menuOpened} onChange={setMenuOpened}>
        <Paper h="100%">
          <ReactFlow
            {...flowProps}
            nodeTypes={nodeTypes}
            connectionRadius={60}
            deleteKeyCode={['Delete', 'Backspace']}
            onPaneClick={closeMenu}
            onMoveStart={closeMenu}
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
            <Panel position="top-left">{activeGraph.name}</Panel>
            {!activeGraph.nodes.length && (
              <Panel position="center-left" style={{ width: '100%' }}>
                <Text ta="center">
                  Starting placing Nodes with right-clicking or using shortcuts
                </Text>
              </Panel>
            )}
          </ReactFlow>
        </Paper>
      </Controls>
    </ReactFlowProvider>
  );
};
