import { Paper } from '@mantine/core';
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import { useCallback, useState, type CSSProperties } from 'react';

import { useProductionFlow } from '@/contexts/productionStore';

import { nodeTypes } from './nodes/nodeTypes';
import { ProductionFlowControls } from './productionFlowControls';

export const ProductionFlow = () => {
  const flowProps = useProductionFlow();
  const [menuOpened, setMenuOpened] = useState(false);

  const closeMenu = useCallback(() => setMenuOpened(false), []);

  return (
    <ReactFlowProvider>
      <ProductionFlowControls opened={menuOpened} onChange={setMenuOpened}>
        <Paper h="100%">
          <ReactFlow
            {...flowProps}
            nodeTypes={nodeTypes}
            onPaneClick={closeMenu}
            onMoveStart={closeMenu}
            colorMode="system"
            proOptions={{ hideAttribution: true }}
            fitView
            style={
              {
                borderRadius: 'var(--mantine-radius-default)',
                '--xy-background-color-default': 'transparent',
              } as CSSProperties
            }
          >
            <MiniMap />
            <Background />
            <Controls />
            <Panel position="top-left">Production Line</Panel>
          </ReactFlow>
        </Paper>
      </ProductionFlowControls>
    </ReactFlowProvider>
  );
};
