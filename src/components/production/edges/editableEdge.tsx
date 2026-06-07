import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react';
import { useState, type MouseEvent, type PointerEvent } from 'react';

import { useProductionStore, type Waypoint } from '@/contexts/productionStore';

// a straight polyline through source -> waypoints -> target
const toPath = (points: Waypoint[]): string => {
  const first = points[0];
  if (!first) return '';
  return (
    `M ${first.x},${first.y}` +
    points
      .slice(1)
      .map(p => ` L ${p.x},${p.y}`)
      .join('')
  );
};

// distance from point p to segment a-b, for choosing which segment a new
// waypoint splits when the edge is double-clicked
const distToSegment = (p: Waypoint, a: Waypoint, b: Waypoint): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

// an edge the user can bend by hand: double-click the line to drop a waypoint,
// drag a waypoint to move it, double-click a waypoint to remove it. waypoints
// live on edge.data (synced + persisted); with none, it's a plain smoothstep edge.
export const EditableEdge = ({
  id,
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
}: EdgeProps) => {
  const { screenToFlowPosition } = useReactFlow();
  const setEdgePoints = useProductionStore(state => state.setEdgePoints);
  // index + live position of the waypoint being dragged (null = idle)
  const [drag, setDrag] = useState<{ index: number; pos: Waypoint } | null>(
    null,
  );

  const stored = (data?.points as Waypoint[] | undefined) ?? [];
  // apply the in-flight drag so the path follows the cursor before commit
  const points = stored.map((p, i) => (drag?.index === i ? drag.pos : p));

  const source = { x: sourceX, y: sourceY };
  const target = { x: targetX, y: targetY };
  const flowOf = (e: { clientX: number; clientY: number }) =>
    screenToFlowPosition({ x: e.clientX, y: e.clientY });

  // no manual routing -> the stock smoothstep path
  const [smooth] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const path = points.length > 0 ? toPath([source, ...points, target]) : smooth;

  const startDrag = (index: number) => (e: PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ index, pos: flowOf(e) });
  };

  const moveDrag = (e: PointerEvent) => {
    if (drag) setDrag({ index: drag.index, pos: flowOf(e) });
  };

  const endDrag = (e: PointerEvent) => {
    if (!drag) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setEdgePoints(
      id,
      stored.map((p, i) => (i === drag.index ? drag.pos : p)),
    );
    setDrag(null);
  };

  const removePoint = (index: number) => (e: MouseEvent) => {
    e.stopPropagation();
    setEdgePoints(
      id,
      stored.filter((_, i) => i !== index),
    );
  };

  // double-click the edge -> insert a waypoint into the nearest segment
  const addPoint = (e: MouseEvent) => {
    const click = flowOf(e);
    const chain = [source, ...stored, target];
    let bestIndex = 0;
    let bestDist = Infinity;
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i];
      const b = chain[i + 1];
      if (a === undefined || b === undefined) continue;
      const d = distToSegment(click, a, b);
      if (d < bestDist) {
        bestDist = d;
        bestIndex = i;
      }
    }
    const next = [...stored];
    next.splice(bestIndex, 0, click);
    setEdgePoints(id, next);
  };

  return (
    <g onDoubleClick={addPoint}>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />

      <EdgeLabelRenderer>
        {points.map((p, i) => (
          <div
            key={i}
            // nopan/nodrag stop the pane from panning while a dot is dragged
            className="nopan nodrag"
            onPointerDown={startDrag(i)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onDoubleClick={removePoint(i)}
            title="Drag to move · double-click to remove"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`,
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: 'var(--mantine-color-body)',
              border: '2px solid var(--xy-edge-stroke-default, currentColor)',
              cursor: 'grab',
              pointerEvents: 'all',
            }}
          />
        ))}
      </EdgeLabelRenderer>
    </g>
  );
};
