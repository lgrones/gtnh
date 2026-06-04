import { Group, Paper, Text, type MantineColor } from '@mantine/core';
import { useMounted } from '@mantine/hooks';
import { IconGripVertical } from '@tabler/icons-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import React, { useEffect, useRef } from 'react';

import {
  DRAG_HANDLE_CLASS,
  useProductionStore,
  type ProductionNode as IProductionNode,
} from '@/contexts/productionStore';

import classes from './productionNode.module.css';

interface ProductionNodeProps extends NodeProps<Omit<IProductionNode, 'type'>> {
  color: MantineColor;
  type: 'source' | 'target';
  // false for sink nodes whose name is driven by the connected output
  editable?: boolean;
  children?: React.ReactNode;
  rightSection?: React.ReactNode;
}

export const ProductionNode = ({
  id,
  data,
  type,
  color,
  editable = true,
  children,
  rightSection,
}: ProductionNodeProps) => {
  const renameNode = useProductionStore(state => state.renameNode);
  const mounted = useMounted();
  const inputRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!editable || !mounted || !inputRef.current) return;

    inputRef.current.focus();

    const range = document.createRange();
    range.selectNodeContents(inputRef.current);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editable, mounted]);

  return (
    <>
      <Paper
        className={classes.node}
        style={{ '--node-color': `var(--mantine-color-${color}-filled)` }}
      >
        <Group className={classes.inputs}>
          <IconGripVertical size={20} className={DRAG_HANDLE_CLASS} />

          <Text<'span'>
            span
            contentEditable={editable}
            onChange={
              editable ? e => renameNode(id, e.target.textContent) : undefined
            }
            className={classes.input}
            role="textbox"
            ref={inputRef}
            dangerouslySetInnerHTML={{ __html: data.name }}
          />

          {rightSection}
        </Group>
        {children}
      </Paper>

      {type === 'target' && (
        <Handle
          type="target"
          position={Position.Left}
          className={classes.target}
        />
      )}

      {type === 'source' && (
        <Handle
          type="source"
          position={Position.Right}
          className={classes.source}
        />
      )}
    </>
  );
};
