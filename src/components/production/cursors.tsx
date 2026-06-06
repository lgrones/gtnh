import { Box } from '@mantine/core';
import { IconPointer2 } from '@tabler/icons-react';
import { useReactFlow } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';

import { usePresence } from '@/contexts/collab/presence';

// renders remote collaborators' live cursors over the canvas. positions are
// stored in flow coordinates so they track pan/zoom; projected to screen here.
export const Cursors = () => {
  const peers = usePresence(useShallow(state => Object.values(state.peers)));
  const { flowToScreenPosition } = useReactFlow();

  return (
    <>
      {peers.map(peer => {
        if (!peer.cursor) return null;

        const { x, y } = flowToScreenPosition(peer.cursor);

        return (
          <Box
            key={peer.uid}
            style={{
              position: 'fixed',
              left: x,
              top: y,
              pointerEvents: 'none',
              zIndex: 1000,
              transform: 'translate(-2px, -2px)',
            }}
          >
            <IconPointer2 size={18} fill={peer.color} stroke="white" />
            <span
              style={{
                position: 'absolute',
                left: 14,
                top: 12,
                whiteSpace: 'nowrap',
                background: peer.color,
                color: 'white',
                fontSize: 11,
                lineHeight: 1.4,
                padding: '1px 6px',
                borderRadius: 4,
              }}
            >
              {peer.name}
            </span>
          </Box>
        );
      })}
    </>
  );
};
