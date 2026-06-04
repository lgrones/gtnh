import { Button, Center, Paper, Stack, Text } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import {
  Background,
  Controls,
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

import { nodeTypes } from './nodes/nodeTypes';
import { ProductionFlowControls } from './productionFlowControls';

export const ProductionFlow = () => {
  const flowProps = useProductionFlow();
  const activeGraph = useActiveGraph();
  const createGraph = useProductionLibrary(state => state.createGraph);
  const [menuOpened, setMenuOpened] = useState(false);

  const closeMenu = useCallback(() => setMenuOpened(false), []);

  // no saved line selected — nothing to show, offer to create one
  if (!activeGraph)
    return (
      <Center h="100%">
        <Stack align="center" gap="sm">
          <Text c="dimmed">No production line</Text>

          <Button
            variant="light"
            color="indigo"
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
      <ProductionFlowControls opened={menuOpened} onChange={setMenuOpened}>
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
            <Controls />
            <Panel position="top-left">{activeGraph.name}</Panel>
          </ReactFlow>
        </Paper>
      </ProductionFlowControls>
    </ReactFlowProvider>
  );
};
