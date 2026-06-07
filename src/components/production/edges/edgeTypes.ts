import type { EdgeTypes } from '@xyflow/react';

import { EditableEdge } from './editableEdge';

// override the built-in `smoothstep` type so every edge (including ones persisted
// before hand-routing existed) becomes draggable via EditableEdge
export const edgeTypes = { smoothstep: EditableEdge } satisfies EdgeTypes;
