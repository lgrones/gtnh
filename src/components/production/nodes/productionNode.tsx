import { Group, Paper, Text, Tooltip, type MantineColor } from '@mantine/core';
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
  type: 'source' | 'target' | 'none';
  // false for sink nodes whose name is driven by the connected output
  editable?: boolean;
  // the mode this node has no meaning in, if there is one. The leaves stand in
  // for the world outside a wired line, and an ME network IS that outside world,
  // so they go quiet in ME mode; a storage node is the ME answer to the same
  // question and goes quiet when wired. Either way it is shown rather than
  // deleted, since the graph can change mode back
  ignoredIn?: 'me' | 'wired';
  children?: React.ReactNode;
  leftSection?: React.ReactNode;
  rightSection?: React.ReactNode;
}

export const ProductionNode = ({
  id,
  data,
  type,
  color,
  editable = true,
  ignoredIn,
  children,
  rightSection,
  leftSection,
}: ProductionNodeProps) => {
  const renameNode = useProductionStore(state => state.renameNode);
  const ignored = useProductionStore(
    state => ignoredIn !== undefined && state.meMode === (ignoredIn === 'me'),
  );
  const mounted = useMounted();
  const inputRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!editable || !mounted || !inputRef.current) return;
    const el = inputRef.current;

    // defer two frames past React Flow focusing the node wrapper, else it
    // steals focus back and the highlighted name can't be typed over. nodes
    // with a leftSection (e.g. input's quantity) need the extra frame.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        el.focus();

        const range = document.createRange();
        range.selectNodeContents(el);

        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
    });

    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [editable, mounted]);

  return (
    <>
      <Tooltip
        label={
          ignoredIn === 'me'
            ? 'Ignored in ME mode — the network ledger covers this'
            : 'Ignored while wired — add an input node instead'
        }
        disabled={!ignored}
        withArrow
      >
        <Paper
          className={classes.node}
          style={{
            '--node-color': `var(--mantine-color-${color}-filled)`,
            opacity: ignored ? 0.4 : undefined,
          }}
          mod={[type]}
        >
          <Group className={classes.inputs}>
            <IconGripVertical size={20} className={DRAG_HANDLE_CLASS} />

            {leftSection}

            <Text<'span'>
              span
              contentEditable={editable}
              onBlur={
                editable
                  ? e => renameNode(id, e.currentTarget.textContent)
                  : undefined
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
      </Tooltip>

      {type === 'target' && (
        <Handle
          type="target"
          position={Position.Left}
          className={classes.target}
          style={
            {
              '--node-color': `var(--mantine-color-${color}-filled)`,
            } as React.CSSProperties
          }
        />
      )}

      {type === 'source' && (
        <Handle
          type="source"
          position={Position.Right}
          className={classes.source}
          style={
            {
              '--node-color': `var(--mantine-color-${color}-filled)`,
            } as React.CSSProperties
          }
        />
      )}
    </>
  );
};
