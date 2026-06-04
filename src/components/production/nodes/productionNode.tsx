import { Group, Paper, Text } from '@mantine/core';
import { IconGripVertical } from '@tabler/icons-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

import {
  DRAG_HANDLE_CLASS,
  useProductionStore,
  type ProductionNode as IProductionNode,
} from '@/contexts/productionStore';

import classes from './productionNode.module.css';

interface ProductionNodeProps extends NodeProps<Omit<IProductionNode, 'type'>> {
  type: 'target' | 'source' | 'both';
}

export const ProductionNode = ({ id, data, type }: ProductionNodeProps) => {
  const renameNode = useProductionStore(state => state.renameNode);

  return (
    <>
      <Paper className={classes.node} mod={[type]}>
        <Group className={classes.inputs}>
          <IconGripVertical className={DRAG_HANDLE_CLASS} />

          <Text
            span
            contentEditable
            onChange={e => renameNode(id, e.target.textContent)}
            className={classes.input}
            role="textbox"
          >
            {data.name}
          </Text>
        </Group>
      </Paper>

      {type !== 'source' && (
        <Handle
          type="target"
          position={Position.Top}
          className={classes.target}
        />
      )}

      {type !== 'target' && (
        <Handle
          type="source"
          position={Position.Top}
          className={classes.source}
        />
      )}
    </>
  );
};
