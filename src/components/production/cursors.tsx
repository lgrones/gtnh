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
          <div
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
            <svg width={18} height={18} viewBox="0 0 18 18" fill="none">
              <path
                d="M2 2L8 16L10 10L16 8L2 2Z"
                fill={peer.color}
                stroke="white"
                strokeWidth={1}
              />
            </svg>
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
          </div>
        );
      })}
    </>
  );
};
